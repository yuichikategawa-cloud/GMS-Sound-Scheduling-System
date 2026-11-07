-- Rollback-only regression test for assignment-confirmation notifications.
--
-- Run in the Supabase SQL Editor after applying
-- 20261107182600_gms_assignment_confirmation_notification_idempotency.sql.
-- Uses an existing confirmed assignment owned by a servant profile and rolls
-- back all notification writes. No production records are retained.
--
-- This is a manual SQL regression test; the current GitHub Actions workflow
-- validates the frontend build and does not execute Supabase SQL tests.

BEGIN;

DO $gms_assignment_confirmation_notification_tests$
DECLARE
  v_assignment_id uuid;
  v_owner_user_id uuid;
  v_other_user_id uuid;
  v_before_count bigint;
  v_after_first_count bigint;
  v_after_second_count bigint;
  v_event_prefix text;
  v_message text;
BEGIN
  SELECT a.id, s.auth_user_id
    INTO v_assignment_id, v_owner_user_id
  FROM public.assignments a
  JOIN public.servants s ON s.id = a.servant_id
  WHERE a.confirmation_status = 'confirmed'
    AND s.auth_user_id IS NOT NULL
  ORDER BY a.updated_at DESC NULLS LAST, a.created_at DESC
  LIMIT 1;

  IF v_assignment_id IS NULL OR v_owner_user_id IS NULL THEN
    RAISE EXCEPTION
      'A confirmed assignment linked to an authenticated servant is required';
  END IF;

  SELECT id
    INTO v_other_user_id
  FROM public.profiles
  WHERE id IS DISTINCT FROM v_owner_user_id
  ORDER BY created_at
  LIMIT 1;

  IF v_other_user_id IS NULL THEN
    RAISE EXCEPTION 'A second profile is required for the ownership test';
  END IF;

  v_event_prefix := 'assignment-confirmation:' || v_assignment_id::text || ':';

  SELECT count(*)
    INTO v_before_count
  FROM public.serving_notifications
  WHERE event_key LIKE v_event_prefix || '%';

  -- The actual owner may invoke the function.
  PERFORM set_config('request.jwt.claim.sub', v_owner_user_id::text, true);
  PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);

  SELECT count(*)
    INTO v_after_first_count
  FROM public.serving_notifications
  WHERE event_key LIKE v_event_prefix || '%';

  -- Repeating the same confirmation event must not create duplicates.
  PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);

  SELECT count(*)
    INTO v_after_second_count
  FROM public.serving_notifications
  WHERE event_key LIKE v_event_prefix || '%';

  IF v_after_second_count <> v_after_first_count THEN
    RAISE EXCEPTION
      'Repeated invocation created duplicate notifications: first %, second %',
      v_after_first_count, v_after_second_count;
  END IF;

  IF v_after_first_count < v_before_count THEN
    RAISE EXCEPTION 'Notification count unexpectedly decreased';
  END IF;

  -- A different authenticated user must not notify admins about this
  -- servant's assignment.
  PERFORM set_config('request.jwt.claim.sub', v_other_user_id::text, true);

  BEGIN
    PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);
    RAISE EXCEPTION USING
      ERRCODE = 'ZX701',
      MESSAGE = 'A non-owner invoked assignment confirmation notification';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'You can only notify administrators about your own assignment%' THEN
      RAISE EXCEPTION 'Unexpected ownership authorization result: %', v_message;
    END IF;
  END;
END;
$gms_assignment_confirmation_notification_tests$;

ROLLBACK;
