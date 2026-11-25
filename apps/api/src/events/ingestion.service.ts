import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { EventIngestSchema, type EventIngestInput } from "@sentinelgrid/shared";
import { createHash } from "node:crypto";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";
import { PayloadStorageService } from "../evidence/payload-storage.service.js";

export type IngestResult =
  | { status: "accepted"; event_id: string; deduplicated: false; payload_object_id?: string }
  | { status: "deduplicated"; event_id: string; deduplicated: true }
  | { status: "dlq"; dlq_id: string; reason: string };

@Injectable()
export class IngestionService {
  private readonly log = new Logger(IngestionService.name);

  constructor(
    private readonly admin: SupabaseAdminService,
    private readonly payloads: PayloadStorageService,
  ) {}

  async ingest(raw: unknown, opts?: { replay?: boolean }): Promise<IngestResult> {
    const parsed = EventIngestSchema.safeParse(raw);
    if (!parsed.success) {
      return this.toDlq(null, raw, `schema_validation: ${parsed.error.message}`);
    }
    const input = parsed.data;
    if (opts?.replay) {
      input.classification = "replayed";
    }

    try {
      let payloadObjectId: string | undefined;
      let originalPayloadRef: string | null = null;

      if (input.original_payload !== undefined) {
        const stored = await this.payloads.storeRaw(
          input.organisation_id,
          input.original_payload,
          { classification: input.classification },
        );
        payloadObjectId = stored.id;
        originalPayloadRef = stored.object_key;
      }

      const row = {
        organisation_id: input.organisation_id,
        facility_id: input.facility_id ?? null,
        asset_id: input.asset_id ?? null,
        device_id: input.device_id ?? null,
        sensor_id: input.sensor_id ?? null,
        connector_id: input.connector_id ?? null,
        event_type: input.event_type,
        occurred_at: input.occurred_at,
        ingested_at: new Date().toISOString(),
        source: input.source,
        source_event_id: input.source_event_id,
        schema_version: input.schema_version,
        normalised: input.normalised,
        units: input.units,
        data_quality: input.data_quality,
        clock_quality: input.clock_quality,
        classification: input.classification,
        original_payload_ref: originalPayloadRef,
      };

      const { data, error } = await this.admin.client
        .from("events")
        .insert(row)
        .select("id")
        .maybeSingle();

      if (error) {
        // Unique violation on (organisation_id, source, source_event_id) => dedup
        if (error.code === "23505") {
          const existing = await this.findExisting(input);
          if (existing) {
            return { status: "deduplicated", event_id: existing, deduplicated: true };
          }
        }
        return this.toDlq(input, raw, error.message);
      }

      if (!data?.id) {
        return this.toDlq(input, raw, "insert_returned_no_id");
      }

      return {
        status: "accepted",
        event_id: data.id as string,
        deduplicated: false,
        payload_object_id: payloadObjectId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`ingest failure: ${message}`);
      return this.toDlq(input, raw, message);
    }
  }

  async replayFromDlq(dlqId: string): Promise<IngestResult> {
    const { data: dlq, error } = await this.admin.client
      .from("event_ingestion_dlq")
      .select("*")
      .eq("id", dlqId)
      .maybeSingle();
    if (error || !dlq) {
      throw new BadRequestException("DLQ entry not found");
    }
    if (dlq.status !== "open") {
      throw new BadRequestException(`DLQ status is ${dlq.status}`);
    }
    const result = await this.ingest(dlq.raw_body ?? {}, { replay: true });
    await this.admin.client
      .from("event_ingestion_dlq")
      .update({
        status: result.status === "dlq" ? "open" : "replayed",
        attempt_count: (dlq.attempt_count ?? 1) + 1,
        last_error: result.status === "dlq" ? result.reason : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dlqId);
    return result;
  }

  private async findExisting(input: EventIngestInput): Promise<string | null> {
    const { data } = await this.admin.client
      .from("events")
      .select("id")
      .eq("organisation_id", input.organisation_id)
      .eq("source", input.source)
      .eq("source_event_id", input.source_event_id)
      .maybeSingle();
    return (data?.id as string) ?? null;
  }

  private async toDlq(
    input: EventIngestInput | null,
    raw: unknown,
    reason: string,
  ): Promise<IngestResult> {
    const digest = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
    const { data, error } = await this.admin.client
      .from("event_ingestion_dlq")
      .insert({
        organisation_id: input?.organisation_id ?? null,
        connector_id: input?.connector_id ?? null,
        source: input?.source ?? null,
        source_event_id: input?.source_event_id ?? null,
        failure_reason: reason,
        payload_ref: digest,
        raw_body: raw as object,
        schema_version: input?.schema_version ?? null,
        status: "open",
      })
      .select("id")
      .maybeSingle();
    if (error || !data?.id) {
      this.log.error(`DLQ write failed: ${error?.message ?? "unknown"}`);
      throw new BadRequestException(`Ingest failed and DLQ write failed: ${reason}`);
    }
    return { status: "dlq", dlq_id: data.id as string, reason };
  }
}
