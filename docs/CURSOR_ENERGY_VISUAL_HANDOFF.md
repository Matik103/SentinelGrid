# SentinelGrid visual assets and energy foundation — Cursor handoff

Branch: `work/phase0-security-hardening`

## What is included on this branch

### Frontend
- `apps/web/src/AssetRegistryPage.tsx`: visual asset registry, category filtering, equipment profile, photo upload, provenance display, manufacturer/model/year and rated-value fields.
- `apps/web/src/EnergyDashboard.tsx`: facility-scoped energy view, real telemetry metrics, power trend, recent measurements and open anomaly findings.
- `apps/web/src/api.ts`: authenticated Supabase REST/Storage calls for private asset media and energy tables.
- `apps/web/src/App.tsx`: new Assets and Energy routes/navigation.
- `apps/web/src/app.css`: responsive asset cards, equipment profiles, energy charts and finding panels.

### API
- `apps/api/src/registry/registry.service.ts`: asset list/create now includes manufacturer, model, serial number, manufactured year, rated power/capacity and JSON specifications.

### Supabase
Apply `supabase/migrations/20261126090000_energy_intelligence_asset_media.sql` after the existing Phase 0 migrations.

It adds:
- Rich asset/device specifications.
- `asset_media` metadata with image provenance, primary image, asset-match verification and attribution.
- Private `asset-media` Storage bucket with organisation/facility-scoped Storage RLS.
- `energy_measurements` normalized telemetry table and time-series indexes.
- `energy_anomalies` table with baseline/observed values, severity, rule key and review lifecycle.
- `energy.read` permission mapped to tenant roles. Energy writes are service-role only.

No live measurements or fictitious equipment inventory are seeded.

## Required backend completion

### 1. Apply and validate migrations
1. Apply migrations through `20261126090000_energy_intelligence_asset_media.sql` to the intended Supabase project.
2. Run the whole migration chain from a fresh local database and against a safe remote/staging database.
3. Verify all policies as an ordinary authenticated user, a read-only member, a facility manager assigned to one facility, an unassigned facility manager and service_role.
4. Verify the private `asset-media` bucket is not public and a member cannot read/write another organisation's image objects or another facility's objects.
5. Run the repository audit and migration/security tests. Do not mark migration complete until evidence exists.

### 2. Finish asset metadata and image workflows
- Confirm the updated `RegistryService` compiles and validates the added fields.
- Ensure category-specific JSON specifications are validated and size-limited (do not accept arbitrary unbounded JSON).
- Add update/patch support for asset identity and specifications, protected by `asset.write`.
- Ensure asset media CRUD supports primary-image replacement atomically (one primary per asset), with cleanup of orphaned storage objects.
- Add a controlled manufacturer catalogue workflow: match exact manufacturer + model/reference, store source URL and attribution, and set `asset_match_verified` only after an explicit exact-match verification. A representative photo must never be labelled as the customer's exact asset.
- Use signed URLs for private uploaded photos; do not make the bucket public or expose service-role credentials in the browser.
- Validate external image URLs as HTTPS and avoid redirect-based trust assumptions.

### 3. Implement real energy ingestion
The edge connector currently has Modbus/MQTT/OPC UA connectivity-probe scaffolding. It does not yet read real register/tag/topic measurements. Do not treat probe reachability as energy telemetry.

Implement these steps:
1. Define a versioned normalized measurement envelope. Recommended shape:
   ```json
   {
     "metric_key": "active_power_kw",
     "value": 18.42,
     "unit": "kW",
     "measured_at": "2026-11-26T08:30:00Z",
     "quality": "good",
     "source": "modbus-meter-01",
     "source_event_id": "meter-01:sequence-or-device-timestamp",
     "asset_id": "UUID",
     "device_id": "UUID",
     "sensor_id": "UUID",
     "metadata": {
       "register_reference": "documented-register-map",
       "sampling_interval_seconds": 10
     }
   }
   ```
2. Keep tenant identity derived from the authenticated connector row. A connector must never select an arbitrary organisation.
3. Validate that facility, asset, device and sensor references belong to the connector's organisation and facility.
4. Write the accepted source event to the append-only event ledger, then write normalized measurements with the corresponding `event_id`. Use source/idempotency keys; retries must not duplicate readings.
5. Preserve units, timestamp, device clock quality, data quality and classification. Only actual, verified hardware readings should be classified `real`; replayed/simulated/synthetic readings must remain labelled.
6. Keep writes service-side. The browser must never insert raw energy measurements or anomaly rows.
7. Do not infer missing kW, kWh, voltage, temperature or fuel values. Do not silently convert incompatible units.

Supported initial metric keys are constrained by the SQL CHECK on `energy_measurements.metric_key`. If expanding the catalog, update the migration and validators together.

### 4. Implement explainable anomaly generation
- Baseline by asset/metric with seasonality and operating schedule where enough history exists.
- Start with transparent rules: sustained demand deviation, unexpected overnight load, abnormal power factor, temperature/energy divergence, missing telemetry, battery/UPS abnormality and fuel-rate deviation.
- Persist the measurement reference, baseline, observed value, deviation, rule version/key and explanation in `energy_anomalies`.
- Distinguish data-quality issues from operational anomalies and cyber-security indicators.
- Keep findings reviewable: open → acknowledged → resolved/false_positive. Record review actions in the audit log.
- Do not claim an attack solely because energy changed. Correlate with device, connector, control and access events.

### 5. Finish identity/authentication and browser access
- The current UI reads its bearer token through `authToken()` from `VITE_DEV_ACCESS_TOKEN` or `localStorage.sg_access_token`. Implement the production Supabase Auth sign-in/session/refresh flow before customer rollout; remove dev-token reliance in production.
- Ensure the authenticated user's JWT is used for user-scoped REST and Storage reads. The public anon key may be embedded; the service-role key must remain API-only.
- The energy view reads `energy_measurements` and `energy_anomalies` through Supabase REST and relies on the new RLS policies.
- The asset image UI reads `asset_media` and uploads to private Storage using signed URLs / Storage API.
- Consider adding NestJS read endpoints for telemetry/anomalies to centralize validation and pagination. If implemented, switch the web client to those routes consistently.

### 6. Frontend follow-through
- Add asset edit flow, media gallery (primary/detail/nameplate), device and sensor profiles, and exact manufacturer catalogue lookup.
- Add a dedicated detailed energy profile for each asset, with metric selectors, date ranges, comparisons and export.
- Show freshness, source, unit, quality and classification beside every value.
- Show gaps clearly: not configured, no readings, stale readings, poor-quality readings, or measurement source offline.
- Verify responsive layouts and keyboard/accessibility behaviour.

## Non-negotiable product/security rules
- Read-only OT by default. No remote write/control actions in this phase.
- Never present representative/AI-generated imagery as an actual customer's equipment.
- Never display mocked measurements as live telemetry.
- Never expose service-role keys or raw connector secrets to the browser.
- Tenant and facility boundaries must be enforced by RLS and server-side authorization, not by client filters alone.
- Energy efficiency savings claims require a measured baseline and documented methodology.
- A hash verifies stored bytes/integrity, not the truthfulness of a sensor reading.

## Current handoff boundary
The branch contains the schema foundation, initial UI, private image client and richer asset registry fields. Remote Supabase migration application, production auth, live Modbus/MQTT/OPC UA reads, normalization/ingestion, anomaly generation and end-to-end tests still require backend completion and verification.
