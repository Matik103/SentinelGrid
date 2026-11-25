-- SentinelGrid Phase 0 foundation schema
-- Multi-tenant registry, connectors, events, evidence, audit
-- Idempotent where practical. RLS enabled; tenant from auth JWT claims / membership.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Current user's organisation IDs (never trust client-supplied tenant_id)
CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organisation_id
  FROM public.memberships
  WHERE user_id = auth.uid()
    AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.user_id = auth.uid()
      AND m.status = 'active'
      AND r.key = 'platform_administrator'
  );
$$;

-- ---------------------------------------------------------------------------
-- Auth / tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'archived')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,
  display_name text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'invited')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles (id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invited', 'revoked')),
  invited_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id)
);

CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON public.memberships (user_id);
CREATE INDEX IF NOT EXISTS memberships_org_id_idx ON public.memberships (organisation_id);

-- ---------------------------------------------------------------------------
-- Infrastructure registry: Facility → Zone → Asset → Device → Sensor
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, code)
);

CREATE TABLE IF NOT EXISTS public.zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities (id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities (id) ON DELETE CASCADE,
  zone_id uuid REFERENCES public.zones (id) ON DELETE SET NULL,
  parent_asset_id uuid REFERENCES public.assets (id) ON DELETE SET NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'industrial'
    CHECK (category IN (
      'electrical', 'generators', 'solar', 'battery', 'hvac',
      'refrigeration', 'pumps_motors', 'industrial', 'network', 'bms', 'other'
    )),
  manufacturer text,
  model text,
  serial_number text,
  criticality text NOT NULL DEFAULT 'medium'
    CHECK (criticality IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'commissioning', 'maintenance', 'archived')),
  installed_at date,
  commissioned_at date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities (id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets (id) ON DELETE SET NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'network'
    CHECK (category IN (
      'electrical', 'generators', 'solar', 'battery', 'hvac',
      'refrigeration', 'pumps_motors', 'industrial', 'network', 'bms', 'other'
    )),
  manufacturer text,
  model text,
  serial_number text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'offline', 'maintenance', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sensors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities (id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets (id) ON DELETE SET NULL,
  device_id uuid REFERENCES public.devices (id) ON DELETE SET NULL,
  name text NOT NULL,
  sensor_type text NOT NULL,
  unit text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'offline', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS facilities_org_idx ON public.facilities (organisation_id);
CREATE INDEX IF NOT EXISTS zones_org_facility_idx ON public.zones (organisation_id, facility_id);
CREATE INDEX IF NOT EXISTS assets_org_facility_idx ON public.assets (organisation_id, facility_id);
CREATE INDEX IF NOT EXISTS devices_org_facility_idx ON public.devices (organisation_id, facility_id);
CREATE INDEX IF NOT EXISTS sensors_org_facility_idx ON public.sensors (organisation_id, facility_id);

-- ---------------------------------------------------------------------------
-- Connectors
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  facility_id uuid REFERENCES public.facilities (id) ON DELETE SET NULL,
  name text NOT NULL,
  connector_uid text NOT NULL,
  status text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'active', 'degraded', 'revoked', 'archived')),
  version text,
  protocols text[] NOT NULL DEFAULT '{}',
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_heartbeat_at timestamptz,
  last_successful_sync_at timestamptz,
  credential_status text NOT NULL DEFAULT 'none'
    CHECK (credential_status IN ('none', 'issued', 'rotated', 'revoked')),
  credential_revoked_at timestamptz,
  connection_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, connector_uid)
);

CREATE INDEX IF NOT EXISTS connectors_org_idx ON public.connectors (organisation_id);

-- ---------------------------------------------------------------------------
-- Events (ledger) + evidence
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  facility_id uuid REFERENCES public.facilities (id) ON DELETE SET NULL,
  asset_id uuid REFERENCES public.assets (id) ON DELETE SET NULL,
  device_id uuid REFERENCES public.devices (id) ON DELETE SET NULL,
  sensor_id uuid REFERENCES public.sensors (id) ON DELETE SET NULL,
  connector_id uuid REFERENCES public.connectors (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  source_event_id text,
  schema_version text NOT NULL DEFAULT '0.1.0',
  normalised jsonb NOT NULL DEFAULT '{}'::jsonb,
  units jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_quality text NOT NULL DEFAULT 'unknown'
    CHECK (data_quality IN ('good', 'uncertain', 'poor', 'unknown')),
  clock_quality text NOT NULL DEFAULT 'unknown'
    CHECK (clock_quality IN ('synced', 'drift', 'unknown')),
  classification text NOT NULL DEFAULT 'real'
    CHECK (classification IN ('real', 'simulated', 'replayed', 'synthetic')),
  integrity_status text NOT NULL DEFAULT 'unverified'
    CHECK (integrity_status IN ('unverified', 'hashed', 'chained', 'verified', 'failed')),
  original_payload_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, source, source_event_id)
);

CREATE INDEX IF NOT EXISTS events_org_occurred_idx ON public.events (organisation_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_org_type_idx ON public.events (organisation_id, event_type);
CREATE INDEX IF NOT EXISTS events_org_asset_idx ON public.events (organisation_id, asset_id);

CREATE TABLE IF NOT EXISTS public.evidence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events (id) ON DELETE SET NULL,
  payload_sha256 text NOT NULL,
  payload_ref text NOT NULL,
  previous_hash text,
  chain_hash text,
  integrity_status text NOT NULL DEFAULT 'hashed'
    CHECK (integrity_status IN ('hashed', 'chained', 'verified', 'failed')),
  verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_org_event_idx ON public.evidence_records (organisation_id, event_id);

CREATE TABLE IF NOT EXISTS public.evidence_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  checkpoint_hash text NOT NULL,
  signature text,
  range_start timestamptz NOT NULL,
  range_end timestamptz NOT NULL,
  storage_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES public.organisations (id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx ON public.audit_logs (organisation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organisations', 'profiles', 'memberships', 'facilities', 'zones',
    'assets', 'devices', 'sensors', 'connectors'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON public.%I;
       CREATE TRIGGER set_updated_at
       BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Seed system roles (idempotent)
-- ---------------------------------------------------------------------------

INSERT INTO public.roles (key, name, description) VALUES
  ('platform_administrator', 'Platform administrator', 'Cross-tenant platform ops'),
  ('organisation_administrator', 'Organisation administrator', 'Org-wide admin'),
  ('facility_manager', 'Facility manager', 'Facility-scoped ops'),
  ('security_analyst', 'Security analyst', 'Security/investigation views'),
  ('operations_manager', 'Operations manager', 'Operations views'),
  ('read_only_viewer', 'Read-only viewer', 'Read access only')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.permissions (key, description) VALUES
  ('org.read', 'Read organisation'),
  ('org.admin', 'Administer organisation'),
  ('facility.read', 'Read facilities'),
  ('facility.write', 'Write facilities'),
  ('asset.read', 'Read assets/devices/sensors'),
  ('asset.write', 'Write assets/devices/sensors'),
  ('connector.read', 'Read connectors'),
  ('connector.write', 'Manage connectors'),
  ('event.read', 'Read events'),
  ('event.ingest', 'Ingest events'),
  ('evidence.read', 'Read evidence'),
  ('evidence.verify', 'Verify evidence'),
  ('audit.read', 'Read audit logs'),
  ('user.manage', 'Manage memberships')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-applied
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'organisations','profiles','roles','permissions','role_permissions',
        'memberships','facilities','zones','assets','devices','sensors',
        'connectors','events','evidence_records','evidence_checkpoints','audit_logs'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Roles / permissions: readable by authenticated users
CREATE POLICY roles_select ON public.roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY permissions_select ON public.permissions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY role_permissions_select ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

-- Profiles: users see self; platform admin sees all
CREATE POLICY profiles_select_self ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin());
CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin());

-- Organisations: members only
CREATE POLICY organisations_select ON public.organisations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());
CREATE POLICY organisations_update ON public.organisations
  FOR UPDATE TO authenticated
  USING (id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());
CREATE POLICY organisations_insert ON public.organisations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin() OR true);
-- Note: org creation allowed for authenticated; membership must be created server-side.

CREATE POLICY memberships_select ON public.memberships
  FOR SELECT TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR user_id = auth.uid() OR public.is_platform_admin());
CREATE POLICY memberships_write ON public.memberships
  FOR ALL TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

-- Tenant-owned tables share the same pattern
CREATE POLICY facilities_tenant ON public.facilities
  FOR ALL TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

CREATE POLICY zones_tenant ON public.zones
  FOR ALL TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

CREATE POLICY assets_tenant ON public.assets
  FOR ALL TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

CREATE POLICY devices_tenant ON public.devices
  FOR ALL TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

CREATE POLICY sensors_tenant ON public.sensors
  FOR ALL TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

CREATE POLICY connectors_tenant ON public.connectors
  FOR ALL TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

CREATE POLICY events_tenant ON public.events
  FOR ALL TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

CREATE POLICY evidence_tenant ON public.evidence_records
  FOR ALL TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

CREATE POLICY evidence_checkpoints_tenant ON public.evidence_checkpoints
  FOR ALL TO authenticated
  USING (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin())
  WITH CHECK (organisation_id IN (SELECT public.current_user_org_ids()) OR public.is_platform_admin());

CREATE POLICY audit_logs_tenant ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    organisation_id IN (SELECT public.current_user_org_ids())
    OR organisation_id IS NULL AND public.is_platform_admin()
    OR public.is_platform_admin()
  );
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    organisation_id IN (SELECT public.current_user_org_ids())
    OR public.is_platform_admin()
  );

-- Service role bypasses RLS by default in Supabase (used by API / migrations).
COMMENT ON TABLE public.organisations IS 'SentinelGrid Phase 0 tenant root';
COMMENT ON TABLE public.events IS 'Phase 0 event ledger; simulated events must set classification=simulated';
COMMENT ON TABLE public.evidence_records IS 'SHA-256 integrity of stored payloads; hash != truth of sensor';
