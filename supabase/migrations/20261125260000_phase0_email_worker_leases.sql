-- Durable email worker leases and retry-safe completion.
BEGIN;
ALTER TABLE public.email_outbox
  DROP CONSTRAINT IF EXISTS email_outbox_status_check;
ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_status_check
  CHECK (status IN ('pending','processing','sent','failed','cancelled'));
ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

CREATE INDEX IF NOT EXISTS email_outbox_due_idx
  ON public.email_outbox (scheduled_at, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS email_outbox_lease_idx
  ON public.email_outbox (lease_expires_at)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.claim_email_outbox(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 120
) RETURNS SETOF public.email_outbox
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 100 OR p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'Invalid email worker claim bounds' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.email_outbox
    WHERE (status = 'pending' AND scheduled_at <= now())
       OR (status = 'processing' AND lease_expires_at < now())
    ORDER BY scheduled_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.email_outbox o
  SET status='processing',
      attempts=o.attempts+1,
      lease_token=gen_random_uuid(),
      lease_expires_at=now() + make_interval(secs => p_lease_seconds),
      updated_at=now()
  FROM candidates c
  WHERE o.id=c.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_email_outbox(
  p_id uuid, p_lease_token uuid, p_success boolean,
  p_provider_message_id text DEFAULT NULL, p_error text DEFAULT NULL,
  p_max_attempts integer DEFAULT 8
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_row public.email_outbox%ROWTYPE;
BEGIN
  UPDATE public.email_outbox
  SET status = CASE
        WHEN p_success THEN 'sent'
        WHEN attempts >= p_max_attempts THEN 'failed'
        ELSE 'pending'
      END,
      sent_at = CASE WHEN p_success THEN now() ELSE sent_at END,
      failed_at = CASE WHEN NOT p_success AND attempts >= p_max_attempts THEN now() ELSE NULL END,
      provider_message_id = CASE WHEN p_success THEN p_provider_message_id ELSE provider_message_id END,
      last_error = CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'delivery failed'),2000) END,
      scheduled_at = CASE WHEN NOT p_success AND attempts < p_max_attempts
        THEN now() + make_interval(secs => LEAST(3600, (30 * power(2, LEAST(attempts,7)))::integer))
        ELSE scheduled_at END,
      lease_token=NULL, lease_expires_at=NULL, updated_at=now()
  WHERE id=p_id AND status='processing' AND lease_token=p_lease_token
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated',false,'reason','lease_lost');
  END IF;
  RETURN jsonb_build_object('updated',true,'status',v_row.status,'attempts',v_row.attempts);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_email_outbox(integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_email_outbox(uuid,uuid,boolean,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox(integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_email_outbox(uuid,uuid,boolean,text,text,integer) TO service_role;
COMMIT;
