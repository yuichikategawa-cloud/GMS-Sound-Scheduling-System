-- Rollback-only integration tests for transactional weekend-template replacement.
-- Run only against a dedicated staging database after the atomic replacement migration.
BEGIN;

DO $weekend_replace$
DECLARE
  v_admin uuid;
  v_location uuid;
  v_other_location uuid;
  v_servant_a uuid;
  v_servant_b uuid;
  v_cross_servant uuid;
  v_overlap_servant uuid;
  v_swap_servant uuid;
  v_schedule_a uuid;
  v_schedule_b uuid;
  v_schedule_cross_a uuid;
  v_schedule_cross_b uuid;
  v_schedule_overlap_a uuid;
  v_schedule_overlap_b uuid;
  v_schedule_swap_a uuid;
  v_schedule_swap_b uuid;
  v_assignment_a uuid;
  v_assignment_b uuid;
  v_swap_assignment_a uuid;
  v_swap_assignment_b uuid;
  v_prefix text;
  v_message text;
  v_result integer;
  v_start time;
  v_status text;
  v_confirmation text;
BEGIN
  SELECT id INTO v_admin
  FROM public.profiles
  WHERE role = 'admin'
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_location
  FROM public.locations
  WHERE name = 'GMS Alam Sutera';

  SELECT id INTO v_other_location
  FROM public.locations
  WHERE id IS DISTINCT FROM v_location
  ORDER BY name
  LIMIT 1;

  IF v_admin IS NULL OR v_location IS NULL OR v_other_location IS NULL THEN
    RAISE EXCEPTION 'A staging admin and two church locations are required';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('gms.suppress_assignment_notifications', 'on', true);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin JWT simulation failed';
  END IF;

  -- The server endpoint itself rejects weekday rows; it does not rely on
  -- the frontend's Saturday/Sunday date expansion.
  BEGIN
    PERFORM public.admin_replace_generated_weekend_schedules(
      jsonb_build_array(
        jsonb_build_object(
          'service_date', '2099-12-28',
          'location_id', v_location,
          'service_name', 'GMS_TEST_WEEKDAY_REJECT_' || left(md5(txid_current()::text), 8),
          'start_time', '08:00',
          'end_time', '09:00'
        )
      )
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX905', MESSAGE = 'Weekday replacement row was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Each replacement row must contain a weekend date, service name and valid time range' THEN
      RAISE EXCEPTION 'Unexpected weekday validation result: %', v_message;
    END IF;
  END;

  v_prefix := 'GMS_TEST_WEEKEND_REPLACE_' || left(md5(txid_current()::text), 10);

  INSERT INTO public.servants(full_name, active)
  VALUES (v_prefix || '_a', true)
  RETURNING id INTO v_servant_a;

  INSERT INTO public.servants(full_name, active)
  VALUES (v_prefix || '_b', true)
  RETURNING id INTO v_servant_b;

  v_schedule_a := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', '2099-12-26',
      'location_id', v_location,
      'service_name', v_prefix || '_existing_a',
      'start_time', '08:00',
      'end_time', '09:00'
    ),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_servant_a))
  );

  v_schedule_b := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', '2099-12-27',
      'location_id', v_location,
      'service_name', v_prefix || '_existing_b',
      'start_time', '08:00',
      'end_time', '09:00'
    ),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_servant_b))
  );

  SELECT id INTO v_assignment_a
  FROM public.assignments
  WHERE schedule_id = v_schedule_a AND role = 'FOH';

  SELECT id INTO v_assignment_b
  FROM public.assignments
  WHERE schedule_id = v_schedule_b AND role = 'FOH';

  IF v_assignment_a IS NULL OR v_assignment_b IS NULL THEN
    RAISE EXCEPTION 'Initial schedule assignments were not created';
  END IF;

  PERFORM public.admin_publish_schedules_grouped(NULL, ARRAY[v_schedule_a], 'published');
  UPDATE public.assignments
     SET confirmation_status = 'confirmed'
   WHERE schedule_id IN (v_schedule_a, v_schedule_b);

  -- Invalid servant in one row must roll back every schedule edit and the
  -- insertion of the missing third slot.
  UPDATE public.servants SET active = false WHERE id = v_servant_b;

  BEGIN
    PERFORM public.admin_replace_generated_weekend_schedules(
      jsonb_build_array(
        jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_existing_a', 'start_time', '08:30', 'end_time', '09:30'),
        jsonb_build_object('service_date', '2099-12-27', 'location_id', v_location, 'service_name', v_prefix || '_existing_b', 'start_time', '08:30', 'end_time', '09:30'),
        jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_new_c', 'start_time', '11:00', 'end_time', '12:00')
      )
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX901', MESSAGE = 'Inactive servant was accepted by weekend replacement';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant is inactive or no longer exists' THEN
      RAISE EXCEPTION 'Unexpected inactive-servant replacement result: %', v_message;
    END IF;
  END;

  SELECT start_time, status INTO v_start, v_status
  FROM public.schedules WHERE id = v_schedule_a;
  IF v_start <> TIME '08:00' OR v_status <> 'published' THEN
    RAISE EXCEPTION 'Failed batch partially changed the first existing schedule';
  END IF;

  SELECT start_time INTO v_start
  FROM public.schedules WHERE id = v_schedule_b;
  IF v_start <> TIME '08:00' THEN
    RAISE EXCEPTION 'Failed batch partially changed the second existing schedule';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date = DATE '2099-12-26'
      AND location_id = v_location
      AND service_name = v_prefix || '_new_c'
  ) THEN
    RAISE EXCEPTION 'Failed batch left behind a newly inserted schedule';
  END IF;

  UPDATE public.servants SET active = true WHERE id = v_servant_b;

  -- A changed service must be revalidated against active time-window preferences.
  INSERT INTO public.servant_serving_preferences(
    servant_id, rule_type, days_of_week, start_time, end_time, active, notes
  )
  VALUES (
    v_servant_a, 'allowed_time_window', ARRAY[6]::smallint[],
    TIME '08:00', TIME '09:00', true, v_prefix
  );

  BEGIN
    PERFORM public.admin_replace_generated_weekend_schedules(
      jsonb_build_array(
        jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_existing_a', 'start_time', '08:30', 'end_time', '09:30'),
        jsonb_build_object('service_date', '2099-12-27', 'location_id', v_location, 'service_name', v_prefix || '_existing_b', 'start_time', '08:30', 'end_time', '09:30'),
        jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_new_c', 'start_time', '11:00', 'end_time', '12:00')
      )
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX902', MESSAGE = 'Out-of-window servant service was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant does not match their serving eligibility rules' THEN
      RAISE EXCEPTION 'Unexpected eligibility replacement result: %', v_message;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date = DATE '2099-12-26'
      AND location_id = v_location
      AND service_name = v_prefix || '_new_c'
  ) THEN
    RAISE EXCEPTION 'Eligibility failure left behind a newly inserted schedule';
  END IF;

  DELETE FROM public.servant_serving_preferences
  WHERE servant_id = v_servant_a AND notes = v_prefix;

  -- A valid multi-row replacement is committed together. Assignment identities
  -- are preserved, confirmations reset, published services become drafts, and
  -- missing template slots are created as empty drafts.
  v_result := public.admin_replace_generated_weekend_schedules(
    jsonb_build_array(
      jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_existing_a', 'start_time', '08:30', 'end_time', '09:30'),
      jsonb_build_object('service_date', '2099-12-27', 'location_id', v_location, 'service_name', v_prefix || '_existing_b', 'start_time', '08:30', 'end_time', '09:30'),
      jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_new_c', 'start_time', '11:00', 'end_time', '12:00')
    )
  );

  IF v_result <> 3 THEN
    RAISE EXCEPTION 'Expected three replaced/generated rows, received %', v_result;
  END IF;

  SELECT start_time, status INTO v_start, v_status
  FROM public.schedules WHERE id = v_schedule_a;
  IF v_start <> TIME '08:30' OR v_status <> 'draft' THEN
    RAISE EXCEPTION 'Published service was not updated and returned to draft';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id = v_assignment_a
      AND schedule_id = v_schedule_a
      AND confirmation_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Replacement did not preserve assignment ID and reset confirmation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id = v_assignment_b
      AND schedule_id = v_schedule_b
      AND confirmation_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Draft service replacement did not preserve assignment ID and reset confirmation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date = DATE '2099-12-26'
      AND location_id = v_location
      AND service_name = v_prefix || '_new_c'
      AND start_time = TIME '11:00'
      AND end_time = TIME '12:00'
      AND status = 'draft'
  ) THEN
    RAISE EXCEPTION 'New template slot was not created as a draft';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE s.service_name = v_prefix || '_new_c'
  ) THEN
    RAISE EXCEPTION 'A newly generated slot must not inherit unrelated assignments';
  END IF;

  -- Cross-location conflicts are checked against the final batch state and all
  -- schedules outside the batch, even if an earlier direct update created stale data.
  INSERT INTO public.servants(full_name, active)
  VALUES (v_prefix || '_cross', true)
  RETURNING id INTO v_cross_servant;

  v_schedule_cross_a := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_cross_a', 'start_time', '13:00', 'end_time', '14:00'),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_cross_servant))
  );

  v_schedule_cross_b := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object('service_date', '2099-12-28', 'location_id', v_other_location, 'service_name', v_prefix || '_cross_b', 'start_time', '13:00', 'end_time', '14:00'),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_cross_servant))
  );

  UPDATE public.schedules SET service_date = DATE '2099-12-26'
  WHERE id = v_schedule_cross_b;

  BEGIN
    PERFORM public.admin_replace_generated_weekend_schedules(
      jsonb_build_array(
        jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_cross_a', 'start_time', '13:15', 'end_time', '14:15')
      )
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX903', MESSAGE = 'Cross-location conflict was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant is already assigned at another church location on the same date' THEN
      RAISE EXCEPTION 'Unexpected cross-location replacement result: %', v_message;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE id = v_schedule_cross_a AND start_time = TIME '13:00'
  ) THEN
    RAISE EXCEPTION 'Rejected cross-location replacement changed the schedule';
  END IF;

  -- Same-location overlap is checked against final metadata for all batch rows.
  INSERT INTO public.servants(full_name, active)
  VALUES (v_prefix || '_overlap', true)
  RETURNING id INTO v_overlap_servant;

  v_schedule_overlap_a := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_overlap_a', 'start_time', '14:00', 'end_time', '15:00'),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_overlap_servant))
  );

  v_schedule_overlap_b := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object('service_date', '2099-12-28', 'location_id', v_location, 'service_name', v_prefix || '_overlap_b', 'start_time', '16:00', 'end_time', '17:00'),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_overlap_servant))
  );

  UPDATE public.schedules SET service_date = DATE '2099-12-26'
  WHERE id = v_schedule_overlap_b;

  BEGIN
    PERFORM public.admin_replace_generated_weekend_schedules(
      jsonb_build_array(
        jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_overlap_a', 'start_time', '16:30', 'end_time', '17:30')
      )
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX904', MESSAGE = 'Same-location overlap was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant has an overlapping service at the same church' THEN
      RAISE EXCEPTION 'Unexpected overlap replacement result: %', v_message;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE id = v_schedule_overlap_a AND start_time = TIME '14:00'
  ) THEN
    RAISE EXCEPTION 'Rejected overlap replacement changed the schedule';
  END IF;

  -- A valid same-servant time swap between two affected rows must be evaluated
  -- as a final-state batch, not rejected due to an intermediate row update.
  INSERT INTO public.servants(full_name, active)
  VALUES (v_prefix || '_swap', true)
  RETURNING id INTO v_swap_servant;

  v_schedule_swap_a := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_swap_a', 'start_time', '18:00', 'end_time', '19:00'),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_swap_servant))
  );

  v_schedule_swap_b := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_swap_b', 'start_time', '19:00', 'end_time', '20:00'),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_swap_servant))
  );

  SELECT id INTO v_swap_assignment_a FROM public.assignments
  WHERE schedule_id = v_schedule_swap_a AND role = 'FOH';
  SELECT id INTO v_swap_assignment_b FROM public.assignments
  WHERE schedule_id = v_schedule_swap_b AND role = 'FOH';

  v_result := public.admin_replace_generated_weekend_schedules(
    jsonb_build_array(
      jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_swap_a', 'start_time', '19:00', 'end_time', '20:00'),
      jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_swap_b', 'start_time', '18:00', 'end_time', '19:00')
    )
  );

  IF v_result <> 2 OR NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id = v_swap_assignment_a AND confirmation_status = 'pending'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id = v_swap_assignment_b AND confirmation_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Valid batch time swap did not preserve assignments and reset confirmations';
  END IF;

  -- Repeating the same replacement must be idempotent and must not reset a
  -- subsequently confirmed assignment when no service metadata actually changes.
  UPDATE public.assignments
     SET confirmation_status = 'confirmed'
   WHERE schedule_id IN (v_schedule_swap_a, v_schedule_swap_b);

  PERFORM public.admin_replace_generated_weekend_schedules(
    jsonb_build_array(
      jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_swap_a', 'start_time', '19:00', 'end_time', '20:00'),
      jsonb_build_object('service_date', '2099-12-26', 'location_id', v_location, 'service_name', v_prefix || '_swap_b', 'start_time', '18:00', 'end_time', '19:00')
    )
  );

  IF EXISTS (
    SELECT 1 FROM public.assignments
    WHERE schedule_id IN (v_schedule_swap_a, v_schedule_swap_b)
      AND confirmation_status <> 'confirmed'
  ) THEN
    RAISE EXCEPTION 'An idempotent replacement reset an unchanged confirmation';
  END IF;
END;
$weekend_replace$;

ROLLBACK;
