-- Rollback-only regression for bulk assignment protection around pending requests.
-- Run after 20261116000000_gms_bulk_assignment_pending_request_guard.sql.
-- Uses temporary servants and schedules in the staging database. All rows,
-- notification events and request status changes are rolled back at the end.

BEGIN;

DO $bulk_assignment_pending_request_guard$
DECLARE
  v_admin uuid;
  v_location uuid;
  v_servant_replacement uuid;
  v_servant_swap_source uuid;
  v_servant_swap_target uuid;
  v_servant_available uuid;
  v_servant_new uuid;
  v_schedule_replacement uuid;
  v_schedule_swap_source uuid;
  v_schedule_swap_target uuid;
  v_schedule_no_pending uuid;
  v_assignment_replacement uuid;
  v_assignment_swap_source uuid;
  v_assignment_swap_target uuid;
  v_replacement_request uuid;
  v_swap_request uuid;
  v_prefix text;
  v_message text;
BEGIN
  SELECT id INTO v_admin
    FROM public.profiles
   WHERE role = 'admin'
   ORDER BY created_at
   LIMIT 1;

  SELECT id INTO v_location
    FROM public.locations
   WHERE name = 'GMS Alam Sutera';

  IF v_admin IS NULL OR v_location IS NULL THEN
    RAISE EXCEPTION 'A staging admin and GMS Alam Sutera location are required';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin JWT simulation failed';
  END IF;

  INSERT INTO public.servants(full_name, active)
  VALUES ('GMS Bulk Guard Replacement Requester', true)
  RETURNING id INTO v_servant_replacement;

  INSERT INTO public.servants(full_name, active)
  VALUES ('GMS Bulk Guard Swap Requester', true)
  RETURNING id INTO v_servant_swap_source;

  INSERT INTO public.servants(full_name, active)
  VALUES ('GMS Bulk Guard Swap Target', true)
  RETURNING id INTO v_servant_swap_target;

  INSERT INTO public.servants(full_name, active)
  VALUES ('GMS Bulk Guard Available Replacement', true)
  RETURNING id INTO v_servant_available;

  INSERT INTO public.servants(full_name, active)
  VALUES ('GMS Bulk Guard New Assignee', true)
  RETURNING id INTO v_servant_new;

  v_prefix := 'GMS_TEST_BULK_GUARD_' || left(md5(txid_current()::text), 10);

  v_schedule_replacement := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', '2099-12-26',
      'location_id', v_location,
      'service_name', v_prefix || '_replacement',
      'start_time', '08:00',
      'end_time', '09:00'
    ),
    jsonb_build_array(
      jsonb_build_object('role', 'FOH', 'servant_id', v_servant_replacement)
    )
  );

  v_schedule_swap_source := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', '2099-12-27',
      'location_id', v_location,
      'service_name', v_prefix || '_swap_source',
      'start_time', '08:00',
      'end_time', '09:00'
    ),
    jsonb_build_array(
      jsonb_build_object('role', 'FOH', 'servant_id', v_servant_swap_source)
    )
  );

  v_schedule_swap_target := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', '2099-12-28',
      'location_id', v_location,
      'service_name', v_prefix || '_swap_target',
      'start_time', '08:00',
      'end_time', '09:00'
    ),
    jsonb_build_array(
      jsonb_build_object('role', 'FOH', 'servant_id', v_servant_swap_target)
    )
  );

  v_schedule_no_pending := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', '2099-12-29',
      'location_id', v_location,
      'service_name', v_prefix || '_no_pending',
      'start_time', '08:00',
      'end_time', '09:00'
    ),
    jsonb_build_array(
      jsonb_build_object('role', 'FOH', 'servant_id', v_servant_available)
    )
  );

  SELECT id INTO v_assignment_replacement
    FROM public.assignments
   WHERE schedule_id = v_schedule_replacement AND role = 'FOH';

  SELECT id INTO v_assignment_swap_source
    FROM public.assignments
   WHERE schedule_id = v_schedule_swap_source AND role = 'FOH';

  SELECT id INTO v_assignment_swap_target
    FROM public.assignments
   WHERE schedule_id = v_schedule_swap_target AND role = 'FOH';

  IF v_assignment_replacement IS NULL
     OR v_assignment_swap_source IS NULL
     OR v_assignment_swap_target IS NULL THEN
    RAISE EXCEPTION 'Test schedule assignments were not created';
  END IF;

  -- Publish the test services so the Requests insertion guard accepts them.
  -- Suppress only test notification fan-out; the entire transaction is rolled back.
  PERFORM set_config('gms.suppress_assignment_notifications', 'on', true);
  UPDATE public.schedules
     SET status = 'published'
   WHERE id IN (
     v_schedule_replacement,
     v_schedule_swap_source,
     v_schedule_swap_target,
     v_schedule_no_pending
   );

  INSERT INTO public.serving_requests(
    schedule_id, assignment_id, requester_servant_id,
    request_type, details, status
  )
  VALUES (
    v_schedule_replacement, v_assignment_replacement, v_servant_replacement,
    'replacement', 'Rollback-only pending replacement guard test', 'pending'
  )
  RETURNING id INTO v_replacement_request;

  INSERT INTO public.serving_requests(
    schedule_id, assignment_id, requester_servant_id,
    request_type, details, status,
    target_schedule_id, target_assignment_id, target_servant_id
  )
  VALUES (
    v_schedule_swap_source, v_assignment_swap_source, v_servant_swap_source,
    'swap', 'Rollback-only pending swap guard test', 'pending',
    v_schedule_swap_target, v_assignment_swap_target, v_servant_swap_target
  )
  RETURNING id INTO v_swap_request;

  -- Pending replacement: a source assignment reassignment must be rejected.
  BEGIN
    PERFORM public.admin_bulk_assignments_grouped(
      jsonb_build_array(jsonb_build_object(
        'schedule_id', v_schedule_replacement,
        'role', 'FOH',
        'servant_id', v_servant_available
      )),
      'Pending replacement guard regression'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX701',
      MESSAGE = 'Bulk assignment unexpectedly changed a pending replacement request';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Resolve pending replacement or swap requests for this service before editing it.' THEN
      RAISE EXCEPTION 'Unexpected replacement guard result: %', v_message;
    END IF;
  END;

  -- Pending swap: changing the request's source service must be rejected.
  BEGIN
    PERFORM public.admin_bulk_assignments_grouped(
      jsonb_build_array(jsonb_build_object(
        'schedule_id', v_schedule_swap_source,
        'role', 'FOH',
        'servant_id', NULL
      )),
      'Pending swap source guard regression'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX702',
      MESSAGE = 'Bulk assignment unexpectedly removed a pending swap source assignment';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Resolve pending replacement or swap requests for this service before editing it.' THEN
      RAISE EXCEPTION 'Unexpected swap source guard result: %', v_message;
    END IF;
  END;

  -- Pending swap: changing its target service must also be rejected.
  BEGIN
    PERFORM public.admin_bulk_assignments_grouped(
      jsonb_build_array(jsonb_build_object(
        'schedule_id', v_schedule_swap_target,
        'role', 'FOH',
        'servant_id', v_servant_available
      )),
      'Pending swap target guard regression'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX703',
      MESSAGE = 'Bulk assignment unexpectedly changed a pending swap target assignment';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Resolve pending replacement or swap requests for this service before editing it.' THEN
      RAISE EXCEPTION 'Unexpected swap target guard result: %', v_message;
    END IF;
  END;

  -- All three rejected operations must leave the linked assignment/request data intact.
  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
     WHERE id = v_assignment_replacement
       AND servant_id = v_servant_replacement
  ) OR NOT EXISTS (
    SELECT 1 FROM public.serving_requests
     WHERE id = v_replacement_request
       AND status = 'pending'
       AND assignment_id = v_assignment_replacement
  ) THEN
    RAISE EXCEPTION 'Rejected replacement edit changed its assignment or request';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
     WHERE id = v_assignment_swap_source
       AND servant_id = v_servant_swap_source
  ) OR NOT EXISTS (
    SELECT 1 FROM public.assignments
     WHERE id = v_assignment_swap_target
       AND servant_id = v_servant_swap_target
  ) OR NOT EXISTS (
    SELECT 1 FROM public.serving_requests
     WHERE id = v_swap_request
       AND status = 'pending'
       AND assignment_id = v_assignment_swap_source
       AND target_assignment_id = v_assignment_swap_target
  ) THEN
    RAISE EXCEPTION 'Rejected swap edit changed its source, target or pending request';
  END IF;

  -- A resolved request should no longer block a later assignment change.
  UPDATE public.serving_requests
     SET status = 'declined',
         reviewed_by = v_admin,
         reviewed_at = now()
   WHERE id IN (v_replacement_request, v_swap_request);

  PERFORM public.admin_bulk_assignments_grouped(
    jsonb_build_array(jsonb_build_object(
      'schedule_id', v_schedule_replacement,
      'role', 'FOH',
      'servant_id', v_servant_available
    )),
    'Resolved request allows bulk assignment regression'
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
     WHERE schedule_id = v_schedule_replacement
       AND role = 'FOH'
       AND servant_id = v_servant_available
       AND confirmation_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Bulk assignment did not proceed after the related request was resolved';
  END IF;
END;
$bulk_assignment_pending_request_guard$;

ROLLBACK;
