-- Rollback-only regression for authenticated TRUNCATE hardening.
-- This test verifies current public tables and postgres-owned future-table ACLs.
BEGIN;

DO $authenticated_truncate_privileges$
DECLARE
  v_relation record;
  v_privilege text;
BEGIN
  FOR v_relation IN
    SELECT c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    IF has_table_privilege('authenticated', v_relation.oid, 'TRUNCATE') THEN
      RAISE EXCEPTION 'authenticated retains TRUNCATE on %.%',
        v_relation.nspname, v_relation.relname;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    WHERE d.defaclnamespace = 'public'::regnamespace
      AND d.defaclobjtype = 'r'
      AND d.defaclrole = 'postgres'::regrole
      AND acl.grantee = 'authenticated'::regrole
      AND acl.privilege_type = 'TRUNCATE'
  ) THEN
    RAISE EXCEPTION 'postgres-owned public table defaults still grant TRUNCATE to authenticated';
  END IF;

  -- Preserve ordinary application DML grants; row-level policies continue to
  -- decide which individual rows a servant or administrator may change.
  FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('authenticated', 'public.schedules', v_privilege) THEN
      RAISE EXCEPTION 'authenticated lost required % privilege on public.schedules', v_privilege;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.assignments', v_privilege) THEN
      RAISE EXCEPTION 'authenticated lost required % privilege on public.assignments', v_privilege;
    END IF;
  END LOOP;

  -- RLS must remain enabled on the operational tables after privilege changes.
  FOREACH v_privilege IN ARRAY ARRAY[
    'schedules', 'assignments', 'servant_availability',
    'servant_availability_rules', 'servants', 'serving_requests'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_privilege
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', v_privilege;
    END IF;
  END LOOP;

  -- Preserve the notification inbox read path. Its direct write ACL differs
  -- between environments, so this regression does not impose a new DML policy.
  IF NOT has_table_privilege('authenticated', 'public.serving_notifications', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost read access to serving_notifications';
  END IF;
END;
$authenticated_truncate_privileges$;

ROLLBACK;
