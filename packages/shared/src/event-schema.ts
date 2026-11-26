import { z } from "zod";

export const CLASSIFICATIONS = [
  "real",
  "simulated",
  "replayed",
  "synthetic",
] as const;

export const EventIngestSchema = z.object({
  organisation_id: z.string().uuid(),
  facility_id: z.string().uuid().optional().nullable(),
  asset_id: z.string().uuid().optional().nullable(),
  device_id: z.string().uuid().optional().nullable(),
  sensor_id: z.string().uuid().optional().nullable(),
  connector_id: z.string().uuid().optional().nullable(),
  event_type: z.string().min(1).max(200),
  occurred_at: z.string().datetime({ offset: true }),
  source: z.string().min(1).max(200),
  source_event_id: z.string().min(1).max(200),
  schema_version: z.string().default("0.1.0"),
  normalised: z.record(z.string(), z.unknown()).default({}),
  units: z.record(z.string(), z.unknown()).default({}),
  data_quality: z.enum(["good", "uncertain", "poor", "unknown"]).default("unknown"),
  clock_quality: z.enum(["synced", "drift", "unknown"]).default("unknown"),
  classification: z.enum(CLASSIFICATIONS).default("real"),
  original_payload: z.unknown().optional(),
});

export type EventIngestInput = z.infer<typeof EventIngestSchema>;
