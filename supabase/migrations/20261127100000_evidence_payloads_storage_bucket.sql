-- Private Supabase Storage bucket for Nest evidence / payload object bytes.
-- Distinct from asset-media (photos). Nest talks via Storage S3 protocol
-- (see docs/PAYLOAD_STORAGE.md). S3 access keys bypass RLS; keep bucket private.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence-payloads',
  'evidence-payloads',
  false,
  10485760,
  ARRAY['application/json', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Authenticated reads/writes are org-scoped by object key prefix (organisation_id/...).
-- Nest production path uses Storage S3 access keys (server-only) and bypasses RLS.
DROP POLICY IF EXISTS evidence_payloads_storage_select ON storage.objects;
CREATE POLICY evidence_payloads_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'evidence-payloads'
    AND (
      public.is_platform_admin()
      OR (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND public.has_org_permission((storage.foldername(name))[1]::uuid, 'evidence.read')
      )
    )
  );

DROP POLICY IF EXISTS evidence_payloads_storage_insert ON storage.objects;
CREATE POLICY evidence_payloads_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'evidence-payloads'
    AND (
      public.is_platform_admin()
      OR (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND public.has_org_permission((storage.foldername(name))[1]::uuid, 'evidence.write')
      )
    )
  );

DROP POLICY IF EXISTS evidence_payloads_storage_update ON storage.objects;
CREATE POLICY evidence_payloads_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'evidence-payloads'
    AND (
      public.is_platform_admin()
      OR (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND public.has_org_permission((storage.foldername(name))[1]::uuid, 'evidence.write')
      )
    )
  )
  WITH CHECK (
    bucket_id = 'evidence-payloads'
    AND (
      public.is_platform_admin()
      OR (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND public.has_org_permission((storage.foldername(name))[1]::uuid, 'evidence.write')
      )
    )
  );

DROP POLICY IF EXISTS evidence_payloads_storage_delete ON storage.objects;
CREATE POLICY evidence_payloads_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'evidence-payloads'
    AND (
      public.is_platform_admin()
      OR (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND public.has_org_permission((storage.foldername(name))[1]::uuid, 'evidence.write')
      )
    )
  );

COMMIT;
