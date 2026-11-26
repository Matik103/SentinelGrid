-- SentinelGrid Phase 0 security hardening
-- Forward-only migration. Apply after 20261125160000_phase0_foundation.sql.
-- Existing cross-tenant relationships, if any, intentionally cause FK creation to fail:
-- reconcile those rows before applying rather than silently weakening tenant boundaries.

BEGIN;

-- ---------------------------------------------------------------------------
-- Tenant-consistent relationship keys
-- ---------------------------------------------------------------------------

ALTER TABLE public.facilities ADD CONSTRAINT facilities_org_id_id_key UNIQUE (organisation_id, id);
ALTER TABLE public.zones ADD CONSTRAINT zones_org_id_id_key UNIQUE (organisation_id, id);
ALTER TABLE public.assets ADD CONSTRAINT assets_org_id_id_key UNIQUE (organisation_id, id);
ALTER TABLE public.devices ADD CONSTRAINT devices_org_id_id_key UNIQUE (organisation_id, id);
ALTER TABLE public.sensors ADD CONSTRAINT sensors_org_id_id_key UNIQUE (organisation_id, id);
ALTER TABLE public.connectors ADD CONSTRAINT connectors_org_id_id_key UNIQUE (organisation_id, id);
ALTER TABLE public.events ADD CONSTRAINT events_org_id_id_key UNIQUE (organisation_id, id);

ALTER TABLE public.zones
  ADD CONSTRAINT zones_facility_same_org_fk
  FOREIGN KEY (organisation_id, facility_id)
  REFERENCES public.facilities (organisation_id, id);
ALTER TABLE public.assets
  ADD CONSTRAINT assets_facility_same_org_fk
  FOREIGN KEY (organisation_id, facility_id)
  REFERENCES public.facilities (organisation_id, id),
  ADD CONSTRAINT assets_zone_same_org_fk
  FOREIGN KEY (organisation_id, zone_id)
  REFERENCES public.zones (organisation_id, id),
  ADD CONSTRAINT assets_parent_same_org_fk
  FOREIGN KEY (organisation_id, parent_asset_id)
  REFERENCES public.assets (organisation_id, id);
ALTER TABLE public.devices
  ADD CONSTRAINT devices_facility_same_org_fk
  FOREIGN KEY (organisation_id, facility_id)
  REFERENCES public.facilities (organisation_id, id),
  ADD CONSTRAINT devices_asset_same_org_fk
  FOREIGN KEY (organisation_id, asset_id)
  REFERENCES public.assets (organisation_id, id);
ALTER TABLE public.sensors
  ADD CONSTRAINT sensors_facility_same_org_fk
  FOREIGN KEY (organisation_id, facility_id)
  REFERENCES public.facilities (organisation_id, id),
  ADD CONSTRAINT sensors_asset_same_org_fk
  FOREIGN KEY (organisation_id, asset_id)
  REFERENCES public.assets (organisation_id, id),
  ADD CONSTRAINT sensors_device_same_org_fk
  FOREIGN KEY (organisation_id, device_id)
  REFERENCES public.devices (organisation_id, id);
ALTER TABLE public.connectors
  ADD CONSTRAINT connectors_facility_same_org_fk
  FOREIGN KEY (organisation_id, facility_id)
  REFERENCES public.facilities (organisation_id, id);
ALTER TABLE public.events
  ADD CONSTRAINT events_facility_same_org_fk
  FOREIGN KEY (organisation_id, facility_id)
  REFERENCES public.facilities (organisation_id, id),
  ADD CONSTRAINT events_asset_same_org_fk
  FOREIGN KEY (organisation_id, asset_id)
  REFERENCES public.assets (organisation_id, id),
  ADD CONSTRAINT events_device_same_org_fk
  FOREIGN KEY (organisation_id, device_id)
  REFERENCES public.devices (organisation_id, id),
  ADD CONSTRAINT events_sensor_same_org_fk
  FOREIGN KEY (organisation_id, sensor_id)
  REFERENCES public.sensors (organisation_id, id),
  ADD CONSTRAINT events_connector_same_org_fk
  FOREIGN KEY (organisation_id, connector_id)
  REFERENCES public.connectors (organisation_id, id);
ALTER TABLE public.evidence_records
  ADD CONSTRAINT evidence_event_same_org_fk
  FOREIGN KEY (organisation_id, event_id)
  REFERENCES public.events (organisation_id, id);

-- ---------------------------------------------------------------------------
-- RBAC catalogue and permission mapping
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (key, description) VALUES
  ('evidence.write', 'Append evidence records and checkpoints')
ON CONFLICT (key) DO NOTHING;

-- Replace mappings deterministically; the role catalogue remains readable.
DELETE FROM public.role_permissions;
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.key = ANY (
  CASE r.key
    WHEN 'organisation_administrator' THEN ARRAY[
      'org.read','org.admin','facility.read','facility.write',
      'asset.read','asset.write','connector.read','connector.write',
      'event.read','event.ingest','evidence.read','evidence.write',
      'evidence.verify','audit.read','user.manage'
    ]
    WHEN 'facility_manager' THEN ARRAY[
      'org.read','facility.read','facility.write','asset.read','asset.write',
      'connector.read','event.read','evidence.read'
    ]
    WHEN 'security_analyst' THEN ARRAY[
      'org.read','facility.read','asset.read','connector.read',
      'event.read','evidence.read','evidence.verify','audit.read'
    ]
    WHEN 'operations_manager' THEN ARRAY[
      'org.read','facility.read','facility.write','asset.read','asset.write',
      'connector.read','event.read','evidence.read'
    ]
    WHEN 'read_only_viewer' THEN ARRAY[
      'org.read','facility.read','asset.read','connector.read',
      'event.read','evidence.read'
    ]
    WHEN 'platform_administrator' THEN ARRAY[
      'org.read','org.admin','facility.read','facility.write',
      'asset.read','asset.write','connector.read','connector.write',
      'event.read','event.ingest','evidence.read','evidence.write',
      'evidence.verify','audit.read','user.manage'
    ]
    ELSE ARRAY[]::text[]
  END
);

-- ---------------------------------------------------------------------------
-- Permission helpers. SECURITY DEFINER avoids RLS recursion on memberships.
-- Platform administrator membership must be provisioned out-of-band by trusted
-- platform operations; tenant administrators cannot assign that role.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_org_permission(p_organisation_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.role_permissions rp ON rp.role_id = m.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE m.organisation_id = p_organisation_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND p.key = p_permission
  );
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_organisation(p_name text, p_slug text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_organisation_id uuid;
  v_role_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_name), '') IS NULL OR nullif(btrim(p_slug), '') IS NULL THEN
    RAISE EXCEPTION 'Organisation name and slug are required' USING ERRCODE = '22023';
  END IF;
  IF length(p_slug) > 63 OR p_slug !~ '^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$' THEN
    RAISE EXCEPTION 'Invalid organisation slug' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE key = 'organisation_administrator';

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Organisation administrator role is not configured';
  END IF;

  INSERT INTO public.organisations (name, slug)
  VALUES (btrim(p_name), p_slug)
  RETURNING id INTO v_organisation_id;

  INSERT INTO public.memberships (organisation_id, user_id, role_id, status)
  VALUES (v_organisation_id, auth.uid(), v_role_id, 'active');

  RETURN v_organisation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_org_ids() TO authenticated;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
REVOKE ALL ON FUNCTION public.has_org_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_organisation(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_organisation(text, text) TO authenticated;

-- Do not permit direct client inserts into tenant roots. Provision through the
-- atomic bootstrap function or trusted service-role backend.
DROP POLICY IF EXISTS organisations_insert ON public.organisations;
CREATE POLICY organisations_insert_service_only ON public.organisations
  FOR INSERT TO service_role WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Replace membership write access with permission-gated policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS memberships_write ON public.memberships;
DROP POLICY IF EXISTS memberships_select ON public.memberships;

CREATE POLICY memberships_select ON public.memberships
  FOR SELECT TO authenticated
  USING (
    organisation_id IN (SELECT public.current_user_org_ids())
    OR user_id = auth.uid()
    OR public.is_platform_admin()
  );

CREATE POLICY memberships_insert_admin ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_org_permission(organisation_id, 'user.manage') OR public.is_platform_admin())
    AND role_id <> (SELECT id FROM public.roles WHERE key = 'platform_administrator')
  );

CREATE POLICY memberships_update_admin ON public.memberships
  FOR UPDATE TO authenticated
  USING (public.has_org_permission(organisation_id, 'user.manage') OR public.is_platform_admin())
  WITH CHECK (
    (public.has_org_permission(organisation_id, 'user.manage') OR public.is_platform_admin())
    AND role_id <> (SELECT id FROM public.roles WHERE key = 'platform_administrator')
  );

CREATE POLICY memberships_delete_admin ON public.memberships
  FOR DELETE TO authenticated
  USING (public.has_org_permission(organisation_id, 'user.manage') OR public.is_platform_admin());

-- Organisation metadata is administrator-only; tenant root deletion is not
-- available through the client API.
DROP POLICY IF EXISTS organisations_update ON public.organisations;
CREATE POLICY organisations_update_admin ON public.organisations
  FOR UPDATE TO authenticated
  USING (public.has_org_permission(id, 'org.admin'))
  WITH CHECK (public.has_org_permission(id, 'org.admin'));

-- ---------------------------------------------------------------------------
-- Permission-gated CRUD policies for mutable registry tables
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('facilities','facility.read','facility.write'),
      ('zones','facility.read','facility.write'),
      ('assets','asset.read','asset.write'),
      ('devices','asset.read','asset.write'),
      ('sensors','asset.read','asset.write'),
      ('connectors','connector.read','connector.write')
    ) AS t(table_name, read_permission, write_permission)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', item.table_name || '_tenant', item.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', item.table_name || '_select', item.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', item.table_name || '_insert', item.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', item.table_name || '_update', item.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', item.table_name || '_delete', item.table_name);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_org_permission(organisation_id, %L) OR public.is_platform_admin())',
      item.table_name || '_select', item.table_name, item.read_permission
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_org_permission(organisation_id, %L) OR public.is_platform_admin())',
      item.table_name || '_insert', item.table_name, item.write_permission
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_org_permission(organisation_id, %L) OR public.is_platform_admin()) WITH CHECK (public.has_org_permission(organisation_id, %L) OR public.is_platform_admin())',
      item.table_name || '_update', item.table_name, item.write_permission, item.write_permission
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_org_permission(organisation_id, %L) OR public.is_platform_admin())',
      item.table_name || '_delete', item.table_name, item.write_permission
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Append-only event and evidence records
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS events_tenant ON public.events;
CREATE POLICY events_select ON public.events
  FOR SELECT TO authenticated
  USING (public.has_org_permission(organisation_id, 'event.read') OR public.is_platform_admin());
CREATE POLICY events_insert ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_permission(organisation_id, 'event.ingest') OR public.is_platform_admin());
-- Deliberately no UPDATE or DELETE policy: corrections are new events.

DROP POLICY IF EXISTS evidence_tenant ON public.evidence_records;
CREATE POLICY evidence_records_select ON public.evidence_records
  FOR SELECT TO authenticated
  USING (public.has_org_permission(organisation_id, 'evidence.read') OR public.is_platform_admin());
CREATE POLICY evidence_records_insert ON public.evidence_records
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_permission(organisation_id, 'evidence.write') OR public.is_platform_admin());
-- Deliberately no UPDATE or DELETE policy.

DROP POLICY IF EXISTS evidence_checkpoints_tenant ON public.evidence_checkpoints;
CREATE POLICY evidence_checkpoints_select ON public.evidence_checkpoints
  FOR SELECT TO authenticated
  USING (public.has_org_permission(organisation_id, 'evidence.read') OR public.is_platform_admin());
CREATE POLICY evidence_checkpoints_insert ON public.evidence_checkpoints
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_permission(organisation_id, 'evidence.verify') OR public.is_platform_admin());
-- Deliberately no UPDATE or DELETE policy.

-- Audit records are written only by trusted backend/service-role code. There is
-- no authenticated INSERT policy, preventing client-forged audit history.
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_tenant ON public.audit_logs;
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.has_org_permission(organisation_id, 'audit.read')
    OR public.is_platform_admin()
  );

COMMIT;
