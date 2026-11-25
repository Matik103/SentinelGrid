-- Optional Phase 0 demo seed — clearly labelled SIMULATED
-- Run only in non-production or after explicit approval.

-- Two independent demo orgs (requires a real auth.users row for memberships later)
INSERT INTO public.organisations (name, slug, settings)
VALUES
  ('Demo Org Alpha (SIMULATED)', 'demo-org-alpha', '{"simulated": true}'::jsonb),
  ('Demo Org Beta (SIMULATED)', 'demo-org-beta', '{"simulated": true}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
