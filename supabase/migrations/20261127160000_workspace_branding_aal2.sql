-- Require AAL2 for authenticated writes to workspace branding objects.
-- Public-schema tables already have require_aal2_* restrictive policies;
-- storage.objects did not, so an AAL1 admin JWT could still upload logos.

BEGIN;

DROP POLICY IF EXISTS workspace_branding_require_aal2 ON storage.objects;
CREATE POLICY workspace_branding_require_aal2 ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (
    bucket_id <> 'workspace-branding'
    OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  )
  WITH CHECK (
    bucket_id <> 'workspace-branding'
    OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );

COMMIT;
