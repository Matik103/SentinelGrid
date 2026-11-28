-- Workspace creator protection + member removal.
-- created_by_user_id is the account email/user that bootstrapped the organisation
-- and cannot be removed from memberships.
-- Forward-only.

BEGIN;

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.organisations.created_by_user_id IS
  'User who created this workspace (bootstrap). Their membership cannot be removed.';

-- Backfill from provision audit, then earliest active membership.
UPDATE public.organisations o
SET created_by_user_id = (
  SELECT NULLIF(a.details ->> 'first_admin', '')::uuid
  FROM public.audit_logs a
  WHERE a.organisation_id = o.id
    AND a.action = 'organisation.provision'
  ORDER BY a.created_at ASC
  LIMIT 1
)
WHERE o.created_by_user_id IS NULL;

UPDATE public.organisations o
SET created_by_user_id = (
  SELECT m.user_id
  FROM public.memberships m
  WHERE m.organisation_id = o.id
    AND m.status = 'active'
  ORDER BY m.created_at ASC
  LIMIT 1
)
WHERE o.created_by_user_id IS NULL;

CREATE INDEX IF NOT EXISTS organisations_created_by_user_id_idx
  ON public.organisations (created_by_user_id);

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

  INSERT INTO public.organisations (name, slug, created_by_user_id)
  VALUES (btrim(p_name), p_slug, auth.uid())
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

CREATE OR REPLACE FUNCTION public.revoke_organisation_member(
  p_organisation_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_creator uuid;
  v_creator_email text;
  v_target_email text;
  v_membership public.memberships%ROWTYPE;
  v_role_key text;
  v_admin_role uuid;
  v_other_admins int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_organisation_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'organisation_id and user_id are required' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_org_permission(p_organisation_id, 'user.manage') THEN
    RAISE EXCEPTION 'Missing permission: user.manage' USING ERRCODE = '42501';
  END IF;

  SELECT created_by_user_id INTO v_creator
  FROM public.organisations
  WHERE id = p_organisation_id;

  IF v_creator IS NULL THEN
    -- Legacy safety: treat earliest active membership as the creator.
    SELECT m.user_id INTO v_creator
    FROM public.memberships m
    WHERE m.organisation_id = p_organisation_id
      AND m.status = 'active'
    ORDER BY m.created_at ASC
    LIMIT 1;
  END IF;

  SELECT lower(email) INTO v_creator_email FROM auth.users WHERE id = v_creator;
  SELECT lower(email) INTO v_target_email FROM auth.users WHERE id = p_user_id;

  IF p_user_id = v_creator
     OR (v_creator_email IS NOT NULL AND v_target_email IS NOT NULL AND v_creator_email = v_target_email)
  THEN
    RAISE EXCEPTION 'The workspace creator account cannot be removed'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove your own membership'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_membership
  FROM public.memberships
  WHERE organisation_id = p_organisation_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF v_membership.id IS NULL THEN
    RAISE EXCEPTION 'Membership not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_membership.status <> 'active' THEN
    RAISE EXCEPTION 'Membership is not active' USING ERRCODE = '22023';
  END IF;

  SELECT key INTO v_role_key FROM public.roles WHERE id = v_membership.role_id;
  SELECT id INTO v_admin_role FROM public.roles WHERE key = 'organisation_administrator';

  IF v_membership.role_id = v_admin_role THEN
    SELECT count(*) INTO v_other_admins
    FROM public.memberships
    WHERE organisation_id = p_organisation_id
      AND status = 'active'
      AND role_id = v_admin_role
      AND user_id <> p_user_id;
    IF v_other_admins < 1 THEN
      RAISE EXCEPTION 'Cannot remove the last workspace administrator'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Hard-remove membership so the person is gone from the workspace roster.
  DELETE FROM public.memberships
  WHERE id = v_membership.id;

  -- Drop any still-pending invites for the same email in this workspace.
  IF v_target_email IS NOT NULL THEN
    UPDATE public.organisation_invitations
    SET status = 'revoked',
        revoked_at = now(),
        updated_at = now()
    WHERE organisation_id = p_organisation_id
      AND status = 'pending'
      AND lower(email) = v_target_email;
  END IF;

  INSERT INTO public.audit_logs (
    organisation_id, actor_user_id, action, resource_type, resource_id, details
  ) VALUES (
    p_organisation_id, auth.uid(), 'organisation.member.revoke',
    'memberships', v_membership.id::text,
    jsonb_build_object(
      'removed_user_id', p_user_id,
      'removed_email', v_target_email,
      'previous_role_key', v_role_key
    )
  );

  RETURN jsonb_build_object(
    'organisation_id', p_organisation_id,
    'user_id', p_user_id,
    'email', v_target_email,
    'status', 'removed',
    'previous_role_key', v_role_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_organisation_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_organisation(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_organisation_member(uuid, uuid) TO authenticated, service_role;

COMMIT;
