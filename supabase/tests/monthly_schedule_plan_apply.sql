-- Rollback-only regression for the additive monthly schedule plan RPC.
-- Run after 20261119000000_gms_monthly_schedule_plan_apply.sql on Staging.
-- Every fixture row, schedule, assignment and audit record is rolled back.

BEGIN;

-- Simulate an authenticated PostgREST caller pre-creating the names that the
-- SECURITY DEFINER RPC uses for its private staging relations. The function
-- must drop these session-owned objects and build its own trusted structures.
SET LOCAL ROLE authenticated;
CREATE TEMPORARY TABLE pg_temp.gms_monthly_expected_slots(attacker_payload text);
CREATE TEMPORARY TABLE pg_temp.gms_monthly_expected_assignments(attacker_payload text);
CREATE TEMPORARY TABLE pg_temp.gms_monthly_plan(attacker_payload text);
CREATE TEMPORARY TABLE pg_temp.gms_monthly_created_slots(attacker_payload text);
CREATE TEMPORARY TABLE pg_temp.gms_monthly_final_assignments(attacker_payload text);
RESET ROLE;

DO $monthly_schedule_plan_apply$
DECLARE
  v_admin uuid;
  v_non_admin uuid;
  v_alam uuid;
  v_bsd uuid;
  v_prefix text;

  v_locked uuid;
  v_monitor uuid;
  v_new_foh uuid;
  v_race_servant uuid;
  v_stale_foh uuid;
  v_stale_monitor uuid;
  v_stale_assistant uuid;
  v_unavailable uuid;
  v_recurring uuid;
  v_prefer_not uuid;
  v_cross uuid;
  v_overlap uuid;
  v_restricted uuid;
  v_role_limited uuid;

  v_template_existing uuid;
  v_template_new uuid;
  v_template_race uuid;
  v_template_stale uuid;
  v_template_unavailable uuid;
  v_template_recurring uuid;
  v_template_prefer_not uuid;
  v_template_cross uuid;
  v_template_overlap uuid;
  v_template_restricted uuid;

  v_schedule_existing uuid;
  v_schedule_cross uuid;
  v_schedule_overlap uuid;
  v_schedule_stale uuid;
  v_assignment_existing uuid;
  v_assignment_stale_foh uuid;
  v_assignment_stale_monitor uuid;
  v_message text;
  v_result jsonb;
  v_expected jsonb;
  v_plan jsonb;
  v_count integer;
BEGIN
  SELECT id INTO v_admin
  FROM public.profiles
  WHERE role = 'admin'
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_non_admin
  FROM public.profiles
  WHERE role <> 'admin'
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_alam
  FROM public.locations
  WHERE name = 'GMS Alam Sutera';

  SELECT id INTO v_bsd
  FROM public.locations
  WHERE name = 'GMS BSD';

  IF v_admin IS NULL OR v_alam IS NULL OR v_bsd IS NULL THEN
    RAISE EXCEPTION 'A Staging admin plus GMS Alam Sutera and GMS BSD locations are required';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin JWT simulation failed';
  END IF;

  v_prefix := 'GMS_TEST_MONTHLY_PLAN_' || left(md5(txid_current()::text), 10);

  INSERT INTO public.servants(full_name, active) VALUES
    (v_prefix || '_locked', true),
    (v_prefix || '_monitor', true),
    (v_prefix || '_new_foh', true),
    (v_prefix || '_race', true),
    (v_prefix || '_stale_foh', true),
    (v_prefix || '_stale_monitor', true),
    (v_prefix || '_stale_assistant', true),
    (v_prefix || '_unavailable', true),
    (v_prefix || '_recurring', true),
    (v_prefix || '_prefer_not', true),
    (v_prefix || '_cross', true),
    (v_prefix || '_overlap', true),
    (v_prefix || '_restricted', true);

  SELECT id INTO v_locked FROM public.servants WHERE full_name = v_prefix || '_locked';
  SELECT id INTO v_monitor FROM public.servants WHERE full_name = v_prefix || '_monitor';
  SELECT id INTO v_new_foh FROM public.servants WHERE full_name = v_prefix || '_new_foh';
  SELECT id INTO v_race_servant FROM public.servants WHERE full_name = v_prefix || '_race';
  SELECT id INTO v_stale_foh FROM public.servants WHERE full_name = v_prefix || '_stale_foh';
  SELECT id INTO v_stale_monitor FROM public.servants WHERE full_name = v_prefix || '_stale_monitor';
  SELECT id INTO v_stale_assistant FROM public.servants WHERE full_name = v_prefix || '_stale_assistant';
  SELECT id INTO v_unavailable FROM public.servants WHERE full_name = v_prefix || '_unavailable';
  SELECT id INTO v_recurring FROM public.servants WHERE full_name = v_prefix || '_recurring';
  SELECT id INTO v_prefer_not FROM public.servants WHERE full_name = v_prefix || '_prefer_not';
  SELECT id INTO v_cross FROM public.servants WHERE full_name = v_prefix || '_cross';
  SELECT id INTO v_overlap FROM public.servants WHERE full_name = v_prefix || '_overlap';
  SELECT id INTO v_restricted FROM public.servants WHERE full_name = v_prefix || '_restricted';
  INSERT INTO public.servants(full_name, active, qualified_roles)
  VALUES (v_prefix || '_role_limited', true, ARRAY['FOH']::text[])
  RETURNING id INTO v_role_limited;

  INSERT INTO public.service_templates(
    location_id, day_of_week, service_name, start_time, end_time, active
  ) VALUES
    (v_alam, 6, v_prefix || '_existing', '08:00', '10:00', true),
    (v_alam, 0, v_prefix || '_new', '09:00', '11:00', true),
    (v_alam, 6, v_prefix || '_race', '10:00', '11:00', true),
    (v_alam, 6, v_prefix || '_stale', '11:00', '12:00', true),
    (v_alam, 6, v_prefix || '_unavailable', '12:00', '13:00', true),
    (v_alam, 6, v_prefix || '_recurring', '13:00', '14:00', true),
    (v_alam, 6, v_prefix || '_prefer_not', '14:00', '15:00', true),
    (v_alam, 6, v_prefix || '_cross', '15:00', '16:00', true),
    (v_alam, 6, v_prefix || '_restricted', '16:00', '17:00', true),
    (v_alam, 6, v_prefix || '_overlap', '17:30', '18:30', true);

  SELECT id INTO v_template_existing FROM public.service_templates WHERE location_id=v_alam AND service_name=v_prefix || '_existing';
  SELECT id INTO v_template_new FROM public.service_templates WHERE location_id=v_alam AND service_name=v_prefix || '_new';
  SELECT id INTO v_template_race FROM public.service_templates WHERE location_id=v_alam AND service_name=v_prefix || '_race';
  SELECT id INTO v_template_stale FROM public.service_templates WHERE location_id=v_alam AND service_name=v_prefix || '_stale';
  SELECT id INTO v_template_unavailable FROM public.service_templates WHERE location_id=v_alam AND service_name=v_prefix || '_unavailable';
  SELECT id INTO v_template_recurring FROM public.service_templates WHERE location_id=v_alam AND service_name=v_prefix || '_recurring';
  SELECT id INTO v_template_prefer_not FROM public.service_templates WHERE location_id=v_alam AND service_name=v_prefix || '_prefer_not';
  SELECT id INTO v_template_cross FROM public.service_templates WHERE location_id=v_alam AND service_name=v_prefix || '_cross';
  SELECT id INTO v_template_overlap FROM public.service_templates WHERE location_id=v_alam AND service_name=v_prefix || '_overlap';
  SELECT id INTO v_template_restricted FROM public.service_templates WHERE location_id=v_alam AND service_name=v_prefix || '_restricted';

  -- Persist one existing locked FOH assignment and mark it confirmed.
  v_schedule_existing := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', '2099-12-26',
      'location_id', v_alam,
      'service_name', v_prefix || '_existing',
      'start_time', '08:00',
      'end_time', '10:00'
    ),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_locked))
  );

  SELECT id INTO v_assignment_existing
  FROM public.assignments
  WHERE schedule_id = v_schedule_existing AND role = 'FOH';

  UPDATE public.assignments
  SET confirmation_status = 'confirmed'
  WHERE id = v_assignment_existing;

  -- Create external commitments used to test cross-church and overlap rechecks.
  v_schedule_cross := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', '2099-12-26',
      'location_id', v_bsd,
      'service_name', v_prefix || '_cross_base',
      'start_time', '08:00',
      'end_time', '09:00'
    ),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_cross))
  );

  v_schedule_overlap := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', '2099-12-26',
      'location_id', v_alam,
      'service_name', v_prefix || '_overlap_base',
      'start_time', '17:00',
      'end_time', '18:00'
    ),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_overlap))
  );

  -- SUCCESS: one existing draft is augmented and one missing service is created.
  v_expected := jsonb_build_array(
    jsonb_build_object(
      'template_id', v_template_existing,
      'schedule_id', v_schedule_existing,
      'service_date', '2099-12-26',
      'location_id', v_alam,
      'service_name', v_prefix || '_existing',
      'start_time', '08:00',
      'end_time', '10:00',
      'expected_status', 'draft',
      'assignments', jsonb_build_array(jsonb_build_object(
        'id', v_assignment_existing,
        'role', 'FOH',
        'servant_id', v_locked,
        'confirmation_status', 'confirmed'
      ))
    ),
    jsonb_build_object(
      'template_id', v_template_new,
      'schedule_id', NULL,
      'service_date', '2099-12-27',
      'location_id', v_alam,
      'service_name', v_prefix || '_new',
      'start_time', '09:00',
      'end_time', '11:00',
      'expected_status', 'new',
      'assignments', '[]'::jsonb
    )
  );

  v_plan := jsonb_build_array(
    jsonb_build_object(
      'service_date', '2099-12-26',
      'location_id', v_alam,
      'service_name', v_prefix || '_existing',
      'role', 'Monitor',
      'servant_id', v_monitor
    ),
    jsonb_build_object(
      'service_date', '2099-12-27',
      'location_id', v_alam,
      'service_name', v_prefix || '_new',
      'role', 'FOH',
      'servant_id', v_new_foh
    )
  );

  SELECT public.admin_apply_monthly_schedule_plan(
    DATE '2099-12-01', v_expected, v_plan, false
  ) INTO v_result;

  IF v_result->>'created_schedules' <> '1'
     OR v_result->>'inserted_assignments' <> '2' THEN
    RAISE EXCEPTION 'Monthly additive apply returned unexpected counts: %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id = v_assignment_existing
      AND schedule_id = v_schedule_existing
      AND confirmation_status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'The existing assignment ID or confirmation state was not preserved';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE schedule_id = v_schedule_existing
      AND role = 'Monitor'
      AND servant_id = v_monitor
      AND confirmation_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'The vacant role on the existing service was not inserted as pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.schedules s
    JOIN public.assignments a ON a.schedule_id = s.id
    WHERE s.service_date = DATE '2099-12-27'
      AND s.location_id = v_alam
      AND s.service_name = v_prefix || '_new'
      AND s.status = 'draft'
      AND a.role = 'FOH'
      AND a.servant_id = v_new_foh
      AND a.confirmation_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A missing service was not created as a draft with pending assignment confirmation';
  END IF;

  -- STALE NEW SERVICE: another administrator created the natural-key service
  -- after preview. The RPC must reject the plan rather than adopt that row.
  INSERT INTO public.schedules(
    service_date, location_id, service_name, start_time, end_time, status
  ) VALUES (
    DATE '2099-12-26', v_alam, v_prefix || '_race', '10:00', '11:00', 'draft'
  );

  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', v_template_race,
    'schedule_id', NULL,
    'service_date', '2099-12-26',
    'location_id', v_alam,
    'service_name', v_prefix || '_race',
    'start_time', '10:00',
    'end_time', '11:00',
    'expected_status', 'new',
    'assignments', '[]'::jsonb
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-26',
    'location_id', v_alam,
    'service_name', v_prefix || '_race',
    'role', 'FOH',
    'servant_id', v_race_servant
  ));

  BEGIN
    PERFORM public.admin_apply_monthly_schedule_plan(
      DATE '2099-12-01', v_expected, v_plan, false
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX901',
      MESSAGE = 'Monthly plan unexpectedly adopted a service created after preview';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'The monthly schedule preview is stale: a new service was created after preview' THEN
      RAISE EXCEPTION 'Unexpected stale-new-service result: %', v_message;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date=DATE '2099-12-26'
      AND location_id=v_alam
      AND service_name=v_prefix || '_race'
      AND status='draft'
  ) OR EXISTS (
    SELECT 1 FROM public.assignments a
    JOIN public.schedules s ON s.id=a.schedule_id
    WHERE s.service_name=v_prefix || '_race'
  ) THEN
    RAISE EXCEPTION 'Stale new-service rejection changed the concurrent service or inserted an assignment';
  END IF;

  -- STALE ASSIGNMENT: a different administrator fills Monitor after preview.
  v_schedule_stale := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object(
      'service_date', '2099-12-26',
      'location_id', v_alam,
      'service_name', v_prefix || '_stale',
      'start_time', '11:00',
      'end_time', '12:00'
    ),
    jsonb_build_array(jsonb_build_object('role', 'FOH', 'servant_id', v_stale_foh))
  );

  SELECT id INTO v_assignment_stale_foh
  FROM public.assignments
  WHERE schedule_id=v_schedule_stale AND role='FOH';

  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', v_template_stale,
    'schedule_id', v_schedule_stale,
    'service_date', '2099-12-26',
    'location_id', v_alam,
    'service_name', v_prefix || '_stale',
    'start_time', '11:00',
    'end_time', '12:00',
    'expected_status', 'draft',
    'assignments', jsonb_build_array(jsonb_build_object(
      'id', v_assignment_stale_foh,
      'role', 'FOH',
      'servant_id', v_stale_foh,
      'confirmation_status', 'pending'
    ))
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-26',
    'location_id', v_alam,
    'service_name', v_prefix || '_stale',
    'role', 'Monitor',
    'servant_id', v_stale_assistant
  ));

  INSERT INTO public.assignments(schedule_id, servant_id, role, confirmation_status)
  VALUES (v_schedule_stale, v_stale_monitor, 'Monitor', 'pending')
  RETURNING id INTO v_assignment_stale_monitor;

  BEGIN
    PERFORM public.admin_apply_monthly_schedule_plan(
      DATE '2099-12-01', v_expected, v_plan, false
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX902',
      MESSAGE = 'Monthly plan unexpectedly replaced a role filled after preview';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'The monthly schedule preview is stale: existing assignments or confirmations changed' THEN
      RAISE EXCEPTION 'Unexpected stale-assignment result: %', v_message;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id=v_assignment_stale_monitor
      AND schedule_id=v_schedule_stale
      AND servant_id=v_stale_monitor
      AND role='Monitor'
  ) OR EXISTS (
    SELECT 1 FROM public.assignments
    WHERE schedule_id=v_schedule_stale
      AND role='Monitor'
      AND servant_id=v_stale_assistant
  ) THEN
    RAISE EXCEPTION 'The stale-preview rejection overwrote a manual assignment';
  END IF;

  -- STALE CONFIRMATION: a servant confirms after preview. Confirmation state
  -- is part of the snapshot and must remain unchanged when apply is rejected.
  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', v_template_stale,
    'schedule_id', v_schedule_stale,
    'service_date', '2099-12-26',
    'location_id', v_alam,
    'service_name', v_prefix || '_stale',
    'start_time', '11:00',
    'end_time', '12:00',
    'expected_status', 'draft',
    'assignments', jsonb_build_array(
      jsonb_build_object(
        'id', v_assignment_stale_foh,
        'role', 'FOH',
        'servant_id', v_stale_foh,
        'confirmation_status', 'pending'
      ),
      jsonb_build_object(
        'id', v_assignment_stale_monitor,
        'role', 'Monitor',
        'servant_id', v_stale_monitor,
        'confirmation_status', 'pending'
      )
    )
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-26',
    'location_id', v_alam,
    'service_name', v_prefix || '_stale',
    'role', 'Assistant',
    'servant_id', v_stale_assistant
  ));

  UPDATE public.assignments
  SET confirmation_status='confirmed'
  WHERE id=v_assignment_stale_foh;

  BEGIN
    PERFORM public.admin_apply_monthly_schedule_plan(
      DATE '2099-12-01', v_expected, v_plan, false
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX903',
      MESSAGE = 'Monthly plan unexpectedly ignored a confirmation change after preview';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'The monthly schedule preview is stale: existing assignments or confirmations changed' THEN
      RAISE EXCEPTION 'Unexpected stale-confirmation result: %', v_message;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE id=v_assignment_stale_foh AND confirmation_status='confirmed'
  ) OR EXISTS (
    SELECT 1 FROM public.assignments
    WHERE schedule_id=v_schedule_stale AND role='Assistant'
  ) THEN
    RAISE EXCEPTION 'The stale-confirmation rejection changed assignments or confirmations';
  END IF;

  -- EXPLICIT UNAVAILABLE: fail closed and roll back the draft schedule insert.
  INSERT INTO public.servant_availability(servant_id, service_date, status)
  VALUES (v_unavailable, DATE '2099-12-26', 'unavailable');

  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', v_template_unavailable, 'schedule_id', NULL,
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_unavailable',
    'start_time', '12:00', 'end_time', '13:00',
    'expected_status', 'new', 'assignments', '[]'::jsonb
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_unavailable',
    'role', 'FOH', 'servant_id', v_unavailable
  ));

  BEGIN
    PERFORM public.admin_apply_monthly_schedule_plan(
      DATE '2099-12-01', v_expected, v_plan, false
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX904',
      MESSAGE = 'Monthly plan unexpectedly accepted an explicitly unavailable servant';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant is marked unavailable on a service date' THEN
      RAISE EXCEPTION 'Unexpected explicit-unavailable result: %', v_message;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date=DATE '2099-12-26'
      AND location_id=v_alam
      AND service_name=v_prefix || '_unavailable'
  ) THEN
    RAISE EXCEPTION 'Explicit-unavailable rejection did not roll back the new draft service';
  END IF;

  -- RECURRING UNAVAILABLE: the database independently matches the active rule.
  INSERT INTO public.servant_availability_rules(
    servant_id, pattern, status, effective_from, effective_until, weekday, ordinal
  ) VALUES (
    v_recurring, 'saturday', 'unavailable',
    DATE '2099-12-26', DATE '2099-12-26', 6, 2
  );

  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', v_template_recurring, 'schedule_id', NULL,
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_recurring',
    'start_time', '13:00', 'end_time', '14:00',
    'expected_status', 'new', 'assignments', '[]'::jsonb
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_recurring',
    'role', 'FOH', 'servant_id', v_recurring
  ));

  BEGIN
    PERFORM public.admin_apply_monthly_schedule_plan(
      DATE '2099-12-01', v_expected, v_plan, false
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX905',
      MESSAGE = 'Monthly plan unexpectedly accepted a recurring-unavailable servant';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant is unavailable under a recurring rule' THEN
      RAISE EXCEPTION 'Unexpected recurring-unavailable result: %', v_message;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date=DATE '2099-12-26'
      AND location_id=v_alam
      AND service_name=v_prefix || '_recurring'
  ) THEN
    RAISE EXCEPTION 'Recurring-unavailable rejection did not roll back the new draft service';
  END IF;

  -- PREFER NOT: explicit administrator acknowledgement is required at commit.
  INSERT INTO public.servant_availability(servant_id, service_date, status)
  VALUES (v_prefer_not, DATE '2099-12-26', 'prefer_not');

  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', v_template_prefer_not, 'schedule_id', NULL,
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_prefer_not',
    'start_time', '14:00', 'end_time', '15:00',
    'expected_status', 'new', 'assignments', '[]'::jsonb
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_prefer_not',
    'role', 'FOH', 'servant_id', v_prefer_not
  ));

  BEGIN
    PERFORM public.admin_apply_monthly_schedule_plan(
      DATE '2099-12-01', v_expected, v_plan, false
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX906',
      MESSAGE = 'Monthly plan unexpectedly accepted prefer-not without acknowledgement';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A prefer-not assignment requires administrator acknowledgement' THEN
      RAISE EXCEPTION 'Unexpected prefer-not result: %', v_message;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date=DATE '2099-12-26'
      AND location_id=v_alam
      AND service_name=v_prefix || '_prefer_not'
  ) THEN
    RAISE EXCEPTION 'Prefer-not rejection did not roll back the new draft service';
  END IF;

  SELECT public.admin_apply_monthly_schedule_plan(
    DATE '2099-12-01', v_expected, v_plan, true
  ) INTO v_result;

  IF v_result->>'created_schedules' <> '1'
     OR v_result->>'inserted_assignments' <> '1'
     OR NOT EXISTS (
       SELECT 1
       FROM public.schedules s
       JOIN public.assignments a ON a.schedule_id=s.id
       WHERE s.service_date=DATE '2099-12-26'
         AND s.location_id=v_alam
         AND s.service_name=v_prefix || '_prefer_not'
         AND s.status='draft'
         AND a.servant_id=v_prefer_not
         AND a.confirmation_status='pending'
     ) THEN
    RAISE EXCEPTION 'Acknowledged prefer-not assignment did not apply as a pending draft assignment';
  END IF;

  -- CROSS-CHURCH: a commitment at BSD blocks Alam Sutera on the same date.
  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', v_template_cross, 'schedule_id', NULL,
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_cross',
    'start_time', '15:00', 'end_time', '16:00',
    'expected_status', 'new', 'assignments', '[]'::jsonb
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_cross',
    'role', 'FOH', 'servant_id', v_cross
  ));

  BEGIN
    PERFORM public.admin_apply_monthly_schedule_plan(
      DATE '2099-12-01', v_expected, v_plan, false
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX907',
      MESSAGE = 'Monthly plan unexpectedly accepted a same-day cross-church commitment';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant is already assigned at another church location on the same date' THEN
      RAISE EXCEPTION 'Unexpected cross-church result: %', v_message;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date=DATE '2099-12-26'
      AND location_id=v_alam
      AND service_name=v_prefix || '_cross'
  ) THEN
    RAISE EXCEPTION 'Cross-church rejection did not roll back the new draft service';
  END IF;

  -- OVERLAP: non-overlapping same-church services are permitted, but this
  -- overlapping same-church slot must be rejected by the final-set validator.
  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', v_template_overlap, 'schedule_id', NULL,
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_overlap',
    'start_time', '17:30', 'end_time', '18:30',
    'expected_status', 'new', 'assignments', '[]'::jsonb
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_overlap',
    'role', 'FOH', 'servant_id', v_overlap
  ));

  BEGIN
    PERFORM public.admin_apply_monthly_schedule_plan(
      DATE '2099-12-01', v_expected, v_plan, false
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX908',
      MESSAGE = 'Monthly plan unexpectedly accepted an overlapping same-church service';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant has an overlapping service at the same church' THEN
      RAISE EXCEPTION 'Unexpected overlap result: %', v_message;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date=DATE '2099-12-26'
      AND location_id=v_alam
      AND service_name=v_prefix || '_overlap'
  ) THEN
    RAISE EXCEPTION 'Overlap rejection did not roll back the new draft service';
  END IF;

  -- SAVED SERVICE SCOPE: an active allow-list for another church must block
  -- a generated assignment even if the browser were to tamper with its plan.
  INSERT INTO public.servant_serving_preferences(
    servant_id, rule_type, location_id, service_names, active
  ) VALUES (
    v_restricted, 'allowed_service_scope', v_bsd,
    ARRAY['Only BSD service'], true
  );

  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', v_template_restricted, 'schedule_id', NULL,
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_restricted',
    'start_time', '16:00', 'end_time', '17:00',
    'expected_status', 'new', 'assignments', '[]'::jsonb
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-26', 'location_id', v_alam,
    'service_name', v_prefix || '_restricted',
    'role', 'FOH', 'servant_id', v_restricted
  ));

  BEGIN
    PERFORM public.admin_apply_monthly_schedule_plan(
      DATE '2099-12-01', v_expected, v_plan, false
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX909',
      MESSAGE = 'Monthly plan unexpectedly bypassed a saved service-scope restriction';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant does not match their serving eligibility rules' THEN
      RAISE EXCEPTION 'Unexpected service-scope result: %', v_message;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date=DATE '2099-12-26'
      AND location_id=v_alam
      AND service_name=v_prefix || '_restricted'
  ) THEN
    RAISE EXCEPTION 'Service-scope rejection did not roll back the new draft service';
  END IF;

  -- NON-ADMIN callers are rejected before any staging or persistent writes.
  IF v_non_admin IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_non_admin::text, true);
    BEGIN
      PERFORM public.admin_apply_monthly_schedule_plan(
        DATE '2099-12-01', '[]'::jsonb, '[]'::jsonb, false
      );
      RAISE EXCEPTION USING ERRCODE = 'ZX910',
        MESSAGE = 'Monthly plan RPC unexpectedly accepted a non-admin caller';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      IF v_message <> 'Only administrators can apply a monthly schedule plan' THEN
        RAISE EXCEPTION 'Unexpected non-admin result: %', v_message;
      END IF;
    END;
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  END IF;

  -- ONE-OFF SPECIAL SERVICE: a Friday public-holiday service has no
  -- weekend template, but may be added as a new draft monthly service.
  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', NULL, 'schedule_id', NULL,
    'service_date', '2099-12-25', 'location_id', v_alam,
    'service_name', v_prefix || '_christmas',
    'start_time', '10:00', 'end_time', '12:00',
    'expected_status', 'new_special', 'assignments', '[]'::jsonb
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-25', 'location_id', v_alam,
    'service_name', v_prefix || '_christmas',
    'role', 'FOH', 'servant_id', v_new_foh
  ));
  SELECT public.admin_apply_monthly_schedule_plan(
    DATE '2099-12-01', v_expected, v_plan, false
  ) INTO v_result;

  IF v_result->>'created_schedules' <> '1'
     OR v_result->>'inserted_assignments' <> '1'
     OR NOT EXISTS (
       SELECT 1
       FROM public.schedules s
       JOIN public.assignments a ON a.schedule_id=s.id
       WHERE s.service_date=DATE '2099-12-25'
         AND s.location_id=v_alam
         AND s.service_name=v_prefix || '_christmas'
         AND s.status='draft'
         AND a.role='FOH'
         AND a.servant_id=v_new_foh
         AND a.confirmation_status='pending'
     ) THEN
    RAISE EXCEPTION 'A weekday special service was not created as an additive draft';
  END IF;

  -- ROLE QUALIFICATION: browser input cannot assign a servant outside their
  -- administrator-approved role list. The failed attempt must fully roll back.
  v_expected := jsonb_build_array(jsonb_build_object(
    'template_id', NULL, 'schedule_id', NULL,
    'service_date', '2099-12-25', 'location_id', v_alam,
    'service_name', v_prefix || '_role_guard',
    'start_time', '13:00', 'end_time', '14:00',
    'expected_status', 'new_special', 'assignments', '[]'::jsonb
  ));
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-25', 'location_id', v_alam,
    'service_name', v_prefix || '_role_guard',
    'role', 'Monitor', 'servant_id', v_role_limited
  ));

  BEGIN
    PERFORM public.admin_apply_monthly_schedule_plan(
      DATE '2099-12-01', v_expected, v_plan, false
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX911',
      MESSAGE = 'Monthly plan unexpectedly assigned a servant to an unqualified sound role';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A selected servant is not qualified for the proposed sound role' THEN
      RAISE EXCEPTION 'Unexpected role qualification result: %', v_message;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.schedules
    WHERE service_date=DATE '2099-12-25'
      AND location_id=v_alam
      AND service_name=v_prefix || '_role_guard'
  ) THEN
    RAISE EXCEPTION 'Unqualified role rejection did not roll back the new special service';
  END IF;

  -- A role the servant is qualified for may still be applied to a special slot.
  v_plan := jsonb_build_array(jsonb_build_object(
    'service_date', '2099-12-25', 'location_id', v_alam,
    'service_name', v_prefix || '_role_guard',
    'role', 'FOH', 'servant_id', v_role_limited
  ));
  SELECT public.admin_apply_monthly_schedule_plan(
    DATE '2099-12-01', v_expected, v_plan, false
  ) INTO v_result;

  IF v_result->>'created_schedules' <> '1'
     OR v_result->>'inserted_assignments' <> '1'
     OR NOT EXISTS (
       SELECT 1 FROM public.schedules s
       JOIN public.assignments a ON a.schedule_id=s.id
       WHERE s.service_date=DATE '2099-12-25'
         AND s.location_id=v_alam
         AND s.service_name=v_prefix || '_role_guard'
         AND a.role='FOH'
         AND a.servant_id=v_role_limited
     ) THEN
    RAISE EXCEPTION 'A qualified FOH role assignment did not apply after the rejected Monitor role';
  END IF;

  RAISE NOTICE 'Monthly schedule plan Staging regression passed: additive inserts, special service insert, servant role qualification, locked confirmation preservation, new-service race, manual assignment race, confirmation race, explicit/recurring unavailable, prefer-not acknowledgement, cross-church, overlap, saved service scope and admin authorization.';
END;
$monthly_schedule_plan_apply$;

ROLLBACK;
