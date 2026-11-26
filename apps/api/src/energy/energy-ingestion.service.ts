import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  EnergyMeasurementBatchSchema,
  EnergyMeasurementEnvelopeSchema,
  type EnergyMeasurementEnvelope,
} from "@sentinelgrid/shared";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";
import { IngestionService } from "../events/ingestion.service.js";
import { AnomalyEvaluationService } from "./anomaly-evaluation.service.js";

export type EnergyIngestResult = {
  accepted: number;
  deduplicated: number;
  measurement_ids: string[];
  event_ids: string[];
  anomalies_opened: number;
};

@Injectable()
export class EnergyIngestionService {
  private readonly log = new Logger(EnergyIngestionService.name);

  constructor(
    private readonly admin: SupabaseAdminService,
    private readonly events: IngestionService,
    private readonly anomalies: AnomalyEvaluationService,
  ) {}

  /**
   * Accept connector-authenticated measurements. Organisation is never taken from the body.
   * Writes ledger events first, then normalised rows; retries are idempotent on (org, source, source_event_id, metric_key).
   */
  async ingestFromConnector(
    organisationId: string,
    connectorId: string,
    raw: unknown,
  ): Promise<EnergyIngestResult> {
    const parsed = EnergyMeasurementBatchSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    if (parsed.data.connector_id !== connectorId) {
      throw new BadRequestException("connector_id must match the authenticated connector");
    }

    let accepted = 0;
    let deduplicated = 0;
    const measurementIds: string[] = [];
    const eventIds: string[] = [];
    let anomaliesOpened = 0;

    for (const item of parsed.data.measurements) {
      const envelope = EnergyMeasurementEnvelopeSchema.parse(item);
      await this.assertTenantRefs(organisationId, envelope);

      const eventResult = await this.events.ingest(
        {
          organisation_id: organisationId,
          facility_id: envelope.facility_id,
          asset_id: envelope.asset_id ?? null,
          device_id: envelope.device_id ?? null,
          sensor_id: envelope.sensor_id ?? null,
          connector_id: connectorId,
          event_type: `energy.measurement.${envelope.metric_key}`,
          occurred_at: envelope.measured_at,
          source: envelope.source,
          source_event_id: `${envelope.source_event_id}:${envelope.metric_key}`,
          schema_version: envelope.schema_version,
          normalised: {
            metric_key: envelope.metric_key,
            value: envelope.value,
            unit: envelope.unit,
            quality: envelope.quality,
          },
          units: { [envelope.metric_key]: envelope.unit },
          data_quality: envelope.quality,
          clock_quality: "unknown",
          classification: envelope.classification,
          original_payload: envelope,
        },
        { authorisedOrganisationId: organisationId },
      );

      if (eventResult.status === "dlq") {
        throw new BadRequestException(`energy measurement rejected to DLQ: ${eventResult.reason}`);
      }
      eventIds.push(eventResult.event_id);

      const row = {
        organisation_id: organisationId,
        facility_id: envelope.facility_id,
        asset_id: envelope.asset_id ?? null,
        device_id: envelope.device_id ?? null,
        sensor_id: envelope.sensor_id ?? null,
        event_id: eventResult.event_id,
        metric_key: envelope.metric_key,
        value: envelope.value,
        unit: envelope.unit,
        measured_at: envelope.measured_at,
        source: envelope.source,
        source_event_id: envelope.source_event_id,
        quality: envelope.quality,
        classification: envelope.classification,
        metadata: envelope.metadata ?? {},
      };

      const { data, error } = await this.admin.client
        .from("energy_measurements")
        .upsert(row, {
          onConflict: "organisation_id,source,source_event_id,metric_key",
          ignoreDuplicates: true,
        })
        .select("id")
        .maybeSingle();

      if (error) throw new BadRequestException(error.message);

      if (!data?.id) {
        // Duplicate path: fetch existing id for anomaly evaluation skip / reporting.
        const existing = await this.findExisting(organisationId, envelope);
        if (existing) {
          deduplicated += 1;
          measurementIds.push(existing);
          continue;
        }
        throw new BadRequestException("energy measurement upsert returned no id");
      }

      if (eventResult.status === "deduplicated") {
        deduplicated += 1;
      } else {
        accepted += 1;
      }
      measurementIds.push(data.id);

      if (envelope.classification === "real" && envelope.quality === "good") {
        const opened = await this.anomalies.evaluateMeasurement(organisationId, data.id);
        anomaliesOpened += opened;
      }
    }

    this.log.log(
      `energy ingest org=${organisationId} connector=${connectorId} accepted=${accepted} dedup=${deduplicated}`,
    );
    return {
      accepted,
      deduplicated,
      measurement_ids: measurementIds,
      event_ids: eventIds,
      anomalies_opened: anomaliesOpened,
    };
  }

  private async findExisting(
    organisationId: string,
    envelope: EnergyMeasurementEnvelope,
  ): Promise<string | null> {
    const { data } = await this.admin.client
      .from("energy_measurements")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("source", envelope.source)
      .eq("source_event_id", envelope.source_event_id)
      .eq("metric_key", envelope.metric_key)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }

  private async assertTenantRefs(
    organisationId: string,
    envelope: EnergyMeasurementEnvelope,
  ): Promise<void> {
    const { data: facility, error: facErr } = await this.admin.client
      .from("facilities")
      .select("id")
      .eq("id", envelope.facility_id)
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (facErr) throw new BadRequestException(facErr.message);
    if (!facility) throw new BadRequestException("facility_id is not in the connector organisation");

    if (envelope.asset_id) {
      const { data, error } = await this.admin.client
        .from("assets")
        .select("id")
        .eq("id", envelope.asset_id)
        .eq("organisation_id", organisationId)
        .eq("facility_id", envelope.facility_id)
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (!data) throw new BadRequestException("asset_id must belong to the same organisation and facility");
    }
    if (envelope.device_id) {
      const { data, error } = await this.admin.client
        .from("devices")
        .select("id")
        .eq("id", envelope.device_id)
        .eq("organisation_id", organisationId)
        .eq("facility_id", envelope.facility_id)
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (!data) throw new BadRequestException("device_id must belong to the same organisation and facility");
    }
    if (envelope.sensor_id) {
      const { data, error } = await this.admin.client
        .from("sensors")
        .select("id")
        .eq("id", envelope.sensor_id)
        .eq("organisation_id", organisationId)
        .eq("facility_id", envelope.facility_id)
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (!data) throw new BadRequestException("sensor_id must belong to the same organisation and facility");
    }
  }
}
