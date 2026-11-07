-- Rollback-only least-privilege regression for anonymous Data API sessions.
-- Authenticated member/admin access remains governed by the RLS policies.
BEGIN;

DO $anonymous_public_privileges$
DECLARE
  v_relation record;
  v_sequence record;
  v_privilege text;
  v_qual text;
BEGIN
  -- Existing public tables/views must not grant direct privileges to anon.
  FOR v_relation IN
    SELECT c.oid, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
      IF has_table_privilege('anon', v_relation.oid, v_privilege) THEN
        RAISE EXCEPTION 'Anonymous role still has % on %.%', v_privilege, v_relation.nspname, v_relation.relname;
      END IF;
    END LOOP;
  END LOOP;

  -- Existing sequences and sequence defaults must not be directly usable by anon.
  FOR v_sequence IN
    SELECT c.oid, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF has_sequence_privilege('anon', v_sequence.oid, v_privilege) THEN
        RAISE EXCEPTION 'Anonymous role still has % on sequence %.%', v_privilege, v_sequence.nspname, v_sequence.relname;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
  ) THEN
    RAISE EXCEPTION 'Anonymous table/sequence privileges remain in public-schema default ACLs';
  END IF;

  -- Servants read only their own availability; admins retain the all-row path.
  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'servant_availability'
    AND policyname = 'users read own availability'
    AND cmd = 'SELECT';
  IF v_qual IS NULL
     OR position('auth.uid()' IN v_qual) = 0
     OR position('servants' IN v_qual) = 0
     OR position('is_admin' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'Availability SELECT policy must restrict servants to their linked profile and retain admin access';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'servant_availability'
      AND cmd = 'SELECT'
      AND (qual IS NULL OR btrim(qual) = 'true')
  ) THEN
    RAISE EXCEPTION 'A blanket Availability SELECT policy is not permitted';
  END IF;

  -- Servants see published schedules and assignments; administrators can
  -- still see drafts through the is_admin() branch.
  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'schedules'
    AND policyname = 'users read published schedules'
    AND cmd = 'SELECT';
  IF v_qual IS NULL
     OR position('published' IN v_qual) = 0
     OR position('is_admin' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'Schedule SELECT policy must limit servants to published rows and retain admin access';
  END IF;

  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'assignments'
    AND policyname = 'users read published assignments'
    AND cmd = 'SELECT';
  IF v_qual IS NULL
     OR position('published' IN v_qual) = 0
     OR position('is_admin' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'Assignment SELECT policy must limit servants to published services and retain admin access';
  END IF;

  -- Explicitly verify the core application tables remain protected by RLS.
  FOR v_relation IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'profiles', 'member_profiles', 'servants', 'locations',
        'service_templates', 'schedules', 'assignments',
        'servant_availability', 'servant_availability_rules',
        'servant_serving_preferences', 'serving_requests',
        'serving_request_reads', 'serving_notifications',
        'serving_notification_preferences', 'serving_push_subscriptions',
        'serving_push_queue', 'audit_logs', 'system_settings'
      )
      AND c.relkind IN ('r', 'p')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_relation.relname
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', v_relation.relname;
    END IF;
  END LOOP;
END;
$anonymous_public_privileges$;

ROLLBACK;
