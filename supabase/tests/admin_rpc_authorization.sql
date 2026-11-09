-- Rollback-only authorization regression for admin SECURITY DEFINER RPCs.
-- Uses existing staging admin and servant profiles; does not modify profile roles.
-- Run only against staging via the STAGING_DATABASE_URL workflow secret.
BEGIN;
DO $admin_rpc_authorization$
DECLARE
  v_admin uuid;
  v_servant uuid;
  v_message text;
  v_case record;
  v_function regprocedure;
BEGIN
  SELECT id INTO v_admin FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_servant FROM public.profiles WHERE role='servant' ORDER BY created_at LIMIT 1;
  IF v_admin IS NULL OR v_servant IS NULL THEN
    RAISE EXCEPTION 'Existing admin and servant profiles are required';
  END IF;

  -- These API entry points are intentionally callable by authenticated users,
  -- but none may be executable by the anonymous role.
  FOR v_function IN
    SELECT to_regprocedure(signature)
    FROM (VALUES
      ('public.admin_bulk_assignments_grouped(jsonb,text)'),
      ('public.admin_execute_servant_swap(uuid)'),
      ('public.admin_link_servant_account(uuid,uuid,text)'),
      ('public.admin_publish_schedules_grouped(uuid,uuid[],text)'),
      ('public.admin_resolve_replacement(uuid,uuid)'),
      ('public.admin_save_schedule_with_assignments(uuid,jsonb,jsonb)'),
      ('public.is_admin()'),
      ('public.notify_admin_assignment_confirmation(uuid)'),
      ('public.register_serving_push_subscription(text,text,text,text)')
    ) AS functions(signature)
  LOOP
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'A required security-definer API function is missing';
    END IF;
    IF NOT has_function_privilege('authenticated',v_function,'EXECUTE') THEN
      RAISE EXCEPTION 'Authenticated execution is missing for %',v_function;
    END IF;
    IF has_function_privilege('anon',v_function,'EXECUTE') THEN
      RAISE EXCEPTION 'Anonymous execution is unexpectedly granted for %',v_function;
    END IF;
  END LOOP;

  -- The RLS helper must evaluate the JWT identity, not a global role flag.
  PERFORM set_config('request.jwt.claim.sub',v_servant::text,true);
  IF public.is_admin() THEN
    RAISE EXCEPTION 'is_admin() returned true for a servant identity';
  END IF;

  -- Servant identity must be rejected by every admin-only RPC.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('select public.admin_bulk_assignments_grouped(null,null)',
       'Only administrators can bulk assign servants'),
      ('select public.admin_execute_servant_swap(''00000000-0000-0000-0000-000000000001''::uuid)',
       'Only administrators can approve and execute swaps'),
      ('select public.admin_link_servant_account(null,null,null)',
       'Only administrators can link servant accounts'),
      ('select public.admin_publish_schedules_grouped(null,null,''invalid'')',
       'Only administrators can publish schedules'),
      ('select public.admin_resolve_replacement(''00000000-0000-0000-0000-000000000001''::uuid,null)',
       'Only administrators can assign a replacement'),
      ('select public.admin_save_schedule_with_assignments(null,null,null)',
       'Only administrators can save schedules')
    ) AS cases(statement,expected_message)
  LOOP
    BEGIN
      EXECUTE v_case.statement;
      RAISE EXCEPTION USING ERRCODE='ZX901', MESSAGE='Admin RPC unexpectedly accepted servant identity';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
      IF v_message <> v_case.expected_message THEN RAISE; END IF;
    END;
  END LOOP;

  -- Admin identity must pass the authorization gate. Deliberately invalid
  -- inputs stop each function at validation, before any operational writes.
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'is_admin() returned false for an administrator identity';
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('select public.admin_bulk_assignments_grouped(null,null)',
       'Assignment changes must be supplied as an array'),
      ('select public.admin_execute_servant_swap(''00000000-0000-0000-0000-000000000001''::uuid)',
       'Swap request is unavailable or no longer pending'),
      ('select public.admin_link_servant_account(null,null,null)',
       'Select a servant and account, then enter the verified NIJ'),
      ('select public.admin_publish_schedules_grouped(null,null,''invalid'')',
       'Invalid schedule status'),
      ('select public.admin_resolve_replacement(''00000000-0000-0000-0000-000000000001''::uuid,null)',
       'Replacement request is no longer pending'),
      ('select public.admin_save_schedule_with_assignments(null,null,null)',
       'Schedule details must be supplied as an object')
    ) AS cases(statement,expected_message)
  LOOP
    BEGIN
      EXECUTE v_case.statement;
      RAISE EXCEPTION USING ERRCODE='ZX902', MESSAGE='Admin RPC did not reject deliberately invalid input';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
      IF v_message <> v_case.expected_message THEN RAISE; END IF;
    END;
  END LOOP;
END;
$admin_rpc_authorization$;
ROLLBACK;
