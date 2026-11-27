-- Repair peek_organisation_invitation: pgcrypto digest lives in extensions.
BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.peek_organisation_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_hash text;
  v_email text;
  v_status text;
  v_expires_at timestamptz;
  v_org_name text;
BEGIN
  IF nullif(btrim(p_token), '') IS NULL OR length(btrim(p_token)) < 16 THEN
    RETURN jsonb_build_object('found', false, 'reason', 'invalid_token');
  END IF;

  v_hash := encode(digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'), 'hex');

  SELECT i.email, i.status, i.expires_at, o.name
    INTO v_email, v_status, v_expires_at, v_org_name
  FROM public.organisation_invitations i
  LEFT JOIN public.organisations o ON o.id = i.organisation_id
  WHERE i.token_hash = v_hash
  LIMIT 1;

  IF v_email IS NULL THEN
    RETURN jsonb_build_object('found', false, 'reason', 'not_found');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'not_pending',
      'status', v_status
    );
  END IF;

  IF v_expires_at < now() THEN
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'expired',
      'email', lower(v_email)
    );
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'email', lower(v_email),
    'status', 'pending',
    'expires_at', v_expires_at,
    'organisation_name', v_org_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.peek_organisation_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_organisation_invitation(text) TO anon, authenticated, service_role;

COMMIT;
