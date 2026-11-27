-- Prefer Supabase Storage backend label; keep legacy s3_compatible rows readable.
-- Nest no longer uses the Amazon S3 SDK or AWS_* credentials.

BEGIN;

ALTER TABLE public.payload_objects
  DROP CONSTRAINT IF EXISTS payload_objects_storage_backend_check;

ALTER TABLE public.payload_objects
  ADD CONSTRAINT payload_objects_storage_backend_check
  CHECK (storage_backend IN ('supabase', 's3_compatible', 'local_dev'));

ALTER TABLE public.payload_objects
  ALTER COLUMN storage_backend SET DEFAULT 'supabase';

COMMIT;
