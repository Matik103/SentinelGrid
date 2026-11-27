-- Allow first-session profile bootstrap before MFA (AAL1).
-- Direct authenticated DML on profiles remains gated by restrictive AAL2 RLS.
-- This RPC is tightly scoped: only upserts auth.uid()'s own row via SECURITY DEFINER.

BEGIN;

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

-- Auth trigger already SECURITY DEFINER; pin row_security off for clarity under FORCE RLS.
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

COMMIT;
