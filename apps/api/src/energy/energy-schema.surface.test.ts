import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EnergyMeasurementBatchSchema, EnergyMeasurementEnvelopeSchema } from "@sentinelgrid/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("energy handoff surfaces", () => {
  it("rejects unit conversion attempts in the shared envelope", () => {
    assert.throws(() =>
      EnergyMeasurementEnvelopeSchema.parse({
        metric_key: "voltage_v",
        value: 400,
        unit: "kV",
        measured_at: "2026-11-26T08:30:00Z",
        quality: "good",
        source: "meter",
        source_event_id: "1",
        classification: "real",
        facility_id: "11111111-1111-1111-1111-111111111111",
      }),
    );
  });

  it("requires connector_id on batch ingest payloads", () => {
    const parsed = EnergyMeasurementBatchSchema.safeParse({
      measurements: [
        {
          metric_key: "active_power_kw",
          value: 1,
          unit: "kW",
          measured_at: "2026-11-26T08:30:00Z",
          quality: "good",
          source: "meter",
          source_event_id: "1",
          classification: "real",
          facility_id: "11111111-1111-1111-1111-111111111111",
        },
      ],
    });
    assert.equal(parsed.success, false);
  });

  it("keeps connector energy ingest and anomaly modules present", () => {
    const ingest = readFileSync(resolve("src/energy/energy-ingestion.service.ts"), "utf8");
    const anomaly = readFileSync(resolve("src/energy/anomaly-evaluation.service.ts"), "utf8");
    assert.match(ingest, /ingestFromConnector/);
    assert.match(ingest, /authorisedOrganisationId/);
    assert.match(anomaly, /sustainedDemandDeviation/);
    assert.match(anomaly, /classification !== "real"/);
  });
});
