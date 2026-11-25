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
    if (!this.store) {
      this.store = createObjectStoreFromEnv();
    }
    this.log.log(`payload storage backend=${this.store.backend}`);
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
    const bytes = Buffer.from(JSON.stringify(payload), "utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `${organisationId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.json`;
    const contentType = opts?.contentType ?? "application/json";

    await this.store.put(objectKey, bytes, contentType);

    // Read-back integrity check before metadata commit (fail-closed).
    const readBack = await this.store.get(objectKey);
    const readDigest = createHash("sha256").update(readBack).digest("hex");
    if (readDigest !== digest || readBack.byteLength !== bytes.byteLength) {
      await this.store.delete(objectKey).catch(() => undefined);
      throw new Error("Payload integrity verification failed after write; object discarded");
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
      await this.store.delete(objectKey).catch(() => undefined);
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
    await this.store.delete(data.object_key).catch(() => undefined);
    await this.admin.client
      .from("payload_objects")
      .delete()
      .eq("id", payloadObjectId)
      .eq("organisation_id", organisationId);
  }

  async readRaw(organisationId: string, payloadObjectId: string): Promise<Buffer> {
    if (!this.store) {
      this.store = createObjectStoreFromEnv();
    }
    const { data, error } = await this.admin.client
      .from("payload_objects")
      .select("object_key, content_sha256, organisation_id")
      .eq("id", payloadObjectId)
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (error || !data) throw new Error("payload object not found");

    const bytes = await this.store.get(data.object_key);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== data.content_sha256) {
      throw new Error("payload integrity check failed (SHA-256 mismatch)");
    }
    return bytes;
  }
}
