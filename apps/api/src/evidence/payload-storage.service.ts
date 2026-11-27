import { createHash, randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";
import {
  SupabaseStorageObjectStore,
  createLocalDevObjectStoreFromEnv,
  resolvePayloadBackend,
  resolvePayloadBucket,
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
 * Production uses Supabase Storage via the service-role API (not Amazon S3).
 * Fail-closed when misconfigured; never writes metadata without verified bytes.
 */
@Injectable()
export class PayloadStorageService implements OnModuleInit {
  private readonly log = new Logger(PayloadStorageService.name);
  private store!: ObjectStore;
  /** Boot-time Storage bucket ensure result for /v1/health (no secrets). */
  private bucketStatus: "ready" | "created" | "skipped" | "failed" | "unknown" = "unknown";
  /** Public workspace logo bucket (browser uploads). */
  private workspaceBrandingBucketStatus: "ready" | "created" | "failed" | "unknown" = "unknown";

  constructor(
    private readonly admin: SupabaseAdminService,
    /** Test injection only — never a Nest provider. */
    @Optional() store?: ObjectStore,
  ) {
    if (store) {
      this.store = store;
    }
  }

  /** Non-secret readiness signal for operators. */
  getConfiguredBucketStatus(): string {
    return this.bucketStatus;
  }

  /** Non-secret readiness for the public workspace logo bucket. */
  getWorkspaceBrandingBucketStatus(): string {
    return this.workspaceBrandingBucketStatus;
  }

  /** Non-secret backend label for /v1/health. */
  getActiveBackend(): ObjectStoreBackend | "deferred" {
    return this.store?.backend ?? "deferred";
  }

  async onModuleInit() {
    if (this.store) {
      this.log.log(`payload storage backend=${this.store.backend}`);
      await this.ensureConfiguredBucket();
      await this.ensureWorkspaceBrandingBucket();
      return;
    }

    const production = (process.env.NODE_ENV ?? "development") === "production";
    const backend = resolvePayloadBackend();
    const raw = (process.env.PAYLOAD_STORAGE_BACKEND?.trim() ?? "").toLowerCase();

    if (production && (!backend || backend === "local_dev")) {
      if (raw === "local_dev") {
        this.log.log(
          "PAYLOAD_STORAGE_BACKEND=local_dev ignored in production; set PAYLOAD_STORAGE_BACKEND=supabase; evidence writes stay fail-closed",
        );
      } else {
        this.log.log(
          "payload storage deferred until Supabase Storage is configured (PAYLOAD_STORAGE_BACKEND=supabase); evidence writes stay fail-closed",
        );
      }
      this.bucketStatus = "skipped";
      return;
    }

    if (raw === "s3" || raw === "s3_compatible") {
      this.log.log(
        "PAYLOAD_STORAGE_BACKEND legacy alias mapped to supabase (Amazon S3 SDK removed; using Supabase Storage API)",
      );
    }

    try {
      if (backend === "local_dev") {
        this.store = createLocalDevObjectStoreFromEnv();
      } else if (backend === "supabase") {
        this.store = new SupabaseStorageObjectStore(this.admin.client, resolvePayloadBucket());
      } else if (!backend) {
        throw new Error("PAYLOAD_STORAGE_BACKEND is not configured");
      } else {
        throw new Error(
          `Unsupported PAYLOAD_STORAGE_BACKEND: ${raw}; Amazon S3 is not supported — use supabase`,
        );
      }
      this.log.log(`payload storage backend=${this.store.backend}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/local_dev/i.test(message) && production) {
        this.log.log(
          "payload storage deferred (local_dev unavailable in production); configure PAYLOAD_STORAGE_BACKEND=supabase",
        );
      } else {
        this.log.warn(`payload storage not ready at boot: ${message}`);
      }
    }

    await this.ensureConfiguredBucket();
    await this.ensureWorkspaceBrandingBucket();
  }

  /**
   * Create the public workspace-branding bucket used for organisation logos.
   * Browser uploads still require the migration RLS policies; this only creates the bucket.
   */
  private async ensureWorkspaceBrandingBucket(): Promise<void> {
    const bucket = "workspace-branding";
    if (typeof this.admin?.client?.storage?.getBucket !== "function") {
      this.workspaceBrandingBucketStatus = "unknown";
      return;
    }
    try {
      const existing = await this.admin.client.storage.getBucket(bucket);
      if (!existing.error && existing.data) {
        this.workspaceBrandingBucketStatus = "ready";
        this.log.log(`workspace branding bucket ready id=${bucket}`);
        return;
      }

      const created = await this.admin.client.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: 2_097_152,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
      });
      if (created.error) {
        const msg = created.error.message ?? String(created.error);
        if (/already exists|duplicate|resource already/i.test(msg)) {
          this.workspaceBrandingBucketStatus = "ready";
          this.log.log(`workspace branding bucket ready id=${bucket}`);
          return;
        }
        this.workspaceBrandingBucketStatus = "failed";
        this.log.warn(`workspace branding bucket ensure failed id=${bucket}: ${msg}`);
        return;
      }
      this.workspaceBrandingBucketStatus = "created";
      this.log.log(`workspace branding bucket created id=${bucket}`);
    } catch (error) {
      this.workspaceBrandingBucketStatus = "failed";
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`workspace branding bucket ensure failed id=${bucket}: ${message}`);
    }
  }

  /**
   * Create the configured private Storage bucket if missing.
   * Uses the service-role Storage API. Idempotent.
   * RLS policies from migration remain required for authenticated browser access;
   * Nest service-role Storage calls bypass object RLS once the bucket exists.
   */
  private async ensureConfiguredBucket(): Promise<void> {
    const backend = resolvePayloadBackend();
    if (backend !== "supabase") {
      this.bucketStatus = "skipped";
      return;
    }

    const bucket = resolvePayloadBucket();
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      this.bucketStatus = "failed";
      this.log.warn(`refusing storage bucket ensure: invalid bucket name`);
      return;
    }

    try {
      const existing = await this.admin.client.storage.getBucket(bucket);
      if (!existing.error && existing.data) {
        this.bucketStatus = "ready";
        this.log.log(`storage bucket ready id=${bucket}`);
        return;
      }

      const created = await this.admin.client.storage.createBucket(bucket, {
        public: false,
        fileSizeLimit: 10_485_760,
        allowedMimeTypes: ["application/json", "application/octet-stream"],
      });
      if (created.error) {
        const msg = created.error.message ?? String(created.error);
        if (/already exists|duplicate|resource already/i.test(msg)) {
          this.bucketStatus = "ready";
          this.log.log(`storage bucket ready id=${bucket}`);
          return;
        }
        this.bucketStatus = "failed";
        this.log.warn(`storage bucket ensure failed id=${bucket}: ${msg}`);
        return;
      }
      this.bucketStatus = "created";
      this.log.log(`storage bucket created id=${bucket}`);
    } catch (error) {
      this.bucketStatus = "failed";
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`storage bucket ensure failed id=${bucket}: ${message}`);
    }
  }

  /** Test / DI helper — bind a store without env. */
  useStore(store: ObjectStore) {
    this.store = store;
  }

  private ensureStore(): ObjectStore {
    if (this.store) return this.store;
    const backend = resolvePayloadBackend();
    if (backend === "local_dev") {
      this.store = createLocalDevObjectStoreFromEnv();
      return this.store;
    }
    if (backend === "supabase") {
      this.store = new SupabaseStorageObjectStore(this.admin.client, resolvePayloadBucket());
      return this.store;
    }
    throw new Error(
      "PAYLOAD_STORAGE_BACKEND is not configured; set to supabase (Supabase Storage) before evidence writes",
    );
  }

  async storeRaw(
    organisationId: string,
    payload: unknown,
    opts?: { classification?: PayloadClassification; contentType?: string },
  ): Promise<StoredPayloadMeta> {
    const store = this.ensureStore();
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

    await store.put(objectKey, bytes, contentType);

    // Read-back integrity check before metadata commit (fail-closed).
    const readBack = await store.get(objectKey);
    const readDigest = createHash("sha256").update(readBack).digest("hex");
    if (readDigest !== digest || readBack.byteLength !== bytes.byteLength) {
      try {
        await store.delete(objectKey);
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
      storage_backend: store.backend,
      classification: opts?.classification ?? "real",
    };

    const { data, error } = await this.admin.client
      .from("payload_objects")
      .insert(row)
      .select("id, organisation_id, object_key, content_sha256, byte_length, storage_backend, classification")
      .single();
    if (error) {
      try {
        await store.delete(objectKey);
      } catch (cleanupError) {
        this.log.error(`orphan payload cleanup requires reconciliation key=${objectKey}: ${String(cleanupError)}`);
      }
      throw new Error(`payload metadata insert failed: ${error.message}`);
    }
    return data as StoredPayloadMeta;
  }

  async deleteStored(organisationId: string, payloadObjectId: string): Promise<void> {
    const store = this.ensureStore();
    const { data, error } = await this.admin.client
      .from("payload_objects")
      .select("object_key")
      .eq("id", payloadObjectId)
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (error || !data) return;
    // Keep metadata if object deletion fails so operators can reconcile it.
    await store.delete(data.object_key);
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
    const store = this.ensureStore();
    const { data, error } = await this.admin.client
      .from("payload_objects")
      .select("object_key, content_sha256, byte_length, organisation_id")
      .eq("id", payloadObjectId)
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (error || !data) throw new Error("payload object not found");

    const bytes = await store.get(data.object_key);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== data.content_sha256 || bytes.byteLength !== data.byte_length) {
      throw new Error("payload integrity check failed (digest or byte-length mismatch)");
    }
    return bytes;
  }
}
