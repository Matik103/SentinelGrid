-- Workspace logo branding. Logos are public display assets; writes remain tenant-admin only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-branding',
  'workspace-branding',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS workspace_branding_insert_admin ON storage.objects;
CREATE POLICY workspace_branding_insert_admin ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'workspace-branding'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.has_org_permission((storage.foldername(name))[1]::uuid, 'org.admin')
  );

DROP POLICY IF EXISTS workspace_branding_update_admin ON storage.objects;
CREATE POLICY workspace_branding_update_admin ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'workspace-branding'
    AND public.has_org_permission((storage.foldername(name))[1]::uuid, 'org.admin')
  )
  WITH CHECK (
    bucket_id = 'workspace-branding'
    AND public.has_org_permission((storage.foldername(name))[1]::uuid, 'org.admin')
  );

DROP POLICY IF EXISTS workspace_branding_delete_admin ON storage.objects;
CREATE POLICY workspace_branding_delete_admin ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'workspace-branding'
    AND public.has_org_permission((storage.foldername(name))[1]::uuid, 'org.admin')
  );
