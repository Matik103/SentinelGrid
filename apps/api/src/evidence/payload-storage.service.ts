import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";

export type StoredPayload = {
  id: string;
  object_key: string;
  content_sha256: string;
  byte_length: number;
  storage_backend: "local_dev";
};

const MAX_PAYLOAD_BYTES = Number(process.env.MAX_EVIDENCE_PAYLOAD_BYTES ?? 1_048_576);
const CLASSIFICATIONS = new Set(["real", "simulated", "replayed", "synthetic"]);

@Injectable()
export class PayloadStorageService {
  private readonly root = path.resolve(
    process.env.PAYLOAD_STORAGE_ROOT ?? path.join(process.cwd(), ".payload-store"),
  );

  constructor(private readonly admin: SupabaseAdminService) {}

  async storeRaw(
    organisationId: string,
    payload: unknown,
    opts?: { classification?: string; contentType?: string },
  ): Promise<StoredPayload> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organisationId)) {
      throw new Error("Invalid organisation ID");
    }
    const classification = opts?.classification ?? "real";
    if (!CLASSIFICATIONS.has(classification)) throw new Error("Invalid payload classification");

    // S3 is intentionally unsupported until a real adapter is installed and tested.
    const requestedBackend = process.env.PAYLOAD_STORAGE_BACKEND ?? "local_dev";
    if (requestedBackend !== "local_dev") {
      throw new Error(`Unsupported PAYLOAD_STORAGE_BACKEND: ${requestedBackend}; refusing metadata-only evidence writes`);
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error("local_dev payload storage is forbidden in production");
    }

    const serialised = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (serialised === undefined) throw new Error("Payload is not JSON serialisable");
    const bytes = Buffer.from(serialised, "utf8");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PAYLOAD_BYTES) {
      throw new Error(`Payload size must be between 1 and ${MAX_PAYLOAD_BYTES} bytes`);
    }
    const sha = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `${organisationId}/${new Date().toISOString().slice(0, 10)}/${sha.slice(0, 16)}-${randomUUID()}.json`;
    const fullPath = path.resolve(this.root, objectKey);
    if (!fullPath.startsWith(this.root + path.sep)) throw new Error("Invalid object key");

    await mkdir(path.dirname(fullPath), { recursive: true, mode: 0o700 });
    await writeFile(fullPath, bytes, { flag: "wx", mode: 0o600 });

    try {
      const { data, error } = await this.admin.client
        .from("payload_objects")
        .insert({
          organisation_id: organisationId,
          object_key: objectKey,
          content_sha256: sha,
          byte_length: bytes.byteLength,
          content_type: opts?.contentType ?? "application/json",
          storage_backend: "local_dev",
          classification,
        })
        .select("id")
        .single();
      if (error || !data?.id) throw new Error(`payload_objects insert failed: ${error?.message ?? "no id"}`);
      return {
        id: data.id as string,
        object_key: objectKey,
        content_sha256: sha,
        byte_length: bytes.byteLength,
        storage_backend: "local_dev",
      };
    } catch (error) {
      await rm(fullPath, { force: true });
      throw error;
    }
  }

  async readRaw(organisationId: string, objectId: string): Promise<Buffer> {
    const { data, error } = await this.admin.client
      .from("payload_objects")
      .select("object_key, content_sha256, storage_backend, organisation_id")
      .eq("id", objectId)
      .eq("organisation_id", organisationId)
      .single();
    if (error || !data) throw new Error("Evidence payload not found");
    if (data.storage_backend !== "local_dev") throw new Error("Configured evidence backend is unavailable");
    const key = String(data.object_key);
    if (!key.startsWith(`${organisationId}/`) || key.includes("..") || path.isAbsolute(key)) {
      throw new Error("Stored evidence key failed tenant/path validation");
    }
    const fullPath = path.resolve(this.root, key);
    if (!fullPath.startsWith(this.root + path.sep)) throw new Error("Stored evidence path escaped storage root");
    const bytes = await readFile(fullPath);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== data.content_sha256) throw new Error("Evidence payload integrity verification failed");
    return bytes;
  }
}
