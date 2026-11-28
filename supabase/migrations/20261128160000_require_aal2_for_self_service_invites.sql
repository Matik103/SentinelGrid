-- Require a verified email and AAL2 session before exposing or accepting
-- self-service workspace invitations. The invite email is resolved from auth.users
-- rather than trusting a potentially stale email claim in an existing JWT.
-- Forward-only; no hosted migration is applied by this commit.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_my_pending_organisation_invitations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email text;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'MFA verification required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(email))
  INTO v_email
  FROM auth.users
  WHERE id = auth.uid()
    AND email_confirmed_at IS NOT NULL;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'A confirmed account email is required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      i.id,
      i.organisation_id,
      o.name AS organisation_name,
      o.slug AS organisation_slug,
      r.key AS role_key,
      r.name AS role_name,
      i.expires_at,
      i.created_at
    FROM public.organisation_invitations i
    JOIN public.organisations o ON o.id = i.organisation_id
    JOIN public.roles r ON r.id = i.role_id
    WHERE i.status = 'pending'
      AND i.expires_at >= now()
      AND lower(i.email) = v_email
  ) x;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_my_pending_organisation_invitations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email text;
  v_invite public.organisation_invitations%ROWTYPE;
  v_membership_id uuid;
  v_role_key text;
  v_accepted jsonb := '[]'::jsonb;
  v_count int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'MFA verification required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(email))
  INTO v_email
  FROM auth.users
  WHERE id = auth.uid()
    AND email_confirmed_at IS NOT NULL;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'A confirmed account email is required' USING ERRCODE = '42501';
  END IF;

  FOR v_invite IN
    SELECT *
    FROM public.organisation_invitations
    WHERE status = 'pending'
      AND expires_at >= now()
      AND lower(email) = v_email
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
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
      jsonb_build_object(
        'membership_id', v_membership_id,
        'role_key', v_role_key,
        'via', 'authenticated_email',
        'aal', 'aal2'
      )
    );

    v_accepted := v_accepted || jsonb_build_array(jsonb_build_object(
      'invitation_id', v_invite.id,
      'organisation_id', v_invite.organisation_id,
      'membership_id', v_membership_id,
      'role_key', v_role_key,
      'status', 'accepted'
    ));
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('accepted_count', v_count, 'accepted', v_accepted);
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_pending_organisation_invitations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_my_pending_organisation_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_pending_organisation_invitations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_my_pending_organisation_invitations() TO authenticated, service_role;

COMMIT;
