-- Rollback-only regression tests for the atomic schedule editor and
-- administrator-led servant account linking.
--
-- Run in Supabase SQL Editor after applying the migration:
--   20261104144743_gms_atomic_schedule_save_and_servant_account_link.sql
--
-- This script creates temporary servants/schedules and temporarily replaces
-- one eligible member profile's NIJ with a synthetic test value. The final
-- ROLLBACK restores all test rows, the original NIJ, audit records and
-- notifications. It selects an account with no assignment/request history;
-- if none exists, it stops without changing production data.

BEGIN;

DO $gms_atomic_and_link_tests$
DECLARE
  v_admin uuid;
  v_location uuid;
  v_servant_1 uuid;
  v_servant_2 uuid;
  v_servant_3 uuid;
  v_schedule uuid;
  v_service_name text;
  v_foh_before uuid;
  v_monitor_before uuid;
  v_foh_after uuid;
  v_monitor_after uuid;
  v_confirmation text;
  v_schedule_date date;
  v_schedule_status text;
  v_message text;
  v_link_user uuid;
  v_link_source uuid;
  v_link_target uuid;
  v_test_nij text;
  v_source_availability integer;
  v_target_availability integer;
  v_source_rules integer;
  v_target_rules integer;
BEGIN
  SELECT id INTO v_admin
  FROM public.profiles
  WHERE role='admin'
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_location
  FROM public.locations
  WHERE name='GMS Alam Sutera';

  IF v_admin IS NULL OR v_location IS NULL THEN
    RAISE EXCEPTION 'A test admin and GMS Alam Sutera location are required';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin JWT simulation failed';
  END IF;

  -- 1. Atomic schedule creation and confirmation-preserving diff.
  INSERT INTO public.servants(full_name,active)
  VALUES ('GMS Atomic Test Servant 1',true) RETURNING id INTO v_servant_1;
  INSERT INTO public.servants(full_name,active)
  VALUES ('GMS Atomic Test Servant 2',true) RETURNING id INTO v_servant_2;
  INSERT INTO public.servants(full_name,active)
  VALUES ('GMS Atomic Test Servant 3',true) RETURNING id INTO v_servant_3;

  v_service_name := 'GMS_TEST_ATOMIC_' || left(md5(txid_current()::text),10);

  v_schedule := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date','2099-12-26',
      'location_id',v_location,
      'service_name',v_service_name,
      'start_time','08:00',
      'end_time','10:00'
    ),
    jsonb_build_array(
      jsonb_build_object('role','FOH','servant_id',v_servant_1),
      jsonb_build_object('role','Monitor','servant_id',v_servant_2)
    )
  );

  SELECT id INTO v_foh_before
  FROM public.assignments WHERE schedule_id=v_schedule AND role='FOH';
  SELECT id INTO v_monitor_before
  FROM public.assignments WHERE schedule_id=v_schedule AND role='Monitor';

  IF v_foh_before IS NULL OR v_monitor_before IS NULL THEN
    RAISE EXCEPTION 'Initial atomic save did not create both role assignments';
  END IF;

  UPDATE public.assignments
     SET confirmation_status='confirmed'
   WHERE schedule_id=v_schedule;

  PERFORM public.admin_save_schedule_with_assignments(
    v_schedule,
    jsonb_build_object(
      'service_date','2099-12-26',
      'location_id',v_location,
      'service_name',v_service_name,
      'start_time','08:00',
      'end_time','10:00'
    ),
    jsonb_build_array(
      jsonb_build_object('role','FOH','servant_id',v_servant_1),
      jsonb_build_object('role','Monitor','servant_id',v_servant_3)
    )
  );

  SELECT id,confirmation_status INTO v_foh_after,v_confirmation
  FROM public.assignments WHERE schedule_id=v_schedule AND role='FOH';

  IF v_foh_after IS DISTINCT FROM v_foh_before OR v_confirmation<>'confirmed' THEN
    RAISE EXCEPTION 'Unchanged assignment ID/confirmation was not preserved';
  END IF;

  SELECT id,confirmation_status INTO v_monitor_after,v_confirmation
  FROM public.assignments WHERE schedule_id=v_schedule AND role='Monitor';

  IF v_monitor_after IS NULL OR v_monitor_after=v_monitor_before OR v_confirmation<>'pending' THEN
    RAISE EXCEPTION 'Changed assignment was not recreated as pending';
  END IF;

  -- 2. Failed update must leave schedule and assignment state unchanged.
  UPDATE public.servants SET active=false WHERE id=v_servant_2;

  BEGIN
    PERFORM public.admin_save_schedule_with_assignments(
      v_schedule,
      jsonb_build_object(
        'service_date','2099-12-27',
        'location_id',v_location,
        'service_name',v_service_name || '_INVALID',
        'start_time','08:00',
        'end_time','10:00'
      ),
      jsonb_build_array(
        jsonb_build_object('role','FOH','servant_id',v_servant_1),
        jsonb_build_object('role','Monitor','servant_id',v_servant_2)
      )
    );
    RAISE EXCEPTION USING ERRCODE='ZX501',MESSAGE='Inactive servant was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'A selected servant is inactive or no longer exists%' THEN
      RAISE EXCEPTION 'Unexpected inactive-servant error: %',v_message;
    END IF;
  END;

  SELECT service_date,status INTO v_schedule_date,v_schedule_status
  FROM public.schedules WHERE id=v_schedule;

  IF v_schedule_date<>DATE '2099-12-26' OR v_schedule_status<>'draft' THEN
    RAISE EXCEPTION 'Failed edit changed the existing schedule';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id=v_foh_before AND schedule_id=v_schedule
      AND confirmation_status='confirmed'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id=v_monitor_after AND schedule_id=v_schedule
      AND servant_id=v_servant_3 AND confirmation_status='pending'
  ) THEN
    RAISE EXCEPTION 'Failed edit changed existing assignment state';
  END IF;

  -- 3. Authenticated servant accounts can call the RPC endpoint but
  -- cannot pass the database-side administrator check.
  DECLARE
    v_non_admin uuid;
  BEGIN
    SELECT id INTO v_non_admin
    FROM public.profiles
    WHERE role='servant'
    ORDER BY created_at
    LIMIT 1;

    IF v_non_admin IS NULL THEN
      RAISE EXCEPTION 'A servant profile is required for the authorization test';
    END IF;

    PERFORM set_config('request.jwt.claim.sub',v_non_admin::text,true);

    BEGIN
      PERFORM public.admin_save_schedule_with_assignments(NULL,NULL,NULL);
      RAISE EXCEPTION USING ERRCODE='ZX602',MESSAGE='Non-admin called schedule save';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
      IF v_message NOT LIKE 'Only administrators can save schedules%' THEN
        RAISE EXCEPTION 'Unexpected schedule-save authorization result: %',v_message;
      END IF;
    END;

    BEGIN
      PERFORM public.admin_link_servant_account(NULL,NULL,NULL);
      RAISE EXCEPTION USING ERRCODE='ZX603',MESSAGE='Non-admin called account link';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
      IF v_message NOT LIKE 'Only administrators can link servant accounts%' THEN
        RAISE EXCEPTION 'Unexpected account-link authorization result: %',v_message;
      END IF;
    END;

    PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  END;

  -- 3. Account linking: choose a servant account with a complete profile and
  -- no assignment/request history, then use a synthetic NIJ within this
  -- transaction so no real NIJ value is read or exposed by the test.
  SELECT s.id,s.auth_user_id
    INTO v_link_source,v_link_user
  FROM public.servants s
  JOIN public.profiles p ON p.id=s.auth_user_id AND p.role='servant'
  JOIN public.member_profiles mp ON mp.user_id=s.auth_user_id
  WHERE s.active=true
    AND s.auth_user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.assignments a WHERE a.servant_id=s.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.serving_requests r
      WHERE r.requester_servant_id=s.id
         OR r.target_servant_id=s.id
         OR r.replacement_servant_id=s.id
    )
  ORDER BY s.full_name
  LIMIT 1;

  IF v_link_source IS NULL OR v_link_user IS NULL THEN
    RAISE EXCEPTION 'No eligible account exists for the account-link regression test';
  END IF;

  v_test_nij := 'GMS-TEST-' || upper(left(md5(v_link_user::text),12));

  UPDATE public.member_profiles
     SET nij=v_test_nij
   WHERE user_id=v_link_user;

  INSERT INTO public.servants(full_name,active)
  VALUES ('GMS Account Link Test Target',true)
  RETURNING id INTO v_link_target;

  -- Conflicting recurring statuses over overlapping effective ranges must
  -- block the merge, even when the recurrence patterns are different.
  INSERT INTO public.servant_availability_rules(
    servant_id,pattern,status,effective_from,effective_until,weekday,ordinal,notes
  ) VALUES (
    v_link_source,'saturday','unavailable',DATE '2099-01-01',DATE '2099-12-31',6,1,'GMS rollback recurring conflict'
  );

  INSERT INTO public.servant_availability_rules(
    servant_id,pattern,status,effective_from,effective_until,weekday,ordinal,notes
  ) VALUES (
    v_link_target,'weekday','prefer_not',DATE '2099-01-01',DATE '2099-12-31',1,1,'GMS rollback recurring conflict'
  );

  BEGIN
    PERFORM public.admin_link_servant_account(v_link_target,v_link_user,v_test_nij);
    RAISE EXCEPTION USING ERRCODE='ZX604',MESSAGE='Conflicting recurring rules were merged';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'The account and roster have recurring availability rules with conflicting statuses%' THEN
      RAISE EXCEPTION 'Unexpected recurring-rule merge result: %',v_message;
    END IF;
  END;

  DELETE FROM public.servant_availability_rules
  WHERE servant_id=v_link_target AND notes='GMS rollback recurring conflict';

  -- Wrong NIJ must be rejected.
  BEGIN
    PERFORM public.admin_link_servant_account(
      v_link_target,v_link_user,'WRONG-GMS-TEST-NIJ'
    );
    RAISE EXCEPTION USING ERRCODE='ZX601',MESSAGE='Incorrect NIJ was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'NIJ verification failed%' THEN
      RAISE EXCEPTION 'Unexpected NIJ verification error: %',v_message;
    END IF;
  END;

  SELECT count(*) INTO v_source_availability
  FROM public.servant_availability WHERE servant_id=v_link_source;
  SELECT count(*) INTO v_source_rules
  FROM public.servant_availability_rules WHERE servant_id=v_link_source;

  PERFORM public.admin_link_servant_account(
    v_link_target,v_link_user,v_test_nij
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.servants
    WHERE id=v_link_target AND auth_user_id=v_link_user AND active=true
  ) THEN
    RAISE EXCEPTION 'Account did not link to the selected roster record';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.servants
    WHERE id=v_link_source AND auth_user_id IS NULL AND active=false
  ) THEN
    RAISE EXCEPTION 'Temporary duplicate account row was not retired';
  END IF;

  SELECT count(*) INTO v_target_availability
  FROM public.servant_availability WHERE servant_id=v_link_target;

  IF v_target_availability<>v_source_availability THEN
    RAISE EXCEPTION 'Availability rows were not transferred to the roster record';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.servant_availability WHERE servant_id=v_link_source
  ) THEN
    RAISE EXCEPTION 'Temporary account row still owns availability';
  END IF;

  SELECT count(*) INTO v_target_rules
  FROM public.servant_availability_rules WHERE servant_id=v_link_target;

  IF v_target_rules<>v_source_rules OR EXISTS (
    SELECT 1 FROM public.servant_availability_rules WHERE servant_id=v_link_source
  ) THEN
    RAISE EXCEPTION 'Recurring availability rules were not transferred to the canonical roster record';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE table_name='servants'
      AND record_id=v_link_target::text
      AND action='LINK_ACCOUNT'
  ) THEN
    RAISE EXCEPTION 'Account linking was not recorded in the audit trail';
  END IF;
END;
$gms_atomic_and_link_tests$;

ROLLBACK;
