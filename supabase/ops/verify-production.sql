-- Read-only production readiness checks for SentinelGrid.
\set ON_ERROR_STOP on

SELECT key, value, updated_at
FROM public.app_public_config
WHERE key IN ('api_base_url', 'command_title')
ORDER BY key;

SELECT
  p.proname AS function_name,
  p.prosecdef AS security_definer,
  pg_get_userbyid(p.proowner) AS owner,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('ensure_own_profile', 'bootstrap_organisation',
                    'create_organisation_invitation', 'accept_organisation_invitation',
                    'claim_email_outbox', 'finish_email_outbox')
ORDER BY p.proname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname LIKE 'require_aal2_%'
ORDER BY tablename;

SELECT status, count(*) AS messages, min(created_at) AS oldest, max(created_at) AS newest
FROM public.email_outbox
GROUP BY status
ORDER BY status;
