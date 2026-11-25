import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { EventIngestSchema, type EventIngestInput } from "@sentinelgrid/shared";
import { createHash } from "node:crypto";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";
import { PayloadStorageService } from "../evidence/payload-storage.service.js";

export type IngestResult =
  | { status: "accepted"; event_id: string; deduplicated: false; payload_object_id?: string }
  | { status: "deduplicated"; event_id: string; deduplicated: true }
  | { status: "dlq"; dlq_id: string; reason: string };

type IngestOptions = { replay?: boolean; authorisedOrganisationId: string };

@Injectable()
export class IngestionService {
  private readonly log = new Logger(IngestionService.name);

  constructor(
    private readonly admin: SupabaseAdminService,
    private readonly payloads: PayloadStorageService,
  ) {}

  async ingest(raw: unknown, opts: IngestOptions): Promise<IngestResult> {
    const organisationId = opts.authorisedOrganisationId;
    const parsed = EventIngestSchema.safeParse(raw);
    if (!parsed.success) {
      return this.toDlq(organisationId, null, raw, `schema_validation: ${parsed.error.message}`);
    }
    const input = parsed.data;
    if (input.organisation_id !== organisationId) {
      throw new BadRequestException("Event organisation_id does not match the authorised tenant");
    }
    if (opts.replay) input.classification = "replayed";

    // Check the idempotency key before writing any external payload bytes.
    const existing = await this.findExisting(input);
    if (existing) return { status: "deduplicated", event_id: existing, deduplicated: true };

    let stored: Awaited<ReturnType<PayloadStorageService["storeRaw"]>> | undefined;
    try {
      if (input.original_payload !== undefined) {
        stored = await this.payloads.storeRaw(
          organisationId,
          input.original_payload,
          { classification: input.classification },
        );
      }

      const row = {
        organisation_id: organisationId,
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
        original_payload_ref: stored?.object_key ?? null,
      };

      const { data, error } = await this.admin.client
        .from("events")
        .insert(row)
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505") {
          const raced = await this.findExisting(input);
          if (raced) {
            if (stored) await this.payloads.deleteStored(organisationId, stored.id);
            return { status: "deduplicated", event_id: raced, deduplicated: true };
          }
        }
        if (stored) await this.payloads.deleteStored(organisationId, stored.id);
        return this.toDlq(organisationId, input, raw, error.message);
      }
      if (!data?.id) {
        if (stored) await this.payloads.deleteStored(organisationId, stored.id);
        return this.toDlq(organisationId, input, raw, "insert_returned_no_id");
      }

      return {
        status: "accepted",
        event_id: data.id as string,
        deduplicated: false,
        payload_object_id: stored?.id,
      };
    } catch (err) {
      if (stored) {
        try { await this.payloads.deleteStored(organisationId, stored.id); }
        catch (cleanupError) { this.log.error(`orphan payload cleanup failed: ${String(cleanupError)}`); }
      }
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`ingest failure: ${message}`);
      return this.toDlq(organisationId, input, raw, message);
    }
  }

  async replayFromDlq(dlqId: string, organisationId: string): Promise<IngestResult> {
    // Conditional claim makes replay single-consumer. Tenant filter is mandatory
    // on both the claim and final update; the service-role client bypasses RLS.
    const { data: claimed, error: claimError } = await this.admin.client
      .from("event_ingestion_dlq")
      .update({
        status: "processing",
        replay_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", dlqId)
      .eq("organisation_id", organisationId)
      .or(`status.eq.open,and(status.eq.processing,replay_started_at.lt.${new Date(Date.now() - 5 * 60 * 1000).toISOString()})`)
      .select("*")
      .maybeSingle();
    if (claimError || !claimed) {
      throw new BadRequestException("Open DLQ entry not found for this organisation");
    }

    let result: IngestResult;
    try {
      const raw = claimed.raw_body ?? {};
      result = await this.ingest(raw, {
        replay: true,
        authorisedOrganisationId: organisationId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const { error: releaseError } = await this.admin.client
        .from("event_ingestion_dlq")
        .update({ status: "open", replay_started_at: null, attempt_count: (claimed.attempt_count ?? 1) + 1, last_error: reason, updated_at: new Date().toISOString() })
        .eq("id", dlqId)
        .eq("organisation_id", organisationId)
        .eq("status", "processing");
      if (releaseError) this.log.error(`failed to release DLQ claim: ${releaseError.message}`);
      throw error;
    }

    const finalStatus = result.status === "dlq" ? "open" : "replayed";
    const { data: updated, error: updateError } = await this.admin.client
      .from("event_ingestion_dlq")
      .update({
        status: finalStatus,
        attempt_count: (claimed.attempt_count ?? 1) + 1,
        last_error: result.status === "dlq" ? result.reason : null,
        replay_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dlqId)
      .eq("organisation_id", organisationId)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      throw new BadRequestException("Replay completed but DLQ state update failed; operator reconciliation required");
    }
    return result;
  }

  private async findExisting(input: EventIngestInput): Promise<string | null> {
    const { data, error } = await this.admin.client
      .from("events")
      .select("id")
      .eq("organisation_id", input.organisation_id)
      .eq("source", input.source)
      .eq("source_event_id", input.source_event_id)
      .maybeSingle();
    if (error) throw new Error(`Idempotency lookup failed: ${error.message}`);
    return (data?.id as string) ?? null;
  }

  private async toDlq(
    organisationId: string,
    input: EventIngestInput | null,
    raw: unknown,
    reason: string,
  ): Promise<IngestResult> {
    // Keep the tenant association mandatory. Avoid duplicating original binary/raw
    // payloads in Postgres; only the structured event envelope is retained here.
    const safeRaw = raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>), organisation_id: organisationId, original_payload: undefined }
      : { organisation_id: organisationId, rejected_value_type: typeof raw };
    const serialised = JSON.stringify(safeRaw);
    const digest = createHash("sha256").update(serialised ?? "null").digest("hex");
    const { data, error } = await this.admin.client
      .from("event_ingestion_dlq")
      .insert({
        organisation_id: organisationId,
        connector_id: input?.connector_id ?? null,
        source: input?.source ?? null,
        source_event_id: input?.source_event_id ?? null,
        failure_reason: reason.slice(0, 2000),
        payload_ref: digest,
        raw_body: safeRaw,
        schema_version: input?.schema_version ?? null,
        status: "open",
      })
      .select("id")
      .single();
    if (error || !data?.id) {
      this.log.error(`DLQ write failed: ${error?.message ?? "unknown"}`);
      throw new BadRequestException("Ingest failed and DLQ persistence failed");
    }
    return { status: "dlq", dlq_id: data.id as string, reason };
  }
}
