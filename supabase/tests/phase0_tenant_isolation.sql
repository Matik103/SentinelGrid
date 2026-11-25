-- SentinelGrid Phase 0 security regression tests
-- Run as Postgres superuser against a disposable local database.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase0_tenant_isolation.sql

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION pg_temp.fail(msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FAIL: %', msg;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.pass(msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'PASS: %', msg;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.set_auth(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.clear_auth()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

DO $$
DECLARE
  u_admin_a uuid := gen_random_uuid();
  u_member_a uuid := gen_random_uuid();
  u_viewer_a uuid := gen_random_uuid();
  u_admin_b uuid := gen_random_uuid();
  u_outsider uuid := gen_random_uuid();
  org_a uuid;
  org_b uuid;
  role_admin uuid;
  role_viewer uuid;
  role_platform uuid;
  fac_a uuid;
  fac_b uuid;
  asset_a uuid;
  asset_b uuid;
  device_a uuid;
  event_a uuid;
  evidence_a uuid;
  connector_a uuid;
  dlq_a uuid;
  membership_id uuid;
  tmp_count int;
  raised boolean;
BEGIN
  -- Create auth users (local only)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (u_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-a@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
    (u_member_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
    (u_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer-a@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
    (u_admin_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-b@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
    (u_outsider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

  SELECT id INTO role_admin FROM public.roles WHERE key = 'organisation_administrator';
  SELECT id INTO role_viewer FROM public.roles WHERE key = 'read_only_viewer';
  SELECT id INTO role_platform FROM public.roles WHERE key = 'platform_administrator';

  -- 1) Direct authenticated INSERT into organisations denied
  PERFORM pg_temp.set_auth(u_outsider);
  raised := false;
  BEGIN
    INSERT INTO public.organisations (name, slug) VALUES ('Evil Org', 'evil-org');
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('authenticated direct organisations INSERT should be denied');
  END IF;
  PERFORM pg_temp.pass('direct organisations INSERT denied');
  PERFORM pg_temp.clear_auth();

  -- 2) bootstrap_organisation creates org + first admin
  PERFORM pg_temp.set_auth(u_admin_a);
  org_a := public.bootstrap_organisation('Org Alpha Test', 'org-alpha-test');
  PERFORM pg_temp.clear_auth();

  IF org_a IS NULL THEN
    PERFORM pg_temp.fail('bootstrap_organisation returned null');
  END IF;
  SELECT count(*) INTO tmp_count FROM public.memberships
  WHERE organisation_id = org_a AND user_id = u_admin_a AND status = 'active' AND role_id = role_admin;
  IF tmp_count <> 1 THEN
    PERFORM pg_temp.fail('bootstrap did not assign organisation_administrator');
  END IF;
  PERFORM pg_temp.pass('bootstrap_organisation assigns first admin');

  PERFORM pg_temp.set_auth(u_admin_b);
  org_b := public.bootstrap_organisation('Org Beta Test', 'org-beta-test');
  PERFORM pg_temp.clear_auth();
  PERFORM pg_temp.pass('second organisation provisioned');

  -- 3) Regular member cannot manage memberships (admin invites viewer first as active via admin)
  PERFORM pg_temp.set_auth(u_admin_a);
  INSERT INTO public.memberships (organisation_id, user_id, role_id, status)
  VALUES (org_a, u_member_a, role_viewer, 'active');
  PERFORM pg_temp.clear_auth();

  PERFORM pg_temp.set_auth(u_member_a);
  raised := false;
  BEGIN
    INSERT INTO public.memberships (organisation_id, user_id, role_id, status)
    VALUES (org_a, u_outsider, role_admin, 'active');
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('viewer/member must not insert memberships');
  END IF;
  PERFORM pg_temp.pass('non-admin membership insert denied');

  -- membership escalation: assign self admin role
  raised := false;
  BEGIN
    UPDATE public.memberships SET role_id = role_admin
    WHERE organisation_id = org_a AND user_id = u_member_a;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    raised := true;
  END;
  IF NOT raised THEN
    -- UPDATE may succeed with 0 rows under RLS; check role unchanged
    NULL;
  END IF;
  PERFORM pg_temp.clear_auth();
  SELECT count(*) INTO tmp_count FROM public.memberships
  WHERE organisation_id = org_a AND user_id = u_member_a AND role_id = role_admin;
  IF tmp_count <> 0 THEN
    PERFORM pg_temp.fail('member escalated own role to organisation_administrator');
  END IF;
  PERFORM pg_temp.pass('membership self-escalation blocked');

  -- 4) Org admin cannot assign platform_administrator
  PERFORM pg_temp.set_auth(u_admin_a);
  raised := false;
  BEGIN
    INSERT INTO public.memberships (organisation_id, user_id, role_id, status)
    VALUES (org_a, u_outsider, role_platform, 'active');
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('org admin assigned platform_administrator');
  END IF;
  PERFORM pg_temp.pass('platform_administrator assignment blocked for org admin');
  PERFORM pg_temp.clear_auth();

  -- 5) Cross-tenant reads denied
  PERFORM pg_temp.set_auth(u_admin_a);
  INSERT INTO public.facilities (organisation_id, name, code) VALUES (org_a, 'Plant A', 'PA') RETURNING id INTO fac_a;
  PERFORM pg_temp.clear_auth();
  PERFORM pg_temp.set_auth(u_admin_b);
  INSERT INTO public.facilities (organisation_id, name, code) VALUES (org_b, 'Plant B', 'PB') RETURNING id INTO fac_b;
  PERFORM pg_temp.clear_auth();

  PERFORM pg_temp.set_auth(u_admin_a);
  SELECT count(*) INTO tmp_count FROM public.facilities WHERE id = fac_b;
  IF tmp_count <> 0 THEN
    PERFORM pg_temp.fail('org A admin can read org B facility');
  END IF;
  PERFORM pg_temp.pass('cross-tenant facility SELECT denied');

  raised := false;
  BEGIN
    UPDATE public.facilities SET name = 'Hijacked' WHERE id = fac_b;
    GET DIAGNOSTICS tmp_count = ROW_COUNT;
    IF tmp_count > 0 THEN
      raised := false;
    ELSE
      raised := true; -- RLS filtered all rows
    END IF;
  EXCEPTION WHEN others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('org A admin updated org B facility');
  END IF;
  PERFORM pg_temp.pass('cross-tenant facility UPDATE denied');
  PERFORM pg_temp.clear_auth();

  -- 6) Cross-tenant asset/device FK rejected
  PERFORM pg_temp.set_auth(u_admin_a);
  INSERT INTO public.assets (organisation_id, facility_id, name)
  VALUES (org_a, fac_a, 'Asset A') RETURNING id INTO asset_a;
  PERFORM pg_temp.clear_auth();
  PERFORM pg_temp.set_auth(u_admin_b);
  INSERT INTO public.assets (organisation_id, facility_id, name)
  VALUES (org_b, fac_b, 'Asset B') RETURNING id INTO asset_b;

  raised := false;
  BEGIN
    INSERT INTO public.devices (organisation_id, facility_id, asset_id, name)
    VALUES (org_b, fac_b, asset_a, 'Cross device');
  EXCEPTION WHEN foreign_key_violation OR others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('cross-tenant device.asset_id FK allowed');
  END IF;
  PERFORM pg_temp.pass('cross-tenant device/asset FK rejected');

  raised := false;
  BEGIN
    INSERT INTO public.assets (organisation_id, facility_id, name)
    VALUES (org_b, fac_a, 'Bad facility link');
  EXCEPTION WHEN foreign_key_violation OR others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('cross-tenant asset.facility_id FK allowed');
  END IF;
  PERFORM pg_temp.pass('cross-tenant asset/facility FK rejected');
  PERFORM pg_temp.clear_auth();

  -- 7) Client-supplied org id alone does not grant access
  PERFORM pg_temp.set_auth(u_outsider);
  SELECT count(*) INTO tmp_count FROM public.facilities WHERE organisation_id = org_a;
  IF tmp_count <> 0 THEN
    PERFORM pg_temp.fail('outsider read facilities by guessing organisation_id');
  END IF;
  raised := false;
  BEGIN
    INSERT INTO public.facilities (organisation_id, name, code) VALUES (org_a, 'Injected', 'INJ');
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('outsider inserted facility with stolen organisation_id');
  END IF;
  PERFORM pg_temp.pass('client-supplied organisation_id does not grant access');
  PERFORM pg_temp.clear_auth();

  -- 8) RBAC: read-only viewer cannot mutate
  PERFORM pg_temp.set_auth(u_admin_a);
  INSERT INTO public.memberships (organisation_id, user_id, role_id, status)
  VALUES (org_a, u_viewer_a, role_viewer, 'active')
  ON CONFLICT (organisation_id, user_id) DO UPDATE SET role_id = role_viewer, status = 'active';
  PERFORM pg_temp.clear_auth();

  PERFORM pg_temp.set_auth(u_viewer_a);
  SELECT count(*) INTO tmp_count FROM public.facilities WHERE organisation_id = org_a;
  IF tmp_count < 1 THEN
    PERFORM pg_temp.fail('viewer cannot read facilities');
  END IF;
  raised := false;
  BEGIN
    INSERT INTO public.facilities (organisation_id, name, code) VALUES (org_a, 'Viewer Plant', 'VP');
  EXCEPTION WHEN others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('viewer inserted facility');
  END IF;
  PERFORM pg_temp.pass('read_only_viewer cannot mutate facilities');
  PERFORM pg_temp.clear_auth();

  -- 9) Revoked membership loses access
  PERFORM pg_temp.set_auth(u_admin_a);
  UPDATE public.memberships SET status = 'revoked'
  WHERE organisation_id = org_a AND user_id = u_member_a;
  PERFORM pg_temp.clear_auth();

  PERFORM pg_temp.set_auth(u_member_a);
  SELECT count(*) INTO tmp_count FROM public.facilities WHERE organisation_id = org_a;
  IF tmp_count <> 0 THEN
    PERFORM pg_temp.fail('revoked member still reads facilities');
  END IF;
  PERFORM pg_temp.pass('revoked membership loses access');
  PERFORM pg_temp.clear_auth();

  -- 10) Events append-only
  PERFORM pg_temp.set_auth(u_admin_a);
  INSERT INTO public.devices (organisation_id, facility_id, name)
  VALUES (org_a, fac_a, 'Meter A') RETURNING id INTO device_a;
  INSERT INTO public.events (
    organisation_id, facility_id, asset_id, device_id,
    event_type, occurred_at, source, source_event_id, classification
  ) VALUES (
    org_a, fac_a, asset_a, device_a,
    'equipment.reading', now(), 'test', 'evt-1', 'simulated'
  ) RETURNING id INTO event_a;

  raised := false;
  BEGIN
    UPDATE public.events SET event_type = 'tampered' WHERE id = event_a;
    GET DIAGNOSTICS tmp_count = ROW_COUNT;
    IF tmp_count > 0 THEN raised := false; ELSE raised := true; END IF;
  EXCEPTION WHEN insufficient_privilege OR others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('authenticated UPDATE on events succeeded');
  END IF;

  raised := false;
  BEGIN
    DELETE FROM public.events WHERE id = event_a;
    GET DIAGNOSTICS tmp_count = ROW_COUNT;
    IF tmp_count > 0 THEN raised := false; ELSE raised := true; END IF;
  EXCEPTION WHEN insufficient_privilege OR others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('authenticated DELETE on events succeeded');
  END IF;
  PERFORM pg_temp.pass('events append-only for authenticated');

  -- 11) Evidence append-only + audit insert denied
  INSERT INTO public.evidence_records (
    organisation_id, event_id, payload_sha256, payload_ref
  ) VALUES (
    org_a, event_a, repeat('a', 64), 'payload://local/test-1'
  ) RETURNING id INTO evidence_a;

  raised := false;
  BEGIN
    UPDATE public.evidence_records SET payload_sha256 = repeat('b', 64) WHERE id = evidence_a;
    GET DIAGNOSTICS tmp_count = ROW_COUNT;
    IF tmp_count > 0 THEN raised := false; ELSE raised := true; END IF;
  EXCEPTION WHEN others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('authenticated UPDATE on evidence_records succeeded');
  END IF;

  raised := false;
  BEGIN
    INSERT INTO public.audit_logs (organisation_id, action, resource_type, resource_id)
    VALUES (org_a, 'forged.action', 'test', '1');
  EXCEPTION WHEN others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('authenticated audit_logs INSERT succeeded');
  END IF;
  PERFORM pg_temp.pass('evidence append-only; audit insert denied for authenticated');
  PERFORM pg_temp.clear_auth();

  -- 12) service_role can insert audit (bypass RLS)
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  EXECUTE 'SET LOCAL ROLE service_role';
  INSERT INTO public.audit_logs (organisation_id, action, resource_type, resource_id)
  VALUES (org_a, 'service.audit', 'test', '1');
  RESET ROLE;
  PERFORM pg_temp.pass('service_role can write audit_logs');

  -- 13) Invite accept path + membership identity immutability
  PERFORM pg_temp.set_auth(u_admin_a);
  INSERT INTO public.memberships (organisation_id, user_id, role_id, status)
  VALUES (org_a, u_outsider, role_viewer, 'invited')
  ON CONFLICT (organisation_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id, status = 'invited';
  PERFORM pg_temp.clear_auth();

  PERFORM pg_temp.set_auth(u_outsider);
  UPDATE public.memberships
  SET status = 'active'
  WHERE organisation_id = org_a AND user_id = u_outsider AND status = 'invited';
  GET DIAGNOSTICS tmp_count = ROW_COUNT;
  IF tmp_count <> 1 THEN
    PERFORM pg_temp.fail('invitee could not accept invitation');
  END IF;
  PERFORM pg_temp.pass('invitee can accept invitation');

  raised := false;
  BEGIN
    UPDATE public.memberships
    SET organisation_id = org_b
    WHERE organisation_id = org_a AND user_id = u_outsider;
  EXCEPTION WHEN others THEN
    raised := true;
  END;
  PERFORM pg_temp.clear_auth();
  -- Even as admin of A, identity mutation must fail
  PERFORM pg_temp.set_auth(u_admin_a);
  raised := false;
  BEGIN
    UPDATE public.memberships
    SET user_id = u_admin_b
    WHERE organisation_id = org_a AND user_id = u_outsider;
  EXCEPTION WHEN others THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('membership identity mutation was allowed');
  END IF;
  PERFORM pg_temp.pass('membership identity immutable');
  PERFORM pg_temp.clear_auth();

  -- 14) platform admin is not granted via memberships; separate table required
  SELECT count(*) INTO tmp_count FROM public.platform_admins;
  IF tmp_count <> 0 THEN
    PERFORM pg_temp.fail('unexpected platform_admins rows before bootstrap');
  END IF;
  -- Out-of-band bootstrap of first platform admin (service/postgres only)
  INSERT INTO public.platform_admins (user_id, status, granted_by)
  VALUES (u_admin_a, 'active', u_admin_a);
  PERFORM pg_temp.set_auth(u_admin_a);
  IF NOT public.is_platform_admin() THEN
    PERFORM pg_temp.fail('is_platform_admin false after platform_admins insert');
  END IF;
  PERFORM public.grant_platform_admin(u_admin_b);
  PERFORM pg_temp.clear_auth();
  SELECT count(*) INTO tmp_count FROM public.platform_admins WHERE user_id = u_admin_b AND status = 'active';
  IF tmp_count <> 1 THEN
    PERFORM pg_temp.fail('grant_platform_admin failed');
  END IF;
  PERFORM pg_temp.pass('platform admin boundary uses platform_admins table');

  -- 15) bootstrap writes audit
  SELECT count(*) INTO tmp_count FROM public.audit_logs
  WHERE action = 'organisation.provision' AND organisation_id = org_a;
  IF tmp_count < 1 THEN
    PERFORM pg_temp.fail('bootstrap did not write audit log');
  END IF;
  PERFORM pg_temp.pass('bootstrap_organisation writes audit log');

  -- 16) DLQ tenant integrity and read isolation
  INSERT INTO public.connectors (organisation_id, name, connector_uid)
  VALUES (org_a, 'Connector A', 'connector-a-test') RETURNING id INTO connector_a;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  EXECUTE 'SET LOCAL ROLE service_role';
  INSERT INTO public.event_ingestion_dlq (
    organisation_id, connector_id, source, source_event_id, failure_reason, raw_body, status
  ) VALUES (
    org_a, connector_a, 'test', 'bad-evt-1', 'test failure',
    jsonb_build_object('organisation_id', org_a), 'open'
  ) RETURNING id INTO dlq_a;
  RESET ROLE;

  raised := false;
  BEGIN
    INSERT INTO public.event_ingestion_dlq (
      organisation_id, connector_id, failure_reason, raw_body
    ) VALUES (org_b, connector_a, 'cross tenant', '{}'::jsonb);
  EXCEPTION WHEN foreign_key_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('cross-tenant DLQ connector reference was accepted');
  END IF;
  PERFORM pg_temp.pass('cross-tenant DLQ connector reference rejected');

  raised := false;
  BEGIN
    INSERT INTO public.event_ingestion_dlq (organisation_id, failure_reason)
    VALUES (NULL, 'missing tenant');
  EXCEPTION WHEN not_null_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    PERFORM pg_temp.fail('tenantless DLQ record was accepted');
  END IF;
  PERFORM pg_temp.pass('tenantless DLQ record rejected');

  -- Tenant isolation must use a non-platform-admin org B principal.
  -- u_admin_b was granted platform_admins above (step 14); revoke for this check.
  DELETE FROM public.platform_admins WHERE user_id = u_admin_b;
  PERFORM pg_temp.set_auth(u_admin_b);
  IF public.is_platform_admin() THEN
    PERFORM pg_temp.fail('platform admin still active for org B isolation check');
  END IF;
  SELECT count(*) INTO tmp_count FROM public.event_ingestion_dlq WHERE id = dlq_a;
  IF tmp_count <> 0 THEN
    PERFORM pg_temp.fail('org B can read org A DLQ entry');
  END IF;
  PERFORM pg_temp.pass('DLQ records are tenant-isolated');

  -- Payload metadata is tenant-isolated as well.
  PERFORM pg_temp.clear_auth();
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  EXECUTE 'SET LOCAL ROLE service_role';
  INSERT INTO public.payload_objects (
    organisation_id, object_key, content_sha256, byte_length, storage_backend, classification
  ) VALUES (
    org_a, org_a::text || '/test/payload.json', repeat('a', 64), 4, 'local_dev', 'simulated'
  );
  RESET ROLE;
  PERFORM pg_temp.set_auth(u_admin_b);
  SELECT count(*) INTO tmp_count FROM public.payload_objects WHERE organisation_id = org_a;
  IF tmp_count <> 0 THEN
    PERFORM pg_temp.fail('org B can read org A payload metadata');
  END IF;
  PERFORM pg_temp.pass('payload metadata is tenant-isolated');
  PERFORM pg_temp.clear_auth();


  RAISE NOTICE 'ALL PHASE0 SECURITY TESTS PASSED';
END;
$$;
