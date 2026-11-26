-- Phase 0: hashed connector credentials, email outbox, invite role/expiry guards,
-- DLQ original payload refs. Forward-only.

BEGIN;

-- ---------------------------------------------------------------------------
-- Connector credential hash (never store plaintext tokens in Postgres)
-- ---------------------------------------------------------------------------
ALTER TABLE public.connectors
  ADD COLUMN IF NOT EXISTS credential_token_hash text,
  ADD COLUMN IF NOT EXISTS credential_rotated_at timestamptz;

COMMENT ON COLUMN public.connectors.credential_token_hash IS
  'SHA-256 hex of issued connector bearer token; plaintext never persisted.';

-- ---------------------------------------------------------------------------
-- Email outbox (local_dev can log; production drains via worker)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES public.organisations (id) ON DELETE SET NULL,
  template_key text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  body_html text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_outbox_status_sched_idx
  ON public.email_outbox (status, scheduled_at);

DROP TRIGGER IF EXISTS set_updated_at ON public.email_outbox;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_outbox_select ON public.email_outbox;
CREATE POLICY email_outbox_select ON public.email_outbox
  FOR SELECT TO authenticated
  USING (
    organisation_id IS NOT NULL
    AND (public.has_org_permission(organisation_id, 'user.manage') OR public.is_platform_admin())
  );

GRANT SELECT ON public.email_outbox TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_outbox TO service_role;

-- ---------------------------------------------------------------------------
-- DLQ: preserve refs to original payloads for deterministic replay
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_ingestion_dlq
  ADD COLUMN IF NOT EXISTS original_payload_object_id uuid
    REFERENCES public.payload_objects (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_payload_sha256 text,
  ADD COLUMN IF NOT EXISTS replay_fingerprint text;

COMMENT ON COLUMN public.event_ingestion_dlq.original_payload_object_id IS
  'Object-store metadata id for the original ingest payload (bytes outside Postgres).';
COMMENT ON COLUMN public.event_ingestion_dlq.replay_fingerprint IS
  'Deterministic SHA-256 of canonical raw_body used to make replay idempotent.';

-- Link events → payload_objects for evidence chain
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS payload_object_id uuid
    REFERENCES public.payload_objects (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS events_org_payload_object_idx
  ON public.events (organisation_id, payload_object_id)
  WHERE payload_object_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invite accept: do not overwrite an already-active membership role
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
  v_existing_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_token), '') IS NULL THEN
    RAISE EXCEPTION 'Invite token required' USING ERRCODE = '22023';
  END IF;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_email = '' THEN
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

  SELECT status INTO v_existing_status
  FROM public.memberships
  WHERE organisation_id = v_invite.organisation_id
    AND user_id = auth.uid()
  FOR UPDATE;

  IF v_existing_status = 'active' THEN
    RAISE EXCEPTION 'User is already an active member; invitation cannot overwrite role'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.memberships (
    organisation_id, user_id, role_id, status, invited_by
  ) VALUES (
    v_invite.organisation_id, auth.uid(), v_invite.role_id, 'active', v_invite.invited_by
  )
  ON CONFLICT (organisation_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        invited_by = COALESCE(public.memberships.invited_by, EXCLUDED.invited_by)
    WHERE public.memberships.status IN ('invited', 'revoked')
  RETURNING id INTO v_membership_id;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'Membership accept conflict' USING ERRCODE = '23505';
  END IF;

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

-- Transactional expiry of pending invitations (idempotent).
CREATE OR REPLACE FUNCTION public.expire_organisation_invitations(p_organisation_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_count int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_organisation_id IS NOT NULL THEN
    IF NOT (
      public.has_org_permission(p_organisation_id, 'user.manage')
      OR public.is_platform_admin()
    ) THEN
      RAISE EXCEPTION 'Missing permission: user.manage' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'organisation_id required unless platform admin' USING ERRCODE = '42501';
  END IF;

  UPDATE public.organisation_invitations
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending'
    AND expires_at < now()
    AND (p_organisation_id IS NULL OR organisation_id = p_organisation_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('expired_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_organisation_invitation(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_organisation_invitations(uuid) TO authenticated, service_role;

COMMIT;
