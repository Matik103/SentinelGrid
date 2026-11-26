-- Facility-level authorization for facility_manager memberships.
-- Managers are restricted to explicitly assigned facilities; all other roles
-- retain their existing organisation-level permission checks.
BEGIN;

CREATE TABLE IF NOT EXISTS public.facility_user_assignments (
  organisation_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  user_id uuid NOT NULL,
  assigned_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, facility_id, user_id),
  CONSTRAINT facility_assignment_facility_fk
    FOREIGN KEY (organisation_id, facility_id)
    REFERENCES public.facilities (organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT facility_assignment_member_fk
    FOREIGN KEY (organisation_id, user_id)
    REFERENCES public.memberships (organisation_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS facility_user_assignments_user_idx
  ON public.facility_user_assignments (organisation_id, user_id, facility_id);

ALTER TABLE public.facility_user_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_facility_manager(p_organisation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.organisation_id = p_organisation_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND r.key = 'facility_manager'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_facility_access(
  p_organisation_id uuid, p_facility_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN public.is_platform_admin() THEN true
    WHEN NOT public.is_facility_manager(p_organisation_id)
      THEN public.has_org_permission(p_organisation_id, 'facility.read')
    ELSE EXISTS (
      SELECT 1 FROM public.facility_user_assignments a
      WHERE a.organisation_id = p_organisation_id
        AND a.facility_id = p_facility_id
        AND a.user_id = auth.uid()
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_facility_manager(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_facility_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_facility_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_facility_access(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS facility_assignments_select ON public.facility_user_assignments;
DROP POLICY IF EXISTS facility_assignments_manage ON public.facility_user_assignments;
CREATE POLICY facility_assignments_select ON public.facility_user_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_org_permission(organisation_id, 'user.manage')
    OR public.is_platform_admin()
  );
CREATE POLICY facility_assignments_manage ON public.facility_user_assignments
  FOR ALL TO authenticated
  USING (
    public.has_org_permission(organisation_id, 'user.manage')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    (public.has_org_permission(organisation_id, 'user.manage')
      OR public.is_platform_admin())
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.organisation_id = facility_user_assignments.organisation_id
        AND m.user_id = facility_user_assignments.user_id
        AND m.status = 'active'
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_user_assignments TO authenticated;

-- Registry tables: scope rows by their direct facility_id. For managers,
-- unassigned facilities are invisible and cannot be mutated.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities','zones','assets','devices','sensors','connectors']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    IF t = 'facilities' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((public.has_org_permission(organisation_id, %L) AND (NOT public.is_facility_manager(organisation_id) OR public.has_facility_access(organisation_id, id))) OR public.is_platform_admin())',
        t || '_select', t, 'facility.read');
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_org_permission(organisation_id, %L) AND NOT public.is_facility_manager(organisation_id) OR public.is_platform_admin())',
        t || '_insert', t, 'facility.write');
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((public.has_org_permission(organisation_id, %L) AND (NOT public.is_facility_manager(organisation_id) OR public.has_facility_access(organisation_id, id))) OR public.is_platform_admin()) WITH CHECK ((public.has_org_permission(organisation_id, %L) AND (NOT public.is_facility_manager(organisation_id) OR public.has_facility_access(organisation_id, id))) OR public.is_platform_admin())',
        t || '_update', t, 'facility.write', 'facility.write');
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((public.has_org_permission(organisation_id, %L) AND (NOT public.is_facility_manager(organisation_id) OR public.has_facility_access(organisation_id, id))) OR public.is_platform_admin())',
        t || '_delete', t, 'facility.write');
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((public.has_org_permission(organisation_id, %L) AND (NOT public.is_facility_manager(organisation_id) OR public.has_facility_access(organisation_id, facility_id))) OR public.is_platform_admin())',
        t || '_select', t, CASE WHEN t IN ('zones') THEN 'facility.read' ELSE CASE WHEN t IN ('connectors') THEN 'connector.read' ELSE 'asset.read' END END);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((public.has_org_permission(organisation_id, %L) AND (NOT public.is_facility_manager(organisation_id) OR public.has_facility_access(organisation_id, facility_id))) OR public.is_platform_admin())',
        t || '_insert', t, CASE WHEN t IN ('zones') THEN 'facility.write' ELSE CASE WHEN t IN ('connectors') THEN 'connector.write' ELSE 'asset.write' END END);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((public.has_org_permission(organisation_id, %L) AND (NOT public.is_facility_manager(organisation_id) OR public.has_facility_access(organisation_id, facility_id))) OR public.is_platform_admin()) WITH CHECK ((public.has_org_permission(organisation_id, %L) AND (NOT public.is_facility_manager(organisation_id) OR public.has_facility_access(organisation_id, facility_id))) OR public.is_platform_admin())',
        t || '_update', t, CASE WHEN t IN ('zones') THEN 'facility.write' ELSE CASE WHEN t IN ('connectors') THEN 'connector.write' ELSE 'asset.write' END END, CASE WHEN t IN ('zones') THEN 'facility.write' ELSE CASE WHEN t IN ('connectors') THEN 'connector.write' ELSE 'asset.write' END END);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((public.has_org_permission(organisation_id, %L) AND (NOT public.is_facility_manager(organisation_id) OR public.has_facility_access(organisation_id, facility_id))) OR public.is_platform_admin())',
        t || '_delete', t, CASE WHEN t IN ('zones') THEN 'facility.write' ELSE CASE WHEN t IN ('connectors') THEN 'connector.write' ELSE 'asset.write' END END);
    END IF;
  END LOOP;
END $$;

-- Events without a facility are deliberately excluded from facility managers.
DROP POLICY IF EXISTS events_select ON public.events;
CREATE POLICY events_select ON public.events
  FOR SELECT TO authenticated
  USING (
    (public.has_org_permission(organisation_id, 'event.read')
      AND (NOT public.is_facility_manager(organisation_id)
        OR (facility_id IS NOT NULL AND public.has_facility_access(organisation_id, facility_id))))
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS evidence_records_select ON public.evidence_records;
CREATE POLICY evidence_records_select ON public.evidence_records
  FOR SELECT TO authenticated
  USING (
    (public.has_org_permission(organisation_id, 'evidence.read')
      AND (NOT public.is_facility_manager(organisation_id)
        OR EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.organisation_id = evidence_records.organisation_id
            AND e.id = evidence_records.event_id
            AND e.facility_id IS NOT NULL
            AND public.has_facility_access(e.organisation_id, e.facility_id)
        )))
    OR public.is_platform_admin()
  );

COMMIT;
