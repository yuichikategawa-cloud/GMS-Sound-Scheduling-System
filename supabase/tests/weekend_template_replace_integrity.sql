-- Rollback-only regression tests for atomic weekend-template replacement.
-- Staging only: applies no persistent test data.
BEGIN;
DO $weekend_template_replace$
DECLARE
  v_admin uuid;
  v_servant uuid;
  v_location uuid;
  v_non_admin uuid;
  v_date date := DATE '2099-12-26';
  v_prefix text := 'GMS_TEST_REPLACE_' || left(md5(txid_current()::text), 10);
  v_a uuid;
  v_b uuid;
  v_c uuid;
  v_new uuid;
  v_a_assignment uuid;
  v_b_assignment uuid;
  v_result integer;
  v_message text;
  v_start time;
  v_end time;
  v_confirmation text;
BEGIN
  SELECT id INTO v_admin
  FROM public.profiles
  WHERE role = 'admin'
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_location
  FROM public.locations
  ORDER BY name
  LIMIT 1;

  IF v_admin IS NULL OR v_location IS NULL THEN
    RAISE EXCEPTION 'A staging admin and church location are required';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('gms.suppress_assignment_notifications', 'on', true);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin JWT simulation failed';
  END IF;

  INSERT INTO public.servants(full_name, active)
  VALUES (v_prefix || '_servant', true)
  RETURNING id INTO v_servant;

  v_a := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', v_date,
      'location_id', v_location,
      'service_name', v_prefix || '_A',
      'start_time', '08:00',
      'end_time', '09:00'
    ),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_servant))
  );

  v_b := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', v_date,
      'location_id', v_location,
      'service_name', v_prefix || '_B',
      'start_time', '09:00',
      'end_time', '10:00'
    ),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_servant))
  );

  v_c := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', v_date,
      'location_id', v_location,
      'service_name', v_prefix || '_C_external',
      'start_time', '10:00',
      'end_time', '11:00'
    ),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_servant))
  );

  SELECT id INTO v_a_assignment
  FROM public.assignments
  WHERE schedule_id = v_a AND role = 'FOH';

  SELECT id INTO v_b_assignment
  FROM public.assignments
  WHERE schedule_id = v_b AND role = 'FOH';

  UPDATE public.assignments
     SET confirmation_status = 'confirmed'
   WHERE schedule_id IN (v_a, v_b);

  -- A and B swap time windows in one atomic batch. Evaluating either row
  -- against the other's old window would reject this valid final state.
  v_result := public.admin_replace_weekend_schedules_atomic(
    jsonb_build_array(
      jsonb_build_object(
        'service_date', v_date, 'location_id', v_location,
        'service_name', v_prefix || '_A', 'start_time', '09:00', 'end_time', '10:00'
      ),
      jsonb_build_object(
        'service_date', v_date, 'location_id', v_location,
        'service_name', v_prefix || '_B', 'start_time', '08:00', 'end_time', '09:00'
      ),
      jsonb_build_object(
        'service_date', v_date, 'location_id', v_location,
        'service_name', v_prefix || '_new_draft', 'start_time', '11:00', 'end_time', '12:00'
      )
    )
  );

  IF v_result <> 3 THEN
    RAISE EXCEPTION 'Expected two time updates and one new draft, received %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE id = v_a AND start_time = TIME '09:00' AND end_time = TIME '10:00'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE id = v_b AND start_time = TIME '08:00' AND end_time = TIME '09:00'
  ) THEN
    RAISE EXCEPTION 'The atomic time swap did not persist both final windows';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id = v_a_assignment AND confirmation_status = 'pending'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id = v_b_assignment AND confirmation_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Time replacement did not reset confirmations on the existing assignment rows';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date = v_date
      AND location_id = v_location
      AND service_name = v_prefix || '_new_draft'
      AND status = 'draft'
  ) THEN
    RAISE EXCEPTION 'A missing template slot was not inserted as a draft';
  END IF;

  SELECT id INTO v_new
  FROM public.schedules
  WHERE service_date = v_date
    AND location_id = v_location
    AND service_name = v_prefix || '_new_draft';

  v_result := public.admin_replace_weekend_schedules_atomic(
    jsonb_build_array(
      jsonb_build_object(
        'service_date', v_date, 'location_id', v_location,
        'service_name', v_prefix || '_A', 'start_time', '09:00', 'end_time', '10:00'
      ),
      jsonb_build_object(
        'service_date', v_date, 'location_id', v_location,
        'service_name', v_prefix || '_B', 'start_time', '08:00', 'end_time', '09:00'
      ),
      jsonb_build_object(
        'service_date', v_date, 'location_id', v_location,
        'service_name', v_prefix || '_new_draft', 'start_time', '11:00', 'end_time', '12:00'
      )
    )
  );

  IF v_result <> 0 THEN
    RAISE EXCEPTION 'Repeating the same replacement should be an idempotent no-op, received %', v_result;
  END IF;

  -- An overlap in any row must roll back earlier staged inserts and preserve
  -- the full pre-call state, including confirmations.
  UPDATE public.assignments
     SET confirmation_status = 'confirmed'
   WHERE schedule_id IN (v_a, v_b);

  BEGIN
    PERFORM public.admin_replace_weekend_schedules_atomic(
      jsonb_build_array(
        jsonb_build_object(
          'service_date', v_date, 'location_id', v_location,
          'service_name', v_prefix || '_A', 'start_time', '09:00', 'end_time', '10:00'
        ),
        jsonb_build_object(
          'service_date', v_date, 'location_id', v_location,
          'service_name', v_prefix || '_B', 'start_time', '10:00', 'end_time', '11:00'
        ),
        jsonb_build_object(
          'service_date', v_date, 'location_id', v_location,
          'service_name', v_prefix || '_must_rollback', 'start_time', '12:00', 'end_time', '13:00'
        )
      )
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX901', MESSAGE = 'Overlapping replacement was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant has an overlapping service at this church' THEN
      RAISE EXCEPTION 'Unexpected overlap validation result: %', v_message;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE id = v_b AND start_time = TIME '08:00' AND end_time = TIME '09:00'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id = v_b_assignment AND confirmation_status = 'confirmed'
  ) OR EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date = v_date
      AND location_id = v_location
      AND service_name = v_prefix || '_must_rollback'
  ) THEN
    RAISE EXCEPTION 'A rejected batch replacement was not fully rolled back';
  END IF;

  -- Active allowed-time-window preferences are rechecked against the new
  -- service windows even when the servant assignment itself is unchanged.
  INSERT INTO public.servant_serving_preferences (
    servant_id, rule_type, days_of_week, start_time, end_time,
    location_id, service_names, active
  )
  VALUES (
    v_servant,
    'allowed_time_window',
    ARRAY[extract(dow FROM v_date)::smallint],
    TIME '07:00',
    TIME '11:00',
    NULL,
    ARRAY[]::text[],
    true
  );

  BEGIN
    PERFORM public.admin_replace_weekend_schedules_atomic(
      jsonb_build_array(
        jsonb_build_object(
          'service_date', v_date, 'location_id', v_location,
          'service_name', v_prefix || '_A', 'start_time', '09:00', 'end_time', '10:00'
        ),
        jsonb_build_object(
          'service_date', v_date, 'location_id', v_location,
          'service_name', v_prefix || '_B', 'start_time', '11:00', 'end_time', '12:00'
        )
      )
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX902', MESSAGE = 'Out-of-window replacement was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant does not match their serving eligibility rules' THEN
      RAISE EXCEPTION 'Unexpected serving-preference result: %', v_message;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE id = v_b AND start_time = TIME '08:00' AND end_time = TIME '09:00'
  ) THEN
    RAISE EXCEPTION 'A rejected preference change altered the existing service time';
  END IF;

  SELECT id INTO v_non_admin
  FROM public.profiles
  WHERE role = 'servant'
  ORDER BY created_at
  LIMIT 1;

  IF v_non_admin IS NULL THEN
    RAISE EXCEPTION 'A servant profile is required for the authorization test';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_non_admin::text, true);
  BEGIN
    PERFORM public.admin_replace_weekend_schedules_atomic('[]'::jsonb);
    RAISE EXCEPTION USING ERRCODE = 'ZX903', MESSAGE = 'A non-admin replaced weekend schedules';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Only administrators can replace weekend schedules' THEN
      RAISE EXCEPTION 'Unexpected non-admin authorization result: %', v_message;
    END IF;
  END;
END;
$weekend_template_replace$;
ROLLBACK;
