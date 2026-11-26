-- SentinelGrid: visual asset intelligence + energy telemetry foundation.
-- Forward-only. Apply after the Phase 0 registry/security migrations.
-- Live readings are never seeded here; all measurements must come from real sources.

BEGIN;

-- ---------------------------------------------------------------------------
-- Rich equipment identity and typed specifications
-- ---------------------------------------------------------------------------

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS manufactured_year smallint
    CHECK (manufactured_year BETWEEN 1900 AND 2100),
  ADD COLUMN IF NOT EXISTS rated_power_kw numeric(14,3)
    CHECK (rated_power_kw IS NULL OR rated_power_kw >= 0),
  ADD COLUMN IF NOT EXISTS rated_capacity_kva numeric(14,3)
    CHECK (rated_capacity_kva IS NULL OR rated_capacity_kva >= 0),
  ADD COLUMN IF NOT EXISTS specifications jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS manufactured_year smallint
    CHECK (manufactured_year BETWEEN 1900 AND 2100),
  ADD COLUMN IF NOT EXISTS rated_power_kw numeric(14,3)
    CHECK (rated_power_kw IS NULL OR rated_power_kw >= 0),
  ADD COLUMN IF NOT EXISTS rated_capacity_kva numeric(14,3)
    CHECK (rated_capacity_kva IS NULL OR rated_capacity_kva >= 0),
  ADD COLUMN IF NOT EXISTS specifications jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.assets.specifications IS
  'Category-specific, non-secret equipment specifications. Keep canonical manufacturer/model/year and rated values in dedicated columns.';
COMMENT ON COLUMN public.devices.specifications IS
  'Category-specific, non-secret device specifications.';

-- ---------------------------------------------------------------------------
-- Asset photographs and manufacturer imagery
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.asset_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  storage_path text,
  external_url text,
  media_kind text NOT NULL DEFAULT 'primary'
    CHECK (media_kind IN ('primary', 'detail', 'nameplate', 'manual', 'diagram')),
  provenance text NOT NULL
    CHECK (provenance IN ('customer_upload', 'manufacturer_catalogue', 'representative')),
  is_primary boolean NOT NULL DEFAULT false,
  asset_match_verified boolean NOT NULL DEFAULT false,
  original_filename text,
  content_type text,
  byte_length bigint CHECK (byte_length IS NULL OR byte_length >= 0),
  manufacturer_reference text,
  attribution text,
  caption text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_media_external_https CHECK (external_url IS NULL OR external_url ~ '^https://'),
  CONSTRAINT asset_media_verified_source CHECK (NOT asset_match_verified OR provenance IN ('customer_upload', 'manufacturer_catalogue')),
  CONSTRAINT asset_media_has_source CHECK (
    (storage_path IS NOT NULL AND external_url IS NULL)
    OR (storage_path IS NULL AND external_url IS NOT NULL)
  ),
  CONSTRAINT asset_media_storage_path_safe CHECK (
    storage_path IS NULL OR (
      storage_path !~ '^/'
      AND position('..' in storage_path) = 0
      AND split_part(storage_path, '/', 1) = organisation_id::text
      AND split_part(storage_path, '/', 2) = asset_id::text
    )
  ),
  CONSTRAINT asset_media_asset_same_org_fk
    FOREIGN KEY (organisation_id, asset_id)
    REFERENCES public.assets (organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS asset_media_org_asset_created_idx
  ON public.asset_media (organisation_id, asset_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS asset_media_one_primary_per_asset
  ON public.asset_media (organisation_id, asset_id)
  WHERE is_primary;

ALTER TABLE public.asset_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_media_select ON public.asset_media;
CREATE POLICY asset_media_select ON public.asset_media
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin() OR (
    public.has_org_permission(organisation_id, 'asset.read')
    AND EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.organisation_id = asset_media.organisation_id
        AND a.id = asset_media.asset_id
        AND (
          NOT public.is_facility_manager(organisation_id)
          OR public.has_facility_access(organisation_id, a.facility_id)
        )
    )
    )
  );

DROP POLICY IF EXISTS asset_media_insert ON public.asset_media;
CREATE POLICY asset_media_insert ON public.asset_media
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin() OR (
    public.has_org_permission(organisation_id, 'asset.write')
    AND EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.organisation_id = asset_media.organisation_id
        AND a.id = asset_media.asset_id
        AND (
          NOT public.is_facility_manager(organisation_id)
          OR public.has_facility_access(organisation_id, a.facility_id)
        )
    )
    )
  );

DROP POLICY IF EXISTS asset_media_update ON public.asset_media;
CREATE POLICY asset_media_update ON public.asset_media
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin() OR (
    public.has_org_permission(organisation_id, 'asset.write')
    AND EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.organisation_id = asset_media.organisation_id
        AND a.id = asset_media.asset_id
        AND (NOT public.is_facility_manager(organisation_id)
          OR public.has_facility_access(organisation_id, a.facility_id))
    )
    )
  )
  WITH CHECK (
    public.is_platform_admin() OR (
    public.has_org_permission(organisation_id, 'asset.write')
    AND EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.organisation_id = asset_media.organisation_id
        AND a.id = asset_media.asset_id
        AND (NOT public.is_facility_manager(organisation_id)
          OR public.has_facility_access(organisation_id, a.facility_id))
    )
    )
  );

DROP POLICY IF EXISTS asset_media_delete ON public.asset_media;
CREATE POLICY asset_media_delete ON public.asset_media
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin() OR (
    public.has_org_permission(organisation_id, 'asset.write')
    AND EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.organisation_id = asset_media.organisation_id
        AND a.id = asset_media.asset_id
        AND (NOT public.is_facility_manager(organisation_id)
          OR public.has_facility_access(organisation_id, a.facility_id))
    )
    )
  );

REVOKE ALL ON TABLE public.asset_media FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.asset_media TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.asset_media TO service_role;

-- Private bucket: uploaded equipment photographs are tenant data, not public files.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'asset-media',
  'asset-media',
  false,
  15728640,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS asset_media_storage_select ON storage.objects;
CREATE POLICY asset_media_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'asset-media'
    AND (public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.organisation_id::text = (storage.foldername(name))[1]
        AND a.id::text = (storage.foldername(name))[2]
        AND public.has_org_permission(a.organisation_id, 'asset.read')
        AND (
          NOT public.is_facility_manager(a.organisation_id)
          OR public.has_facility_access(a.organisation_id, a.facility_id)
        )
    )
    )
  );

DROP POLICY IF EXISTS asset_media_storage_insert ON storage.objects;
CREATE POLICY asset_media_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'asset-media'
    AND (public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.organisation_id::text = (storage.foldername(name))[1]
        AND a.id::text = (storage.foldername(name))[2]
        AND public.has_org_permission(a.organisation_id, 'asset.write')
        AND (
          NOT public.is_facility_manager(a.organisation_id)
          OR public.has_facility_access(a.organisation_id, a.facility_id)
        )
    )
    )
  );

DROP POLICY IF EXISTS asset_media_storage_update ON storage.objects;
CREATE POLICY asset_media_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'asset-media'
    AND (public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.organisation_id::text = (storage.foldername(name))[1]
        AND a.id::text = (storage.foldername(name))[2]
        AND public.has_org_permission(a.organisation_id, 'asset.write')
        AND (NOT public.is_facility_manager(a.organisation_id)
          OR public.has_facility_access(a.organisation_id, a.facility_id))
    )
    )
  )
  WITH CHECK (
    bucket_id = 'asset-media'
    AND (public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.organisation_id::text = (storage.foldername(name))[1]
        AND a.id::text = (storage.foldername(name))[2]
        AND public.has_org_permission(a.organisation_id, 'asset.write')
        AND (NOT public.is_facility_manager(a.organisation_id)
          OR public.has_facility_access(a.organisation_id, a.facility_id))
    )
    )
  );

DROP POLICY IF EXISTS asset_media_storage_delete ON storage.objects;
CREATE POLICY asset_media_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'asset-media'
    AND (public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.organisation_id::text = (storage.foldername(name))[1]
        AND a.id::text = (storage.foldername(name))[2]
        AND public.has_org_permission(a.organisation_id, 'asset.write')
        AND (NOT public.is_facility_manager(a.organisation_id)
          OR public.has_facility_access(a.organisation_id, a.facility_id))
    )
    )
  );

-- Composite uniqueness lets telemetry enforce both tenant and facility identity.
ALTER TABLE public.assets
  ADD CONSTRAINT assets_org_facility_id_key UNIQUE (organisation_id, facility_id, id);
ALTER TABLE public.devices
  ADD CONSTRAINT devices_org_facility_id_key UNIQUE (organisation_id, facility_id, id);
ALTER TABLE public.sensors
  ADD CONSTRAINT sensors_org_facility_id_key UNIQUE (organisation_id, facility_id, id);

-- ---------------------------------------------------------------------------
-- Normalised energy telemetry. Source units are explicit; no inferred readings.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.energy_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL,
  asset_id uuid,
  device_id uuid,
  sensor_id uuid,
  event_id uuid,
  metric_key text NOT NULL CHECK (metric_key IN (
    'active_power_kw',
    'apparent_power_kva',
    'reactive_power_kvar',
    'energy_kwh',
    'voltage_v',
    'current_a',
    'frequency_hz',
    'power_factor',
    'temperature_c',
    'humidity_pct',
    'fuel_consumption_lph',
    'fuel_level_pct',
    'battery_soc_pct',
    'battery_power_kw',
    'cooling_capacity_kw',
    'flow_rate_m3_h',
    'pressure_kpa',
    'pue'
  )),
  value numeric(20,6) NOT NULL,
  unit text NOT NULL,
  measured_at timestamptz NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  quality text NOT NULL DEFAULT 'unknown'
    CHECK (quality IN ('good', 'uncertain', 'poor', 'unknown')),
  classification text NOT NULL
    CHECK (classification IN ('real', 'simulated', 'replayed', 'synthetic')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT energy_measurements_canonical_unit CHECK (
    (metric_key IN ('active_power_kw', 'battery_power_kw', 'cooling_capacity_kw') AND unit = 'kW')
    OR (metric_key = 'apparent_power_kva' AND unit = 'kVA')
    OR (metric_key = 'reactive_power_kvar' AND unit = 'kvar')
    OR (metric_key = 'energy_kwh' AND unit = 'kWh')
    OR (metric_key = 'voltage_v' AND unit = 'V')
    OR (metric_key = 'current_a' AND unit = 'A')
    OR (metric_key = 'frequency_hz' AND unit = 'Hz')
    OR (metric_key = 'power_factor' AND unit = '1')
    OR (metric_key = 'temperature_c' AND unit = '°C')
    OR (metric_key IN ('humidity_pct', 'fuel_level_pct', 'battery_soc_pct') AND unit = '%')
    OR (metric_key = 'fuel_consumption_lph' AND unit = 'L/h')
    OR (metric_key = 'flow_rate_m3_h' AND unit = 'm³/h')
    OR (metric_key = 'pressure_kpa' AND unit = 'kPa')
    OR (metric_key = 'pue' AND unit = 'ratio')
  ),
  CONSTRAINT energy_measurements_facility_same_org_fk
    FOREIGN KEY (organisation_id, facility_id)
    REFERENCES public.facilities (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT energy_measurements_asset_same_org_fk
    FOREIGN KEY (organisation_id, facility_id, asset_id)
    REFERENCES public.assets (organisation_id, facility_id, id),
  CONSTRAINT energy_measurements_device_same_org_fk
    FOREIGN KEY (organisation_id, facility_id, device_id)
    REFERENCES public.devices (organisation_id, facility_id, id),
  CONSTRAINT energy_measurements_sensor_same_org_fk
    FOREIGN KEY (organisation_id, facility_id, sensor_id)
    REFERENCES public.sensors (organisation_id, facility_id, id),
  CONSTRAINT energy_measurements_event_same_org_fk
    FOREIGN KEY (organisation_id, event_id)
    REFERENCES public.events (organisation_id, id),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, facility_id, id),
  UNIQUE (organisation_id, source, source_event_id, metric_key)
);

CREATE INDEX IF NOT EXISTS energy_measurements_org_time_idx
  ON public.energy_measurements (organisation_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS energy_measurements_facility_time_idx
  ON public.energy_measurements (organisation_id, facility_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS energy_measurements_asset_metric_time_idx
  ON public.energy_measurements (organisation_id, asset_id, metric_key, measured_at DESC)
  WHERE asset_id IS NOT NULL;

ALTER TABLE public.energy_measurements ENABLE ROW LEVEL SECURITY;

-- New read permission is available to all tenant roles. Writes remain service-only.
INSERT INTO public.permissions (key, description)
VALUES ('energy.read', 'Read energy measurements and energy security findings')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.key IN (
  'organisation_administrator',
  'facility_manager',
  'security_analyst',
  'operations_manager',
  'read_only_viewer'
)
AND p.key = 'energy.read'
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS energy_measurements_select ON public.energy_measurements;
CREATE POLICY energy_measurements_select ON public.energy_measurements
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin() OR (
    public.has_org_permission(organisation_id, 'energy.read')
    AND (
      NOT public.is_facility_manager(organisation_id)
      OR public.has_facility_access(organisation_id, facility_id)
    )
    )
  );

REVOKE ALL ON TABLE public.energy_measurements FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.energy_measurements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.energy_measurements TO service_role;

-- ---------------------------------------------------------------------------
-- Explainable anomaly findings. Detection provenance is retained for review.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.energy_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL,
  asset_id uuid,
  measurement_id uuid,
  event_id uuid,
  metric_key text NOT NULL CHECK (metric_key IN (
    'active_power_kw', 'apparent_power_kva', 'reactive_power_kvar', 'energy_kwh',
    'voltage_v', 'current_a', 'frequency_hz', 'power_factor', 'temperature_c',
    'humidity_pct', 'fuel_consumption_lph', 'fuel_level_pct', 'battery_soc_pct',
    'battery_power_kw', 'cooling_capacity_kw', 'flow_rate_m3_h', 'pressure_kpa', 'pue'
  )),
  severity text NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'false_positive')),
  title text NOT NULL,
  explanation text NOT NULL,
  observed_value numeric(20,6),
  baseline_value numeric(20,6),
  deviation_pct numeric(12,4),
  rule_key text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT energy_anomalies_facility_same_org_fk
    FOREIGN KEY (organisation_id, facility_id)
    REFERENCES public.facilities (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT energy_anomalies_asset_same_org_fk
    FOREIGN KEY (organisation_id, facility_id, asset_id)
    REFERENCES public.assets (organisation_id, facility_id, id),
  CONSTRAINT energy_anomalies_measurement_same_org_fk
    FOREIGN KEY (organisation_id, facility_id, measurement_id)
    REFERENCES public.energy_measurements (organisation_id, facility_id, id),
  CONSTRAINT energy_anomalies_event_same_org_fk
    FOREIGN KEY (organisation_id, event_id)
    REFERENCES public.events (organisation_id, id)
);

CREATE INDEX IF NOT EXISTS energy_anomalies_org_detected_idx
  ON public.energy_anomalies (organisation_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS energy_anomalies_org_status_severity_idx
  ON public.energy_anomalies (organisation_id, status, severity, detected_at DESC);

ALTER TABLE public.energy_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS energy_anomalies_select ON public.energy_anomalies;
CREATE POLICY energy_anomalies_select ON public.energy_anomalies
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin() OR (
    public.has_org_permission(organisation_id, 'energy.read')
    AND (
      NOT public.is_facility_manager(organisation_id)
      OR public.has_facility_access(organisation_id, facility_id)
    )
    )
  );

REVOKE ALL ON TABLE public.energy_anomalies FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.energy_anomalies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.energy_anomalies TO service_role;

COMMENT ON TABLE public.energy_measurements IS
  'Append-only, tenant-scoped normalised energy and equipment telemetry. Values are never fabricated by the platform.';
COMMENT ON TABLE public.energy_anomalies IS
  'Explainable findings generated from real telemetry; includes rule and baseline context.';
COMMENT ON TABLE public.asset_media IS
  'Tenant-scoped equipment images and supporting visual references with provenance.';
COMMENT ON COLUMN public.asset_media.asset_match_verified IS
  'True only when the image was confirmed to depict the exact registered equipment/model.';

COMMIT;
