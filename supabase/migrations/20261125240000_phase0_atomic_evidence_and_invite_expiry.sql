-- Phase 0 follow-up: serialize evidence appends and persist invite expiry independently.
BEGIN;

CREATE OR REPLACE FUNCTION public.append_evidence_record(
  p_organisation_id uuid, p_event_id uuid, p_payload_object_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_payload public.payload_objects%ROWTYPE; v_event public.events%ROWTYPE;
  v_previous text; v_chain text; v_record public.evidence_records%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organisation_id::text, 0));
  SELECT * INTO v_payload FROM public.payload_objects
    WHERE id = p_payload_object_id AND organisation_id = p_organisation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payload object not found for organisation' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_event FROM public.events
    WHERE id = p_event_id AND organisation_id = p_organisation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found for organisation' USING ERRCODE='P0002'; END IF;
  SELECT chain_hash INTO v_previous FROM public.evidence_records
    WHERE organisation_id = p_organisation_id ORDER BY created_at DESC, id DESC LIMIT 1;
  v_chain := encode(digest(convert_to(coalesce(v_previous,'') || '|' || v_payload.content_sha256 || '|' || p_event_id::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.evidence_records(organisation_id,event_id,payload_sha256,payload_ref,previous_hash,chain_hash,integrity_status,metadata)
    VALUES(p_organisation_id,p_event_id,v_payload.content_sha256,v_payload.object_key,v_previous,v_chain,
      CASE WHEN v_previous IS NULL THEN 'hashed' ELSE 'chained' END,jsonb_build_object('payload_object_id',p_payload_object_id))
    RETURNING * INTO v_record;
  UPDATE public.events SET integrity_status=CASE WHEN v_previous IS NULL THEN 'hashed' ELSE 'chained' END,
    payload_object_id=p_payload_object_id, original_payload_ref=v_payload.object_key
    WHERE id=p_event_id AND organisation_id=p_organisation_id;
  RETURN jsonb_build_object('evidence_id',v_record.id,'event_id',v_record.event_id,
    'payload_sha256',v_record.payload_sha256,'previous_hash',v_record.previous_hash,'chain_hash',v_record.chain_hash);
END; $$;
REVOKE ALL ON FUNCTION public.append_evidence_record(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_evidence_record(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_organisation_invitation_by_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE v_hash text; v_email text; v_id uuid; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF nullif(btrim(p_token),'') IS NULL THEN RAISE EXCEPTION 'Invite token required' USING ERRCODE='22023'; END IF;
  v_email := lower(coalesce(auth.jwt()->>'email',''));
  IF v_email = '' THEN SELECT lower(email) INTO v_email FROM auth.users WHERE id=auth.uid(); END IF;
  v_hash := encode(digest(convert_to(btrim(p_token),'UTF8'),'sha256'),'hex');
  UPDATE public.organisation_invitations SET status='expired', updated_at=now()
    WHERE token_hash=v_hash AND lower(email)=v_email AND status='pending' AND expires_at < now()
    RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('status','expired'); END IF;
  SELECT status INTO v_status FROM public.organisation_invitations
    WHERE token_hash=v_hash AND lower(email)=v_email;
  RETURN jsonb_build_object('status',coalesce(v_status,'not_found'));
END; $$;
REVOKE ALL ON FUNCTION public.expire_organisation_invitation_by_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_organisation_invitation_by_token(text) TO authenticated, service_role;
COMMIT;
