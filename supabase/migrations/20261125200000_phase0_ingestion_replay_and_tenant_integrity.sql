-- Phase 0 replay hardening and tenant-integrity constraints.
-- Forward-only. Existing null tenant IDs or cross-tenant connector references
-- intentionally fail migration rather than being silently repaired.
BEGIN;

ALTER TABLE public.event_ingestion_dlq
  DROP CONSTRAINT IF EXISTS event_ingestion_dlq_status_check;
ALTER TABLE public.event_ingestion_dlq
  ADD CONSTRAINT event_ingestion_dlq_status_check
  CHECK (status IN ('open', 'processing', 'replayed', 'discarded'));

ALTER TABLE public.event_ingestion_dlq
  ADD COLUMN IF NOT EXISTS replay_started_at timestamptz;

ALTER TABLE public.event_ingestion_dlq
  ALTER COLUMN organisation_id SET NOT NULL;

ALTER TABLE public.event_ingestion_dlq
  DROP CONSTRAINT IF EXISTS event_ingestion_dlq_organisation_id_fkey;
ALTER TABLE public.event_ingestion_dlq
  ADD CONSTRAINT event_ingestion_dlq_organisation_id_fkey
  FOREIGN KEY (organisation_id)
  REFERENCES public.organisations(id)
  ON DELETE CASCADE;

ALTER TABLE public.event_ingestion_dlq
  ADD CONSTRAINT event_ingestion_dlq_connector_same_org_fk
  FOREIGN KEY (organisation_id, connector_id)
  REFERENCES public.connectors (organisation_id, id);

ALTER TABLE public.event_ingestion_dlq
  ADD CONSTRAINT event_ingestion_dlq_raw_body_size_check
  CHECK (octet_length(coalesce(raw_body::text, '')) <= 1048576);

CREATE INDEX IF NOT EXISTS event_ingestion_dlq_processing_idx
  ON public.event_ingestion_dlq (status, updated_at)
  WHERE status = 'processing';

COMMENT ON COLUMN public.event_ingestion_dlq.status IS
  'Replay state machine: open → processing → replayed; failed replay returns to open.';

COMMIT;
