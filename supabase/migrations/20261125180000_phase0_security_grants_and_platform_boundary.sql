-- Phase 0 security follow-up (forward-only)
-- Findings from independent local verification of 20261125170000:
-- 1) authenticated/service_role lacked DML grants; RLS policies were unreachable.
-- 2) platform_administrator remained membership-derived.
-- 3) membership row identity (organisation_id/user_id) was mutable by admins.
-- 4) bootstrap_organisation did not write an audit record.
-- 5) invitees could not accept invitations without user.manage.
-- 6) service_role needed EXECUTE on security helpers.

BEGIN;

-- ---------------------------------------------------------------------------
-- Table privileges: RLS remains the authorization boundary
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.organisations,
  public.profiles,
  public.memberships,
  public.facilities,
  public.zones,
  public.assets,
  public.devices,
  public.sensors,
  public.connectors
TO authenticated, service_role;

-- Append-only ledger tables: no UPDATE/DELETE for authenticated
GRANT SELECT, INSERT ON TABLE
  public.events,
  public.evidence_records,
  public.evidence_checkpoints
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.events,
  public.evidence_records,
  public.evidence_checkpoints
TO service_role;

-- Audit: authenticated may read only (via RLS); no client inserts
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audit_logs TO service_role;

GRANT SELECT ON TABLE
  public.roles,
  public.permissions,
  public.role_permissions
TO authenticated, service_role, anon;

-- Catalogue remains server-managed
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.roles,
  public.permissions,
  public.role_permissions
FROM authenticated, anon;

-- Explicitly deny ledger mutation at privilege layer for authenticated
REVOKE UPDATE, DELETE ON TABLE
  public.events,
  public.evidence_records,
  public.evidence_checkpoints
FROM authenticated, anon;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM authenticated, anon;
REVOKE ALL ON TABLE public.organisations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organisations FROM authenticated;
-- Re-grant SELECT/UPDATE for authenticated (INSERT still revoked; bootstrap is SECURITY DEFINER)
GRANT SELECT, UPDATE ON TABLE public.organisations TO authenticated;

-- ---------------------------------------------------------------------------
-- Platform admin boundary (separate from memberships)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  granted_by uuid REFERENCES auth.users (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admins_revoke_consistency CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

DROP TRIGGER IF EXISTS set_updated_at ON public.platform_admins;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.platform_admins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_admins TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.platform_admins FROM authenticated, anon;

-- Replace membership-derived platform admin check BEFORE policies that use it
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = auth.uid()
      AND pa.status = 'active'
  );
$$;

DROP POLICY IF EXISTS platform_admins_select ON public.platform_admins;
CREATE POLICY platform_admins_select ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.grant_platform_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform admin required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.platform_admins (user_id, status, granted_by)
  VALUES (p_user_id, 'active', auth.uid())
  ON CONFLICT (user_id) DO UPDATE
    SET status = 'active',
        granted_by = auth.uid(),
        granted_at = now(),
        revoked_at = NULL,
        revoke_reason = NULL,
        updated_at = now();

  INSERT INTO public.audit_logs (organisation_id, actor_user_id, action, resource_type, resource_id, details)
  VALUES (NULL, auth.uid(), 'platform_admin.grant', 'platform_admins', p_user_id::text,
          jsonb_build_object('granted_by', auth.uid()));
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_platform_admin(p_user_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform admin required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot revoke own platform admin' USING ERRCODE = '42501';
  END IF;

  UPDATE public.platform_admins
  SET status = 'revoked',
      revoked_at = now(),
      revoke_reason = p_reason,
      updated_at = now()
  WHERE user_id = p_user_id
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active platform admin not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_logs (organisation_id, actor_user_id, action, resource_type, resource_id, details)
  VALUES (NULL, auth.uid(), 'platform_admin.revoke', 'platform_admins', p_user_id::text,
          jsonb_build_object('reason', p_reason));
END;
$$;

REVOKE ALL ON FUNCTION public.grant_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_platform_admin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_platform_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_platform_admin(uuid, text) TO authenticated, service_role;

-- Remove platform_administrator from tenant role_permissions map (no longer used for authz)
DELETE FROM public.role_permissions rp
USING public.roles r
WHERE rp.role_id = r.id
  AND r.key = 'platform_administrator';

-- ---------------------------------------------------------------------------
-- Membership identity immutability + invite acceptance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_membership_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role_key text;
BEGIN
  SELECT key INTO v_role_key FROM public.roles WHERE id = NEW.role_id;
  IF v_role_key IS NULL THEN
    RAISE EXCEPTION 'invalid role' USING ERRCODE = '22023';
  END IF;
  IF v_role_key = 'platform_administrator' THEN
    RAISE EXCEPTION 'platform_administrator cannot be assigned via memberships'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'cannot reassign membership identity' USING ERRCODE = '42501';
    END IF;

    -- Invitee accepting cannot change role_id
    IF NEW.user_id = auth.uid()
       AND OLD.status = 'invited'
       AND NEW.status = 'active'
       AND NEW.role_id IS DISTINCT FROM OLD.role_id THEN
      RAISE EXCEPTION 'cannot change role while accepting invitation' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_membership_invariants ON public.memberships;
CREATE TRIGGER enforce_membership_invariants
  BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_invariants();

-- Invitee can accept own invitation (status invited -> active only)
DROP POLICY IF EXISTS memberships_accept_own ON public.memberships;
CREATE POLICY memberships_accept_own ON public.memberships
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'invited')
  WITH CHECK (user_id = auth.uid() AND status = 'active');
-- role_id immutability on accept is enforced by enforce_membership_invariants.

-- ---------------------------------------------------------------------------
-- Audit-aware bootstrap
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bootstrap_organisation(p_name text, p_slug text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_organisation_id uuid;
  v_role_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_name), '') IS NULL OR nullif(btrim(p_slug), '') IS NULL THEN
    RAISE EXCEPTION 'Organisation name and slug are required' USING ERRCODE = '22023';
  END IF;
  IF length(p_slug) > 63 OR p_slug !~ '^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$' THEN
    RAISE EXCEPTION 'Invalid organisation slug' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE key = 'organisation_administrator';

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Organisation administrator role is not configured';
  END IF;

  INSERT INTO public.organisations (name, slug)
  VALUES (btrim(p_name), p_slug)
  RETURNING id INTO v_organisation_id;

  INSERT INTO public.memberships (organisation_id, user_id, role_id, status)
  VALUES (v_organisation_id, auth.uid(), v_role_id, 'active');

  INSERT INTO public.profiles (user_id)
  VALUES (auth.uid())
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.audit_logs (
    organisation_id, actor_user_id, action, resource_type, resource_id, details
  ) VALUES (
    v_organisation_id, auth.uid(), 'organisation.provision', 'organisations',
    v_organisation_id::text,
    jsonb_build_object('slug', p_slug, 'first_admin', auth.uid())
  );

  RETURN v_organisation_id;
END;
$$;

-- Ensure EXECUTE grants for helpers (including service_role)
REVOKE ALL ON FUNCTION public.current_user_org_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_org_permission(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bootstrap_organisation(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_org_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_organisation(text, text) TO authenticated, service_role;

COMMENT ON TABLE public.platform_admins IS
  'Separately protected platform operators; not granted through organisation memberships';
COMMENT ON COLUMN public.events.original_payload_ref IS
  'Opaque object-storage URI; raw payload bytes are not stored in Postgres (see docs/PAYLOAD_STORAGE.md)';
COMMENT ON COLUMN public.evidence_records.payload_ref IS
  'Opaque object-storage URI for preserved payload bytes';

COMMIT;
