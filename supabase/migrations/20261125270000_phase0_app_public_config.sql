-- Public runtime config for the Command SPA (readable by anon; no secrets).
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_public_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_public_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_public_config_select ON public.app_public_config;
CREATE POLICY app_public_config_select ON public.app_public_config
  FOR SELECT TO anon, authenticated
  USING (true);

REVOKE ALL ON TABLE public.app_public_config FROM PUBLIC;
GRANT SELECT ON TABLE public.app_public_config TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_public_config TO service_role;

INSERT INTO public.app_public_config (key, value) VALUES
  ('api_base_url', jsonb_build_object('url', '')),
  ('command_title', jsonb_build_object('title', 'Sentinel Command'))
ON CONFLICT (key) DO NOTHING;

COMMIT;
