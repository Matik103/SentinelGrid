import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { LocalDevObjectStore } from "./object-store.js";
import { PayloadStorageService } from "./payload-storage.service.js";

describe("PayloadStorageService.onModuleInit production", () => {
  const prev = { ...process.env };

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
  });

  it("ignores local_dev in production without selecting a store", () => {
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_STORAGE_BACKEND = "local_dev";
    const admin = { client: {} };
    const svc = new PayloadStorageService(admin as never);
    svc.onModuleInit();
    assert.equal((svc as unknown as { store?: unknown }).store, undefined);
  });

  it("defers when backend unset in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PAYLOAD_STORAGE_BACKEND;
    const admin = { client: {} };
    const svc = new PayloadStorageService(admin as never);
    svc.onModuleInit();
    assert.equal((svc as unknown as { store?: unknown }).store, undefined);
  });
});

function adminCapturingInsert() {
  let lastInsert: Record<string, unknown> | null = null;
  return {
    lastInsert: () => lastInsert,
    client: {
      from: (_table: string) => ({
        insert: (row: Record<string, unknown>) => {
          lastInsert = row;
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: "11111111-1111-4111-8111-111111111111",
                  organisation_id: row.organisation_id,
                  object_key: row.object_key,
                  content_sha256: row.content_sha256,
                  byte_length: row.byte_length,
                  storage_backend: row.storage_backend,
                  classification: row.classification,
                },
                error: null,
              }),
            }),
          };
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: lastInsert
                  ? {
                      object_key: lastInsert.object_key,
                      content_sha256: lastInsert.content_sha256,
                      byte_length: lastInsert.byte_length,
                      organisation_id: lastInsert.organisation_id,
                    }
                  : null,
                error: null,
              }),
            }),
          }),
        }),
      }),
    },
  };
}

describe("PayloadStorageService", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("stores via object store with SHA-256 and verifies on read", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sg-payload-svc-"));
    const store = new LocalDevObjectStore(root);
    const admin = adminCapturingInsert();
    const svc = new PayloadStorageService(admin as never, store);
    svc.onModuleInit();

    const org = "22222222-2222-4222-8222-222222222222";
    const meta = await svc.storeRaw(org, { a: 1 }, { classification: "simulated" });
    assert.equal(meta.storage_backend, "local_dev");
    assert.equal(meta.content_sha256.length, 64);
    assert.equal(meta.classification, "simulated");
    assert.ok(String(meta.object_key).startsWith(`${org}/`));

    const expected = createHash("sha256").update(Buffer.from(JSON.stringify({ a: 1 }), "utf8")).digest("hex");
    assert.equal(meta.content_sha256, expected);

    const bytes = await svc.readRaw(org, meta.id);
    assert.equal(bytes.toString("utf8"), JSON.stringify({ a: 1 }));
  });

  it("rejects SHA-256 mismatch on read", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sg-payload-bad-"));
    const store = new LocalDevObjectStore(root);
    const key = "org/day/id.json";
    await store.put(key, Buffer.from('{"tampered":true}'), "application/json");

    const admin = {
      client: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    object_key: key,
                    content_sha256: createHash("sha256").update(Buffer.from('{"a":1}')).digest("hex"),
                    organisation_id: "22222222-2222-4222-8222-222222222222",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      },
    };
    const svc = new PayloadStorageService(admin as never, store);
    await assert.rejects(
      () => svc.readRaw("22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111"),
      /integrity/,
    );
  });
});
