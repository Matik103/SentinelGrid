-- When a member is removed, clear their invitation history for that workspace so
-- People & access does not keep showing an "accepted" invite row. Pending-only
-- listing is enforced in the API; this keeps the roster consistent after removal.
-- Forward-only.

BEGIN;

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

  DELETE FROM public.memberships
  WHERE id = v_membership.id;

  -- Clear invite rows for this email (pending or previously accepted) so the
  -- Invitations panel never keeps a stale accepted invite after removal.
  IF v_target_email IS NOT NULL THEN
    UPDATE public.organisation_invitations
    SET status = 'revoked',
        revoked_at = coalesce(revoked_at, now()),
        updated_at = now()
    WHERE organisation_id = p_organisation_id
      AND lower(email) = v_target_email
      AND status IN ('pending', 'accepted');
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

GRANT EXECUTE ON FUNCTION public.revoke_organisation_member(uuid, uuid) TO authenticated, service_role;

COMMIT;
