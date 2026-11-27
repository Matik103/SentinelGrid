import { createHash, randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";
import {
  createObjectStoreFromEnv,
  type ObjectStore,
  type ObjectStoreBackend,
} from "./object-store.js";

export type PayloadClassification = "real" | "simulated" | "replayed" | "synthetic";

export type StoredPayloadMeta = {
  id: string;
  organisation_id: string;
  object_key: string;
  content_sha256: string;
  byte_length: number;
  storage_backend: ObjectStoreBackend;
  classification: PayloadClassification;
};

/**
 * Evidence / payload object storage with SHA-256 integrity.
 * Supports local_dev (non-production) and S3-compatible backends.
 * Fail-closed when misconfigured; never writes metadata without verified bytes.
 */
@Injectable()
export class PayloadStorageService implements OnModuleInit {
  private readonly log = new Logger(PayloadStorageService.name);
  private store!: ObjectStore;

  constructor(
    private readonly admin: SupabaseAdminService,
    store?: ObjectStore,
  ) {
    if (store) {
      this.store = store;
    }
  }

  onModuleInit() {
    if (this.store) {
      this.log.log(`payload storage backend=${this.store.backend}`);
      return;
    }
    try {
      this.store = createObjectStoreFromEnv();
      this.log.log(`payload storage backend=${this.store.backend}`);
    } catch (error) {
      // Allow Nest to boot for /v1/health, auth, and invites before S3 is wired.
      // Evidence writes remain fail-closed via createObjectStoreFromEnv on first use.
      this.log.warn(
        `payload storage not ready at boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Test / DI helper — bind a store without env. */
  useStore(store: ObjectStore) {
    this.store = store;
  }

  async storeRaw(
    organisationId: string,
    payload: unknown,
    opts?: { classification?: PayloadClassification; contentType?: string },
  ): Promise<StoredPayloadMeta> {
    if (!this.store) {
      this.store = createObjectStoreFromEnv();
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organisationId)) {
      throw new Error("organisationId must be a valid UUID");
    }
    let serialised: string | undefined;
    try {
      serialised = JSON.stringify(payload);
    } catch {
      throw new Error("payload must be JSON-serialisable");
    }
    if (serialised === undefined) {
      throw new Error("payload must serialise to a JSON value");
    }
    const bytes = Buffer.from(serialised, "utf8");
    const maxBytes = Number(process.env.PAYLOAD_MAX_BYTES ?? 1_048_576);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 10_485_760) {
      throw new Error("PAYLOAD_MAX_BYTES must be an integer between 1 and 10485760");
    }
    if (bytes.byteLength > maxBytes) {
      throw new Error(`payload exceeds maximum size of ${maxBytes} bytes`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `${organisationId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.json`;
    const contentType = opts?.contentType ?? "application/json";

    await this.store.put(objectKey, bytes, contentType);

    // Read-back integrity check before metadata commit (fail-closed).
    const readBack = await this.store.get(objectKey);
    const readDigest = createHash("sha256").update(readBack).digest("hex");
    if (readDigest !== digest || readBack.byteLength !== bytes.byteLength) {
      try {
        await this.store.delete(objectKey);
      } catch (cleanupError) {
        this.log.error(`integrity-failed object cleanup requires reconciliation key=${objectKey}: ${String(cleanupError)}`);
      }
      throw new Error("Payload integrity verification failed after write");
    }

    const row = {
      organisation_id: organisationId,
      object_key: objectKey,
      content_sha256: digest,
      byte_length: bytes.byteLength,
      content_type: contentType,
      storage_backend: this.store.backend,
      classification: opts?.classification ?? "real",
    };

    const { data, error } = await this.admin.client
      .from("payload_objects")
      .insert(row)
      .select("id, organisation_id, object_key, content_sha256, byte_length, storage_backend, classification")
      .single();
    if (error) {
      try {
        await this.store.delete(objectKey);
      } catch (cleanupError) {
        this.log.error(`orphan payload cleanup requires reconciliation key=${objectKey}: ${String(cleanupError)}`);
      }
      throw new Error(`payload metadata insert failed: ${error.message}`);
    }
    return data as StoredPayloadMeta;
  }

  async deleteStored(organisationId: string, payloadObjectId: string): Promise<void> {
    if (!this.store) {
      this.store = createObjectStoreFromEnv();
    }
    const { data, error } = await this.admin.client
      .from("payload_objects")
      .select("object_key")
      .eq("id", payloadObjectId)
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (error || !data) return;
    // Keep metadata if object deletion fails so operators can reconcile it.
    await this.store.delete(data.object_key);
    const { error: metadataError } = await this.admin.client
      .from("payload_objects")
      .delete()
      .eq("id", payloadObjectId)
      .eq("organisation_id", organisationId);
    if (metadataError) {
      throw new Error(`payload deleted but metadata cleanup failed: ${metadataError.message}`);
    }
  }

  async readRaw(organisationId: string, payloadObjectId: string): Promise<Buffer> {
    if (!this.store) {
      this.store = createObjectStoreFromEnv();
    }
    const { data, error } = await this.admin.client
      .from("payload_objects")
      .select("object_key, content_sha256, byte_length, organisation_id")
      .eq("id", payloadObjectId)
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (error || !data) throw new Error("payload object not found");

    const bytes = await this.store.get(data.object_key);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== data.content_sha256 || bytes.byteLength !== data.byte_length) {
      throw new Error("payload integrity check failed (digest or byte-length mismatch)");
    }
    return bytes;
  }
}
