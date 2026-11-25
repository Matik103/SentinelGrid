-- Phase 0: organisation invitation create / accept / revoke → real memberships + RBAC
-- Forward-only. Email delivery is application-side (stub/log in local_dev).

BEGIN;

CREATE TABLE IF NOT EXISTS public.organisation_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  email text NOT NULL,
  role_id uuid NOT NULL REFERENCES public.roles (id),
  token_hash text NOT NULL,
  invited_by uuid REFERENCES auth.users (id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_by uuid REFERENCES auth.users (id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisation_invitations_email_nonempty CHECK (length(btrim(email)) > 3)
);

CREATE UNIQUE INDEX IF NOT EXISTS organisation_invitations_pending_email_uq
  ON public.organisation_invitations (organisation_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS organisation_invitations_org_status_idx
  ON public.organisation_invitations (organisation_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS organisation_invitations_token_hash_idx
  ON public.organisation_invitations (token_hash)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS set_updated_at ON public.organisation_invitations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.organisation_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.organisation_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organisation_invitations_select ON public.organisation_invitations;
CREATE POLICY organisation_invitations_select ON public.organisation_invitations
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR public.has_org_permission(organisation_id, 'user.manage')
    OR public.has_org_permission(organisation_id, 'org.read')
    OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Writes go through SECURITY DEFINER RPCs only.
REVOKE ALL ON TABLE public.organisation_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.organisation_invitations TO authenticated;
GRANT ALL ON TABLE public.organisation_invitations TO service_role;

-- ---------------------------------------------------------------------------
-- create_organisation_invitation
-- ---------------------------------------------------------------------------
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

  -- Already an active member with this email?
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

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.organisation_invitations (
    organisation_id, email, role_id, token_hash, invited_by, status
  ) VALUES (
    p_organisation_id, v_email, v_role_id, v_token_hash, auth.uid(), 'pending'
  )
  RETURNING id INTO v_invite_id;

  -- If the invitee already has an auth account, seed membership as invited (RBAC path).
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
    jsonb_build_object('email', v_email, 'role_key', v_role_key)
  );

  RETURN jsonb_build_object(
    'id', v_invite_id,
    'organisation_id', p_organisation_id,
    'email', v_email,
    'role_key', v_role_key,
    'role_id', v_role_id,
    'status', 'pending',
    'token', v_token
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- accept_organisation_invitation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_organisation_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_invite public.organisation_invitations%ROWTYPE;
  v_token_hash text;
  v_email text;
  v_membership_id uuid;
  v_role_key text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_token), '') IS NULL THEN
    RAISE EXCEPTION 'Invite token required' USING ERRCODE = '22023';
  END IF;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_email = '' THEN
    -- Fallback to auth.users
    SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  END IF;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Authenticated user email unavailable' USING ERRCODE = '42501';
  END IF;

  v_token_hash := encode(digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'), 'hex');

  SELECT * INTO v_invite
  FROM public.organisation_invitations
  WHERE token_hash = v_token_hash
  FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is not pending' USING ERRCODE = '22023';
  END IF;
  IF v_invite.expires_at < now() THEN
    UPDATE public.organisation_invitations
      SET status = 'expired', updated_at = now()
      WHERE id = v_invite.id;
    RAISE EXCEPTION 'Invitation expired' USING ERRCODE = '22023';
  END IF;
  IF lower(v_invite.email) <> v_email THEN
    RAISE EXCEPTION 'Invitation email does not match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  SELECT key INTO v_role_key FROM public.roles WHERE id = v_invite.role_id;

  INSERT INTO public.memberships (
    organisation_id, user_id, role_id, status, invited_by
  ) VALUES (
    v_invite.organisation_id, auth.uid(), v_invite.role_id, 'active', v_invite.invited_by
  )
  ON CONFLICT (organisation_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        invited_by = COALESCE(public.memberships.invited_by, EXCLUDED.invited_by)
  RETURNING id INTO v_membership_id;

  UPDATE public.organisation_invitations
  SET status = 'accepted',
      accepted_by = auth.uid(),
      accepted_at = now(),
      updated_at = now()
  WHERE id = v_invite.id;

  INSERT INTO public.profiles (user_id, email)
  VALUES (auth.uid(), v_email)
  ON CONFLICT (user_id) DO UPDATE
    SET email = COALESCE(public.profiles.email, EXCLUDED.email);

  INSERT INTO public.audit_logs (
    organisation_id, actor_user_id, action, resource_type, resource_id, details
  ) VALUES (
    v_invite.organisation_id, auth.uid(), 'organisation.invite.accept',
    'organisation_invitations', v_invite.id::text,
    jsonb_build_object('membership_id', v_membership_id, 'role_key', v_role_key)
  );

  RETURN jsonb_build_object(
    'invitation_id', v_invite.id,
    'organisation_id', v_invite.organisation_id,
    'membership_id', v_membership_id,
    'role_key', v_role_key,
    'status', 'accepted'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- revoke_organisation_invitation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_organisation_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_invite public.organisation_invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invite
  FROM public.organisation_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_org_permission(v_invite.organisation_id, 'user.manage') THEN
    RAISE EXCEPTION 'Missing permission: user.manage' USING ERRCODE = '42501';
  END IF;

  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending invitations can be revoked' USING ERRCODE = '22023';
  END IF;

  UPDATE public.organisation_invitations
  SET status = 'revoked', revoked_at = now(), updated_at = now()
  WHERE id = v_invite.id;

  -- Revoke any seeded invited membership for this email/org.
  UPDATE public.memberships m
  SET status = 'revoked'
  FROM auth.users u
  WHERE m.organisation_id = v_invite.organisation_id
    AND m.user_id = u.id
    AND lower(u.email) = lower(v_invite.email)
    AND m.status = 'invited';

  INSERT INTO public.audit_logs (
    organisation_id, actor_user_id, action, resource_type, resource_id, details
  ) VALUES (
    v_invite.organisation_id, auth.uid(), 'organisation.invite.revoke',
    'organisation_invitations', v_invite.id::text,
    jsonb_build_object('email', v_invite.email)
  );

  RETURN jsonb_build_object(
    'id', v_invite.id,
    'organisation_id', v_invite.organisation_id,
    'status', 'revoked'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_organisation_invitation(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_organisation_invitation(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_organisation_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organisation_invitation(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_organisation_invitation(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_organisation_invitation(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.organisation_invitations IS
  'Pending org invites; accept creates active memberships with assigned RBAC role';

COMMIT;
