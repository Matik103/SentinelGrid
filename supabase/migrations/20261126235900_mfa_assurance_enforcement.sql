-- Require a verified Supabase TOTP assurance level for direct authenticated RLS access.
-- API routes independently enforce AAL2 in SupabaseAuthGuard; service-role calls bypass RLS
-- and therefore must never be treated as protected by this migration alone.

BEGIN;

DO $$
DECLARE
  target record;
  policy_name text;
BEGIN
  FOR target IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
  LOOP
    policy_name := 'require_aal2_' || substr(md5(target.nspname || '.' || target.relname), 1, 12);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = target.nspname
        AND p.tablename = target.relname
        AND p.policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((auth.jwt() ->> ''aal'') = ''aal2'') WITH CHECK ((auth.jwt() ->> ''aal'') = ''aal2'')',
        policy_name,
        target.nspname,
        target.relname
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
