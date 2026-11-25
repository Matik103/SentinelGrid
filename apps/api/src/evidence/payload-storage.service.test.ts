import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PayloadStorageService } from "./payload-storage.service.js";

const originalBackend = process.env.PAYLOAD_STORAGE_BACKEND;
const originalNodeEnv = process.env.NODE_ENV;

after(() => {
  if (originalBackend === undefined) delete process.env.PAYLOAD_STORAGE_BACKEND;
  else process.env.PAYLOAD_STORAGE_BACKEND = originalBackend;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("PayloadStorageService safety boundaries", () => {
  it("fails closed for S3 instead of inserting metadata for missing object bytes", async () => {
    process.env.NODE_ENV = "test";
    process.env.PAYLOAD_STORAGE_BACKEND = "s3";
    let metadataWrites = 0;
    const admin = {
      client: {
        from: () => {
          metadataWrites += 1;
          throw new Error("metadata write must not happen");
        },
      },
    };
    const service = new PayloadStorageService(admin as never);
    await assert.rejects(
      service.storeRaw("00000000-0000-4000-8000-000000000001", { sensor: "test" }),
      /Unsupported PAYLOAD_STORAGE_BACKEND/,
    );
    assert.equal(metadataWrites, 0);
  });

  it("rejects local filesystem evidence storage in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_STORAGE_BACKEND = "local_dev";
    const admin = { client: { from: () => { throw new Error("must not write metadata"); } } };
    const service = new PayloadStorageService(admin as never);
    await assert.rejects(
      service.storeRaw("00000000-0000-4000-8000-000000000001", { sensor: "test" }),
      /forbidden in production/,
    );
  });

  it("rejects invalid tenant identifiers before storage", async () => {
    process.env.NODE_ENV = "test";
    process.env.PAYLOAD_STORAGE_BACKEND = "local_dev";
    const admin = { client: { from: () => { throw new Error("must not write metadata"); } } };
    const service = new PayloadStorageService(admin as never);
    await assert.rejects(service.storeRaw("../other-tenant", {}), /Invalid organisation ID/);
  });
});
