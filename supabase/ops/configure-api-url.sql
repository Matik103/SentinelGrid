-- Configure the public API origin after the Render service has a successful /v1/health check.
-- Run with psql and an explicit api_base_url variable:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -v api_base_url="https://YOUR-SERVICE.onrender.com" -f supabase/ops/configure-api-url.sql

\set ON_ERROR_STOP on
\if :{?api_base_url}
\else
  \echo 'ERROR: pass -v api_base_url=https://<real-api-host>'
  \quit
\endif

SELECT set_config('sentinelgrid.api_base_url', :'api_base_url', false);

DO $$
DECLARE
  v_url text := current_setting('sentinelgrid.api_base_url', true);
BEGIN
  IF v_url IS NULL OR v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$' THEN
    RAISE EXCEPTION 'api_base_url must be a real HTTPS origin without path, query, or fragment';
  END IF;

  INSERT INTO public.app_public_config (key, value, updated_at)
  VALUES ('api_base_url', jsonb_build_object('url', rtrim(v_url, '/')), now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();
END;
$$;

SELECT key, value, updated_at
FROM public.app_public_config
WHERE key = 'api_base_url';
