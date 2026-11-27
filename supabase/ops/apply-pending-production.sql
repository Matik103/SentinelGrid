-- Paste into Supabase SQL Editor for project abaeizgfsskvjklfslrh.
-- Idempotent. Covers AAL1 profile DEFINER + evidence-payloads bucket/RLS + api_base_url.

-- ========== 20261127090000_ensure_own_profile_bootstrap_definer ==========
CREATE OR REPLACE FUNCTION public.ensure_own_profile(
  p_display_name text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := NULLIF(btrim(COALESCE(auth.jwt() ->> 'email', '')), '');
  v_row public.profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (user_id, email, display_name, status)
  VALUES (
    v_uid,
    v_email,
    NULLIF(btrim(COALESCE(p_display_name, '')), ''),
    'active'
  )
  ON CONFLICT (user_id) DO UPDATE
  SET email = COALESCE(EXCLUDED.email, public.profiles.email),
      display_name = COALESCE(
        NULLIF(btrim(COALESCE(p_display_name, '')), ''),
        public.profiles.display_name
      ),
      updated_at = now()
  WHERE public.profiles.user_id = v_uid
  RETURNING * INTO v_row;

  IF v_row.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Profile bootstrap refused' USING ERRCODE = '42501';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_own_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_own_profile(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name, status)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'display_name', '')), ''),
    'active'
  )
  ON CONFLICT (user_id) DO UPDATE
  SET email = COALESCE(EXCLUDED.email, public.profiles.email),
      display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
      updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO postgres, service_role;

-- ========== 20261127100000_evidence_payloads_storage_bucket ==========
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

-- ========== api_base_url ==========
INSERT INTO public.app_public_config (key, value, updated_at)
VALUES ('api_base_url', jsonb_build_object('url', 'https://sentinelgrid-fpzo.onrender.com'), now())
ON CONFLICT (key) DO UPDATE
SET value = jsonb_build_object('url', 'https://sentinelgrid-fpzo.onrender.com'),
    updated_at = now();

-- ========== read-back ==========
SELECT key, value, updated_at
FROM public.app_public_config
WHERE key = 'api_base_url';

SELECT p.proname, p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'ensure_own_profile';

SELECT id, name, public, file_size_limit
FROM storage.buckets
WHERE id = 'evidence-payloads';
