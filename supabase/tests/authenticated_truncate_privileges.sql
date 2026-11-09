-- Rollback-only regression for authenticated TRUNCATE hardening.
-- The probe verifies the default privileges used by application migrations
-- that create public tables as postgres. Supabase-managed supabase_admin
-- defaults are platform-controlled and intentionally outside this assertion.
BEGIN;

-- This table is rolled back at the end. It proves that a future
-- postgres-owned public table does not inherit TRUNCATE for authenticated.
CREATE TABLE public.__gms_authenticated_truncate_probe (
  id bigint
);

DO $authenticated_truncate_privileges$
DECLARE
  v_relation record;
  v_privilege text;
  v_rls_table text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'Run this regression as postgres so it checks the application migration owner defaults';
  END IF;

  FOR v_relation IN
    SELECT c.oid, n.nspname, c.relname
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
    RAISE EXCEPTION
      'postgres-owned public table defaults still grant TRUNCATE to authenticated';
  END IF;

  -- Preserve ordinary application DML grants; RLS continues to control rows.
  FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('authenticated', 'public.schedules', v_privilege) THEN
      RAISE EXCEPTION 'authenticated lost required % privilege on public.schedules', v_privilege;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.assignments', v_privilege) THEN
      RAISE EXCEPTION 'authenticated lost required % privilege on public.assignments', v_privilege;
    END IF;
  END LOOP;

  -- This migration must not remove the backend worker's existing privilege.
  IF NOT has_table_privilege('service_role', 'public.schedules', 'TRUNCATE')
     OR NOT has_table_privilege('service_role', 'public.assignments', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role lost its existing TRUNCATE privilege on core schedule tables';
  END IF;

  -- The production and staging security boundary continues to rely on RLS.
  FOREACH v_rls_table IN ARRAY ARRAY[
    'schedules', 'assignments', 'servant_availability',
    'servant_availability_rules', 'servants', 'serving_requests'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_rls_table
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', v_rls_table;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('authenticated', 'public.serving_notifications', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost read access to serving_notifications';
  END IF;
END;
$authenticated_truncate_privileges$;

ROLLBACK;
