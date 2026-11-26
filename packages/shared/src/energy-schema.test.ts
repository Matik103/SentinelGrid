import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EnergyMeasurementEnvelopeSchema } from "./energy-schema.js";

describe("EnergyMeasurementEnvelopeSchema", () => {
  it("accepts a canonical real measurement", () => {
    const parsed = EnergyMeasurementEnvelopeSchema.parse({
      metric_key: "active_power_kw",
      value: 18.42,
      unit: "kW",
      measured_at: "2026-11-26T08:30:00Z",
      quality: "good",
      source: "modbus-meter-01",
      source_event_id: "meter-01:1",
      classification: "real",
      facility_id: "11111111-1111-1111-1111-111111111111",
    });
    assert.equal(parsed.schema_version, "1.0.0");
    assert.equal(parsed.unit, "kW");
  });

  it("rejects incompatible units without converting", () => {
    assert.throws(() =>
      EnergyMeasurementEnvelopeSchema.parse({
        metric_key: "active_power_kw",
        value: 18420,
        unit: "W",
        measured_at: "2026-11-26T08:30:00Z",
        quality: "good",
        source: "modbus-meter-01",
        source_event_id: "meter-01:1",
        classification: "real",
        facility_id: "11111111-1111-1111-1111-111111111111",
      }),
    );
  });
});
