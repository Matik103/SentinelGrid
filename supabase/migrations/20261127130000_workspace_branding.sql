-- Forward-ported from main 20261126100000 onto work lineage (Issue #9 reconciliation).
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

CREATE OR REPLACE FUNCTION public.set_workspace_logo(
  p_organisation_id uuid,
  p_logo_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_org_permission(p_organisation_id, 'org.admin') THEN
    RAISE EXCEPTION 'Workspace administrator permission required' USING ERRCODE = '42501';
  END IF;
  IF p_logo_path IS NOT NULL AND p_logo_path !~ ('^' || p_organisation_id::text || '/[a-f0-9-]+[.](jpg|png|webp|avif)$') THEN
    RAISE EXCEPTION 'Invalid workspace logo path' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organisations
  SET settings = settings || jsonb_build_object('logo_path', p_logo_path),
      updated_at = now()
  WHERE id = p_organisation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_workspace_logo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_logo(uuid, text) TO authenticated;
