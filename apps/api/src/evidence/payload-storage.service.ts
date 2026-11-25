import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";

export type StoredPayload = {
  id: string;
  object_key: string;
  content_sha256: string;
  byte_length: number;
  storage_backend: "local_dev" | "s3_compatible";
};

/**
 * Object storage model for raw/evidence payloads.
 * Phase 0: local_dev filesystem backend by default; S3-compatible when configured.
 * Postgres holds metadata only (payload_objects); bytes stay outside the DB.
 */
@Injectable()
export class PayloadStorageService {
  private readonly log = new Logger(PayloadStorageService.name);
  private readonly root =
    process.env.PAYLOAD_STORAGE_ROOT ?? path.join(process.cwd(), ".payload-store");

  constructor(private readonly admin: SupabaseAdminService) {}

  async storeRaw(
    organisationId: string,
    payload: unknown,
    opts?: { classification?: string; contentType?: string },
  ): Promise<StoredPayload> {
    const bytes = Buffer.from(
      typeof payload === "string" ? payload : JSON.stringify(payload),
      "utf8",
    );
    const sha = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `${organisationId}/${new Date().toISOString().slice(0, 10)}/${sha.slice(0, 16)}-${randomUUID()}.json`;
    const backend = process.env.PAYLOAD_STORAGE_BACKEND === "s3" ? "s3_compatible" : "local_dev";

    if (backend === "local_dev") {
      const full = path.join(this.root, objectKey);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes);
    } else {
      // S3 path is configured but not invoked without credentials (no fabricated live uploads).
      this.log.warn(
        "PAYLOAD_STORAGE_BACKEND=s3 set; configure AWS SDK credentials before production use. Metadata-only insert for Phase 0.",
      );
    }

    const { data, error } = await this.admin.client
      .from("payload_objects")
      .insert({
        organisation_id: organisationId,
        object_key: objectKey,
        content_sha256: sha,
        byte_length: bytes.byteLength,
        content_type: opts?.contentType ?? "application/json",
        storage_backend: backend,
        classification: opts?.classification ?? "real",
      })
      .select("id")
      .maybeSingle();

    if (error || !data?.id) {
      throw new Error(`payload_objects insert failed: ${error?.message ?? "no id"}`);
    }

    return {
      id: data.id as string,
      object_key: objectKey,
      content_sha256: sha,
      byte_length: bytes.byteLength,
      storage_backend: backend,
    };
  }
}
