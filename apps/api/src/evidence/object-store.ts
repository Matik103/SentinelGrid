import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ObjectStoreBackend = "local_dev" | "supabase";

export type ObjectStore = {
  readonly backend: ObjectStoreBackend;
  put(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
};

export class LocalDevObjectStore implements ObjectStore {
  readonly backend = "local_dev" as const;

  constructor(private readonly root: string) {}

  private resolve(objectKey: string): string {
    if (objectKey.includes("..") || path.isAbsolute(objectKey)) {
      throw new Error("Invalid object key");
    }
    const full = path.resolve(this.root, objectKey);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid object key");
    return full;
  }

  async put(objectKey: string, bytes: Buffer, _contentType: string): Promise<void> {
    const full = this.resolve(objectKey);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, bytes, { flag: "wx", mode: 0o600 });
  }

  async get(objectKey: string): Promise<Buffer> {
    return readFile(this.resolve(objectKey));
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.resolve(objectKey), { force: true });
  }
}

/**
 * Evidence bytes in Supabase Storage via the service-role Storage API.
 * No Amazon S3 SDK, no AWS_* keys, no S3-compatible endpoint.
 */
export class SupabaseStorageObjectStore implements ObjectStore {
  readonly backend = "supabase" as const;

  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {
    if (!bucket.trim()) throw new Error("Supabase Storage bucket name is required");
  }

  async put(objectKey: string, bytes: Buffer, contentType: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(objectKey, bytes, {
      contentType,
      upsert: false,
    });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  async get(objectKey: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(this.bucket).download(objectKey);
    if (error || !data) {
      throw new Error(`Supabase Storage download failed: ${error?.message ?? "empty body"}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async delete(objectKey: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([objectKey]);
    if (error) throw new Error(`Supabase Storage delete failed: ${error.message}`);
  }
}

/** Resolve configured private bucket name (no Amazon S3 naming). */
export function resolvePayloadBucket(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.PAYLOAD_STORAGE_BUCKET?.trim() ||
    env.S3_BUCKET?.trim() || // legacy Render Blueprint name; treat as bucket only
    "evidence-payloads"
  );
}

/**
 * Normalize backend selection. Amazon S3 backends are rejected.
 * Legacy `s3_compatible` / `s3` aliases map to Supabase Storage for one release.
 */
export function resolvePayloadBackend(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStoreBackend | "" {
  const nodeEnv = env.NODE_ENV ?? "development";
  const raw = (env.PAYLOAD_STORAGE_BACKEND?.trim() ?? "").toLowerCase();
  const requested = raw || (nodeEnv === "production" ? "" : "local_dev");
  if (!requested) return "";
  if (requested === "local_dev") return "local_dev";
  if (requested === "supabase" || requested === "s3_compatible" || requested === "s3") {
    return "supabase";
  }
  return requested as ObjectStoreBackend;
}

/**
 * Build a local_dev store from env. Production supabase stores are created with
 * {@link SupabaseStorageObjectStore} + the Nest service-role client.
 */
export function createLocalDevObjectStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LocalDevObjectStore {
  const nodeEnv = env.NODE_ENV ?? "development";
  const backend = resolvePayloadBackend(env);
  if (backend !== "local_dev") {
    throw new Error(
      `createLocalDevObjectStoreFromEnv requires PAYLOAD_STORAGE_BACKEND=local_dev (got ${backend || "unset"})`,
    );
  }
  if (nodeEnv === "production") {
    throw new Error("local_dev payload storage is forbidden in production");
  }
  const root = path.resolve(env.PAYLOAD_STORAGE_ROOT ?? path.join(process.cwd(), ".payload-store"));
  return new LocalDevObjectStore(root);
}

/**
 * @deprecated Use createLocalDevObjectStoreFromEnv / SupabaseStorageObjectStore.
 * Kept as a thin dispatcher so older call sites fail closed without Amazon S3.
 */
export function createObjectStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStore {
  const nodeEnv = env.NODE_ENV ?? "development";
  const backend = resolvePayloadBackend(env);

  if (!backend) {
    throw new Error(
      "PAYLOAD_STORAGE_BACKEND is not configured; set to supabase (Supabase Storage) before evidence writes",
    );
  }

  if (backend === "local_dev") {
    return createLocalDevObjectStoreFromEnv(env);
  }

  if (backend === "supabase") {
    throw new Error(
      "Supabase Storage requires the Nest service-role client; use SupabaseStorageObjectStore via PayloadStorageService",
    );
  }

  throw new Error(
    `Unsupported PAYLOAD_STORAGE_BACKEND: ${String(env.PAYLOAD_STORAGE_BACKEND)}; Amazon S3 is not supported — use supabase`,
  );
}
