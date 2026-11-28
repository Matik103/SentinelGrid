-- Re-invite / resend: supersede an existing pending invitation for the same org+email
-- instead of failing on organisation_invitations_pending_email_uq.
-- Forward-only.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_organisation_invitation(
  p_organisation_id uuid,
  p_email text,
  p_role_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_role_id uuid;
  v_role_key text;
  v_invite_id uuid;
  v_token text;
  v_token_hash text;
  v_existing uuid;
  v_email text;
  v_superseded int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_email := lower(btrim(p_email));
  IF v_email IS NULL OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Valid email required' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_org_permission(p_organisation_id, 'user.manage') THEN
    RAISE EXCEPTION 'Missing permission: user.manage' USING ERRCODE = '42501';
  END IF;

  SELECT id, key INTO v_role_id, v_role_key
  FROM public.roles
  WHERE key = p_role_key;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Unknown role' USING ERRCODE = '22023';
  END IF;
  IF v_role_key = 'platform_administrator' THEN
    RAISE EXCEPTION 'platform_administrator cannot be assigned via invitations'
      USING ERRCODE = '42501';
  END IF;

  SELECT m.user_id INTO v_existing
  FROM public.memberships m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.organisation_id = p_organisation_id
    AND m.status = 'active'
    AND lower(u.email) = v_email
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'User is already an active member' USING ERRCODE = '23505';
  END IF;

  -- Resend path: revoke any still-pending invite for this email so a fresh token can be issued.
  UPDATE public.organisation_invitations
  SET status = 'revoked',
      revoked_at = now(),
      updated_at = now()
  WHERE organisation_id = p_organisation_id
    AND lower(email) = v_email
    AND status = 'pending';
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.organisation_invitations (
    organisation_id, email, role_id, token_hash, invited_by, status
  ) VALUES (
    p_organisation_id, v_email, v_role_id, v_token_hash, auth.uid(), 'pending'
  )
  RETURNING id INTO v_invite_id;

  SELECT u.id INTO v_existing
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    INSERT INTO public.memberships (
      organisation_id, user_id, role_id, status, invited_by
    ) VALUES (
      p_organisation_id, v_existing, v_role_id, 'invited', auth.uid()
    )
    ON CONFLICT (organisation_id, user_id) DO UPDATE
      SET role_id = EXCLUDED.role_id,
          status = 'invited',
          invited_by = EXCLUDED.invited_by
      WHERE public.memberships.status IN ('revoked', 'invited');
  END IF;

  INSERT INTO public.audit_logs (
    organisation_id, actor_user_id, action, resource_type, resource_id, details
  ) VALUES (
    p_organisation_id, auth.uid(), 'organisation.invite.create',
    'organisation_invitations', v_invite_id::text,
    jsonb_build_object(
      'email', v_email,
      'role_key', v_role_key,
      'resent', v_superseded > 0,
      'superseded_count', v_superseded
    )
  );

  RETURN jsonb_build_object(
    'id', v_invite_id,
    'organisation_id', p_organisation_id,
    'email', v_email,
    'role_key', v_role_key,
    'role_id', v_role_id,
    'status', 'pending',
    'token', v_token,
    'resent', v_superseded > 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organisation_invitation(uuid, text, text) TO authenticated, service_role;

COMMIT;
