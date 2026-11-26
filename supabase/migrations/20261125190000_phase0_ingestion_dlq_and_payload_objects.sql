-- Phase 0: ingestion DLQ + payload object metadata hooks (forward-only)
-- Raw bytes live in object storage; Postgres stores refs/digests only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.event_ingestion_dlq (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES public.organisations (id) ON DELETE SET NULL,
  connector_id uuid REFERENCES public.connectors (id) ON DELETE SET NULL,
  source text,
  source_event_id text,
  failure_reason text NOT NULL,
  payload_ref text,
  raw_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_body jsonb,
  schema_version text,
  attempt_count int NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  last_error text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'replayed', 'discarded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_ingestion_dlq_org_status_idx
  ON public.event_ingestion_dlq (organisation_id, status, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.event_ingestion_dlq;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.event_ingestion_dlq
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Metadata for opaque payload objects (bytes outside Postgres)
CREATE TABLE IF NOT EXISTS public.payload_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  object_key text NOT NULL,
  content_sha256 text NOT NULL,
  byte_length bigint,
  content_type text,
  storage_backend text NOT NULL DEFAULT 's3_compatible'
    CHECK (storage_backend IN ('s3_compatible', 'local_dev')),
  classification text NOT NULL DEFAULT 'real'
    CHECK (classification IN ('real', 'simulated', 'replayed', 'synthetic')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, object_key)
);

CREATE INDEX IF NOT EXISTS payload_objects_org_created_idx
  ON public.payload_objects (organisation_id, created_at DESC);

ALTER TABLE public.event_ingestion_dlq ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payload_objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_ingestion_dlq_select ON public.event_ingestion_dlq;
CREATE POLICY event_ingestion_dlq_select ON public.event_ingestion_dlq
  FOR SELECT TO authenticated
  USING (
    organisation_id IS NOT NULL
    AND (public.has_org_permission(organisation_id, 'event.read') OR public.is_platform_admin())
  );

DROP POLICY IF EXISTS payload_objects_select ON public.payload_objects;
CREATE POLICY payload_objects_select ON public.payload_objects
  FOR SELECT TO authenticated
  USING (public.has_org_permission(organisation_id, 'evidence.read') OR public.is_platform_admin());

-- Writes go through service-role / SECURITY DEFINER API paths only
GRANT SELECT ON public.event_ingestion_dlq TO authenticated;
GRANT SELECT ON public.payload_objects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_ingestion_dlq TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payload_objects TO service_role;

COMMENT ON TABLE public.event_ingestion_dlq IS
  'Dead-letter queue for failed/invalid event ingestion; replay is explicit and audited';
COMMENT ON TABLE public.payload_objects IS
  'Tenant-scoped metadata for raw payload objects stored outside Postgres';

COMMIT;
