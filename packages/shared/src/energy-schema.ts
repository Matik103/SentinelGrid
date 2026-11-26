import { z } from "zod";
import { CLASSIFICATIONS } from "./event-schema.js";

/** Metric keys constrained to match energy_measurements CHECK. */
export const ENERGY_METRIC_KEYS = [
  "active_power_kw",
  "apparent_power_kva",
  "reactive_power_kvar",
  "energy_kwh",
  "voltage_v",
  "current_a",
  "frequency_hz",
  "power_factor",
  "temperature_c",
  "humidity_pct",
  "fuel_consumption_lph",
  "fuel_level_pct",
  "battery_soc_pct",
  "battery_power_kw",
  "cooling_capacity_kw",
  "flow_rate_m3_h",
  "pressure_kpa",
  "pue",
] as const;

export const ENERGY_CANONICAL_UNITS: Record<(typeof ENERGY_METRIC_KEYS)[number], string> = {
  active_power_kw: "kW",
  apparent_power_kva: "kVA",
  reactive_power_kvar: "kvar",
  energy_kwh: "kWh",
  voltage_v: "V",
  current_a: "A",
  frequency_hz: "Hz",
  power_factor: "1",
  temperature_c: "°C",
  humidity_pct: "%",
  fuel_consumption_lph: "L/h",
  fuel_level_pct: "%",
  battery_soc_pct: "%",
  battery_power_kw: "kW",
  cooling_capacity_kw: "kW",
  flow_rate_m3_h: "m³/h",
  pressure_kpa: "kPa",
  pue: "ratio",
};

export const ENERGY_QUALITIES = ["good", "uncertain", "poor", "unknown"] as const;

/**
 * Versioned normalised measurement envelope for connector → API ingestion.
 * Never invent values; only validated hardware (or explicitly labelled non-real) readings.
 */
export const EnergyMeasurementEnvelopeSchema = z
  .object({
    schema_version: z.literal("1.0.0").default("1.0.0"),
    metric_key: z.enum(ENERGY_METRIC_KEYS),
    value: z.number().finite(),
    unit: z.string().min(1).max(16),
    measured_at: z.string().datetime({ offset: true }),
    quality: z.enum(ENERGY_QUALITIES).default("unknown"),
    source: z.string().min(1).max(200),
    source_event_id: z.string().min(1).max(200),
    classification: z.enum(CLASSIFICATIONS),
    facility_id: z.string().uuid(),
    asset_id: z.string().uuid().optional().nullable(),
    device_id: z.string().uuid().optional().nullable(),
    sensor_id: z.string().uuid().optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    const expected = ENERGY_CANONICAL_UNITS[value.metric_key];
    if (value.unit !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `unit for ${value.metric_key} must be ${expected}; refusing silent conversion`,
        path: ["unit"],
      });
    }
  });

export type EnergyMeasurementEnvelope = z.infer<typeof EnergyMeasurementEnvelopeSchema>;

export const EnergyMeasurementBatchSchema = z.object({
  connector_id: z.string().uuid(),
  measurements: z.array(EnergyMeasurementEnvelopeSchema).min(1).max(200),
});

export type EnergyMeasurementBatch = z.infer<typeof EnergyMeasurementBatchSchema>;
