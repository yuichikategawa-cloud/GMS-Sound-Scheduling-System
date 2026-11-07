-- Rollback-only integration regression test for assignment-confirmation notifications.
--
-- Prerequisite: apply
-- 20261107182600_gms_assignment_confirmation_notification_idempotency.sql.
--
-- The fixture uses existing staging auth profiles and a real location, but
-- creates its own servant, schedule, and assignment inside this transaction.
-- Every fixture row, audit row, notification, and push-queue write is rolled
-- back. Do not remove the final ROLLBACK.
--
-- Run manually in the Supabase SQL Editor with a role permitted to exercise
-- the SECURITY DEFINER function and its underlying tables. GitHub Actions
-- currently does not execute Supabase SQL tests.

BEGIN;

-- Prevent unrelated schedule/assignment notification fan-out from this
-- temporary fixture. The target RPC's admin notification path remains active.
SELECT set_config('gms.suppress_assignment_notifications', 'on', true);

DO $gms_assignment_confirmation_notification_tests$
DECLARE
  v_owner_user_id uuid;
  v_admin_user_id uuid;
  v_location_id uuid;
  v_servant_id uuid;
  v_schedule_id uuid;
  v_assignment_id uuid;
  v_service_name text;
  v_event_prefix text;
  v_before_count bigint;
  v_after_first_count bigint;
  v_after_second_count bigint;
  v_message text;
BEGIN
  SELECT id INTO v_owner_user_id
  FROM public.profiles
  WHERE role = 'servant'
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_admin_user_id
  FROM public.profiles
  WHERE role = 'admin'
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_location_id
  FROM public.locations
  ORDER BY name
  LIMIT 1;

  IF v_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'A staging profile with role=servant is required';
  END IF;
  IF v_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'A staging profile with role=admin is required';
  END IF;
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'At least one location is required';
  END IF;
  IF v_owner_user_id = v_admin_user_id THEN
    RAISE EXCEPTION 'Test servant and admin profiles must be distinct';
  END IF;

  -- Set an admin identity for the fixture writes and assignment confirmation.
  PERFORM set_config('request.jwt.claim.sub', v_admin_user_id::text, true);

  INSERT INTO public.servants (full_name, auth_user_id)
  VALUES ('__notification_regression_fixture__', v_owner_user_id)
  RETURNING id INTO v_servant_id;

  v_service_name := '__notification_regression_' || gen_random_uuid()::text;

  INSERT INTO public.schedules (
    service_date, location_id, service_name, start_time, end_time, status
  )
  VALUES (
    current_date + 3650, v_location_id, v_service_name,
    time '09:00', time '10:00', 'draft'
  )
  RETURNING id INTO v_schedule_id;

  INSERT INTO public.assignments (
    schedule_id, servant_id, role, confirmation_status
  )
  VALUES (v_schedule_id, v_servant_id, 'FOH', 'pending')
  RETURNING id INTO v_assignment_id;

  -- The audit trigger records this transition in the same transaction.
  UPDATE public.assignments
  SET confirmation_status = 'confirmed'
  WHERE id = v_assignment_id;

  v_event_prefix := 'assignment-confirmation:' || v_assignment_id::text || ':';

  SELECT count(*) INTO v_before_count
  FROM public.serving_notifications
  WHERE event_key LIKE v_event_prefix || '%';

  -- Correct owner can notify admins.
  PERFORM set_config('request.jwt.claim.sub', v_owner_user_id::text, true);
  PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);

  SELECT count(*) INTO v_after_first_count
  FROM public.serving_notifications
  WHERE event_key LIKE v_event_prefix || '%';

  IF v_after_first_count <= v_before_count THEN
    RAISE EXCEPTION
      'Expected first invocation to create admin notification(s); before %, after %',
      v_before_count, v_after_first_count;
  END IF;

  -- Repeated invocation for the same confirmation cycle must be idempotent.
  PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);

  SELECT count(*) INTO v_after_second_count
  FROM public.serving_notifications
  WHERE event_key LIKE v_event_prefix || '%';

  IF v_after_second_count <> v_after_first_count THEN
    RAISE EXCEPTION
      'Repeated invocation created duplicates: first %, second %',
      v_after_first_count, v_after_second_count;
  END IF;

  -- Another authenticated user must not notify admins about this assignment.
  PERFORM set_config('request.jwt.claim.sub', v_admin_user_id::text, true);

  BEGIN
    PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);
    RAISE EXCEPTION USING
      ERRCODE = 'ZX701',
      MESSAGE = 'A non-owner invoked assignment confirmation notification';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE
      'You can only notify administrators about your own assignment%' THEN
      RAISE EXCEPTION 'Unexpected ownership authorization result: %', v_message;
    END IF;
  END;
END;
$gms_assignment_confirmation_notification_tests$;

ROLLBACK;
