-- Rollback-only publication integrity regression; staging only.
BEGIN;
DO $publication_integrity$
DECLARE
  v_admin uuid; v_location uuid; v_other_location uuid;
  v_inactive uuid; v_dated uuid; v_recurring uuid; v_preference uuid;
  v_cross uuid; v_overlap uuid; v_valid uuid;
  v_inactive_schedule uuid; v_dated_schedule uuid; v_recurring_schedule uuid;
  v_preference_schedule uuid; v_cross_source uuid; v_cross_target uuid;
  v_overlap_source uuid; v_overlap_target uuid; v_valid_schedule uuid;
  v_prefix text; v_message text; v_changed integer; v_status text;
BEGIN
  SELECT id INTO v_admin FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_location FROM public.locations ORDER BY name LIMIT 1;
  SELECT id INTO v_other_location FROM public.locations WHERE id IS DISTINCT FROM v_location ORDER BY name LIMIT 1;
  IF v_admin IS NULL OR v_location IS NULL OR v_other_location IS NULL THEN RAISE EXCEPTION 'A staging admin and two church locations are required'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('gms.suppress_assignment_notifications','on',true);
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin JWT simulation failed'; END IF;
  v_prefix := 'GMS_TEST_PUBLISH_' || left(md5(txid_current()::text),10);

  INSERT INTO public.servants(full_name,active) VALUES(v_prefix||'_inactive',true) RETURNING id INTO v_inactive;
  v_inactive_schedule := public.admin_save_schedule_with_assignments(NULL,
    jsonb_build_object('service_date','2099-12-20','location_id',v_location,'service_name',v_prefix||'_inactive','start_time','08:00','end_time','09:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_inactive)));
  UPDATE public.servants SET active=false WHERE id=v_inactive;
  BEGIN
    PERFORM public.admin_publish_schedules_grouped(NULL,ARRAY[v_inactive_schedule],'published');
    RAISE EXCEPTION USING ERRCODE='ZX801',MESSAGE='Inactive servant was published';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'Cannot publish: one or more assigned servants are inactive. Review the assignments first.' THEN RAISE EXCEPTION 'Unexpected inactive result: %',v_message; END IF;
  END;

  INSERT INTO public.servants(full_name,active) VALUES(v_prefix||'_dated',true) RETURNING id INTO v_dated;
  v_dated_schedule := public.admin_save_schedule_with_assignments(NULL,
    jsonb_build_object('service_date','2099-12-21','location_id',v_location,'service_name',v_prefix||'_dated','start_time','08:00','end_time','09:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_dated)));
  INSERT INTO public.servant_availability(servant_id,service_date,status,notes) VALUES(v_dated,DATE '2099-12-22','unavailable',v_prefix);
  UPDATE public.schedules SET service_date=DATE '2099-12-22' WHERE id=v_dated_schedule;
  BEGIN
    PERFORM public.admin_publish_schedules_grouped(NULL,ARRAY[v_dated_schedule],'published');
    RAISE EXCEPTION USING ERRCODE='ZX802',MESSAGE='Dated unavailable servant was published';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'Cannot publish: one or more assigned servants are marked unavailable on the service date.' THEN RAISE EXCEPTION 'Unexpected dated result: %',v_message; END IF;
  END;

  INSERT INTO public.servants(full_name,active) VALUES(v_prefix||'_recurring',true) RETURNING id INTO v_recurring;
  v_recurring_schedule := public.admin_save_schedule_with_assignments(NULL,
    jsonb_build_object('service_date','2099-12-23','location_id',v_location,'service_name',v_prefix||'_recurring','start_time','08:00','end_time','09:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_recurring)));
  INSERT INTO public.servant_availability_rules(servant_id,pattern,status,effective_from,effective_until,weekday,ordinal,notes)
  VALUES(v_recurring,'saturday','unavailable',DATE '2099-12-26',DATE '2099-12-26',6,1,v_prefix);
  UPDATE public.schedules SET service_date=DATE '2099-12-26' WHERE id=v_recurring_schedule;
  BEGIN
    PERFORM public.admin_publish_schedules_grouped(NULL,ARRAY[v_recurring_schedule],'published');
    RAISE EXCEPTION USING ERRCODE='ZX803',MESSAGE='Recurring unavailable servant was published';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'Cannot publish: one or more assigned servants are unavailable under a recurring rule.' THEN RAISE EXCEPTION 'Unexpected recurring result: %',v_message; END IF;
  END;

  INSERT INTO public.servants(full_name,active) VALUES(v_prefix||'_preference',true) RETURNING id INTO v_preference;
  v_preference_schedule := public.admin_save_schedule_with_assignments(NULL,
    jsonb_build_object('service_date','2099-12-24','location_id',v_location,'service_name',v_prefix||'_restricted','start_time','08:00','end_time','09:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_preference)));
  INSERT INTO public.servant_serving_preferences(servant_id,rule_type,days_of_week,service_names,location_id,active)
  VALUES(v_preference,'allowed_service_scope',ARRAY[]::smallint[],ARRAY[v_prefix||'_allowed'],v_location,true);
  BEGIN
    PERFORM public.admin_publish_schedules_grouped(NULL,ARRAY[v_preference_schedule],'published');
    RAISE EXCEPTION USING ERRCODE='ZX804',MESSAGE='Out-of-scope servant was published';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'Cannot publish: one or more assigned servants do not match their serving eligibility rules.' THEN RAISE EXCEPTION 'Unexpected preference result: %',v_message; END IF;
  END;

  INSERT INTO public.servants(full_name,active) VALUES(v_prefix||'_cross',true) RETURNING id INTO v_cross;
  v_cross_source := public.admin_save_schedule_with_assignments(NULL,
    jsonb_build_object('service_date','2099-12-27','location_id',v_location,'service_name',v_prefix||'_cross_a','start_time','08:00','end_time','09:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_cross)));
  v_cross_target := public.admin_save_schedule_with_assignments(NULL,
    jsonb_build_object('service_date','2099-12-28','location_id',v_other_location,'service_name',v_prefix||'_cross_b','start_time','10:00','end_time','11:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_cross)));
  UPDATE public.schedules SET service_date=DATE '2099-12-27' WHERE id=v_cross_target;
  BEGIN
    PERFORM public.admin_publish_schedules_grouped(NULL,ARRAY[v_cross_target],'published');
    RAISE EXCEPTION USING ERRCODE='ZX805',MESSAGE='Cross-location conflict was published';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'Cannot publish: one or more servants are assigned at another church location on the same date.' THEN RAISE EXCEPTION 'Unexpected cross-location result: %',v_message; END IF;
  END;

  INSERT INTO public.servants(full_name,active) VALUES(v_prefix||'_overlap',true) RETURNING id INTO v_overlap;
  v_overlap_source := public.admin_save_schedule_with_assignments(NULL,
    jsonb_build_object('service_date','2099-12-29','location_id',v_location,'service_name',v_prefix||'_overlap_a','start_time','08:00','end_time','09:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_overlap)));
  v_overlap_target := public.admin_save_schedule_with_assignments(NULL,
    jsonb_build_object('service_date','2099-12-30','location_id',v_location,'service_name',v_prefix||'_overlap_b','start_time','08:30','end_time','09:30'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_overlap)));
  UPDATE public.schedules SET service_date=DATE '2099-12-29' WHERE id=v_overlap_target;
  BEGIN
    PERFORM public.admin_publish_schedules_grouped(NULL,ARRAY[v_overlap_target],'published');
    RAISE EXCEPTION USING ERRCODE='ZX806',MESSAGE='Overlapping service was published';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'Cannot publish: one or more servants have overlapping services at the same church.' THEN RAISE EXCEPTION 'Unexpected overlap result: %',v_message; END IF;
  END;

  IF EXISTS(SELECT 1 FROM public.schedules WHERE id=ANY(ARRAY[v_inactive_schedule,v_dated_schedule,v_recurring_schedule,v_preference_schedule,v_cross_target,v_overlap_target]) AND status<>'draft') THEN
    RAISE EXCEPTION 'A rejected publication changed schedule status';
  END IF;
  INSERT INTO public.servants(full_name,active) VALUES(v_prefix||'_valid',true) RETURNING id INTO v_valid;
  v_valid_schedule := public.admin_save_schedule_with_assignments(NULL,
    jsonb_build_object('service_date','2099-12-31','location_id',v_location,'service_name',v_prefix||'_valid','start_time','11:00','end_time','12:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_valid)));
  v_changed := public.admin_publish_schedules_grouped(NULL,ARRAY[v_valid_schedule],'published');
  IF v_changed<>1 THEN RAISE EXCEPTION 'Expected one valid publication, got %',v_changed; END IF;
  v_changed := public.admin_publish_schedules_grouped(NULL,ARRAY[v_valid_schedule],'published');
  IF v_changed<>0 THEN RAISE EXCEPTION 'Repeated publication should be a no-op'; END IF;
  v_changed := public.admin_publish_schedules_grouped(NULL,ARRAY[v_valid_schedule],'draft');
  SELECT status INTO v_status FROM public.schedules WHERE id=v_valid_schedule;
  IF v_changed<>1 OR v_status<>'draft' THEN RAISE EXCEPTION 'Unpublish failed'; END IF;
END;
$publication_integrity$;
ROLLBACK;