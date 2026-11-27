import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  LocalDevObjectStore,
  createObjectStoreFromEnv,
} from "./object-store.js";

describe("createObjectStoreFromEnv", () => {
  const prev = { ...process.env };

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
  });

  it("creates local_dev store outside production", () => {
    process.env.NODE_ENV = "test";
    process.env.PAYLOAD_STORAGE_BACKEND = "local_dev";
    process.env.PAYLOAD_STORAGE_ROOT = path.join(tmpdir(), "sg-payload-test");
    const store = createObjectStoreFromEnv();
    assert.equal(store.backend, "local_dev");
  });

  it("forbids local_dev in production", () => {
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_STORAGE_BACKEND = "local_dev";
    assert.throws(() => createObjectStoreFromEnv(), /forbidden in production/);
  });

  it("does not default to local_dev when unset in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PAYLOAD_STORAGE_BACKEND;
    assert.throws(() => createObjectStoreFromEnv(), /PAYLOAD_STORAGE_BACKEND is not configured/);
  });

  it("fail-closes when s3 is selected without bucket/region", () => {
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_STORAGE_BACKEND = "s3";
    delete process.env.S3_BUCKET;
    delete process.env.PAYLOAD_S3_BUCKET;
    delete process.env.AWS_REGION;
    delete process.env.S3_REGION;
    assert.throws(() => createObjectStoreFromEnv(), /misconfigured/);
  });

  it("fail-closes on unpaired AWS credentials", () => {
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_STORAGE_BACKEND = "s3_compatible";
    process.env.S3_BUCKET = "evidence";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "AKIA";
    delete process.env.AWS_SECRET_ACCESS_KEY;
    assert.throws(() => createObjectStoreFromEnv(), /both be set/);
  });

  it("creates s3_compatible store when configured", () => {
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_STORAGE_BACKEND = "s3";
    process.env.S3_BUCKET = "evidence";
    process.env.AWS_REGION = "eu-west-1";
    process.env.AWS_ACCESS_KEY_ID = "AKIA";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    const store = createObjectStoreFromEnv();
    assert.equal(store.backend, "s3_compatible");
  });

  it("rejects unknown backends", () => {
    process.env.PAYLOAD_STORAGE_BACKEND = "memory";
    assert.throws(() => createObjectStoreFromEnv(), /Unsupported/);
  });

  it("rejects non-https S3_ENDPOINT in production", () => {
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_STORAGE_BACKEND = "s3";
    process.env.S3_BUCKET = "evidence";
    process.env.AWS_REGION = "us-east-1";
    process.env.S3_ENDPOINT = "http://minio.local:9000";
    assert.throws(() => createObjectStoreFromEnv(), /https/);
  });
});

describe("LocalDevObjectStore", () => {
  it("round-trips bytes and rejects path traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sg-obj-"));
    try {
      const store = new LocalDevObjectStore(root);
      const key = "org/2026-11-25/a.json";
      const bytes = Buffer.from('{"ok":true}', "utf8");
      await store.put(key, bytes, "application/json");
      const got = await store.get(key);
      assert.equal(got.toString("utf8"), '{"ok":true}');
      await assert.rejects(() => store.put("../escape.json", bytes, "application/json"));
      await store.delete(key);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
