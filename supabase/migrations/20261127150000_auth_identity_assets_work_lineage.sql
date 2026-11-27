-- Forward-ported from main 20261126120000 onto work lineage.
-- ensure_own_profile kept as SECURITY DEFINER from 20261127090000 (do not regress to INVOKER).

-- Auth identity assets for Command sign-up / session / workspace bootstrap.
-- Hardens grants (fail-closed for anon), ensures profiles provisioning on
-- auth.users, and keeps invitation RPCs executable for authenticated callers.

-- ---------------------------------------------------------------------------
-- Least-privilege table grants for identity tables
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.memberships FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.organisation_invitations FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.organisations FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.memberships TO service_role;

-- Invitation writes stay on SECURITY DEFINER / service_role RPCs only.
GRANT SELECT ON TABLE public.organisation_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organisation_invitations TO service_role;

-- Org rows: clients read + admin update; creation is bootstrap RPC.
GRANT SELECT, UPDATE ON TABLE public.organisations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organisations TO service_role;

-- ---------------------------------------------------------------------------
-- Profiles: self RLS stays; auto-provision on new auth user
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS profiles_select_self ON public.profiles;
CREATE POLICY profiles_select_self ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin());

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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO postgres, service_role;


-- AAL1-safe profile bootstrap (supersedes main jwt_email INVOKER variant).
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

-- ---------------------------------------------------------------------------
-- Invitation / bootstrap RPC execute grants (idempotent)
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.bootstrap_organisation(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_organisation_invitation(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_organisation_invitation(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_organisation_invitations(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_organisation_invitation_by_token(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid, text) TO authenticated, service_role;
