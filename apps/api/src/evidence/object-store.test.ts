import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  LocalDevObjectStore,
  createLocalDevObjectStoreFromEnv,
  createObjectStoreFromEnv,
  resolvePayloadBackend,
  resolvePayloadBucket,
} from "./object-store.js";

describe("resolvePayloadBackend", () => {
  const prev = { ...process.env };

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
  });

  it("maps legacy s3 aliases to supabase", () => {
    process.env.PAYLOAD_STORAGE_BACKEND = "s3_compatible";
    assert.equal(resolvePayloadBackend(), "supabase");
    process.env.PAYLOAD_STORAGE_BACKEND = "s3";
    assert.equal(resolvePayloadBackend(), "supabase");
  });

  it("defaults to local_dev outside production when unset", () => {
    process.env.NODE_ENV = "test";
    delete process.env.PAYLOAD_STORAGE_BACKEND;
    assert.equal(resolvePayloadBackend(), "local_dev");
  });
});

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
    const store = createLocalDevObjectStoreFromEnv();
    assert.equal(store.backend, "local_dev");
  });

  it("forbids local_dev in production", () => {
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_STORAGE_BACKEND = "local_dev";
    assert.throws(() => createLocalDevObjectStoreFromEnv(), /forbidden in production/);
  });

  it("does not default to local_dev when unset in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PAYLOAD_STORAGE_BACKEND;
    assert.throws(() => createObjectStoreFromEnv(), /PAYLOAD_STORAGE_BACKEND is not configured/);
  });

  it("refuses Amazon S3 SDK path for supabase (requires service-role client)", () => {
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_STORAGE_BACKEND = "supabase";
    process.env.PAYLOAD_STORAGE_BUCKET = "evidence-payloads";
    assert.throws(() => createObjectStoreFromEnv(), /service-role client/);
  });

  it("rejects unknown backends", () => {
    process.env.PAYLOAD_STORAGE_BACKEND = "memory";
    assert.throws(() => createObjectStoreFromEnv(), /Unsupported|Amazon S3/);
  });

  it("resolves bucket name with PAYLOAD_STORAGE_BUCKET preferred", () => {
    process.env.PAYLOAD_STORAGE_BUCKET = "evidence-payloads";
    process.env.S3_BUCKET = "legacy";
    assert.equal(resolvePayloadBucket(), "evidence-payloads");
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
