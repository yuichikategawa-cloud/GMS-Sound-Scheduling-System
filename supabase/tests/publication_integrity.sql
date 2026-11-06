-- Rollback-only publication integrity regression; staging only.
-- All synthetic rows, notifications, and status changes are rolled back.
BEGIN;
DO $publication_integrity$
DECLARE
  v_admin uuid;
  v_location uuid;
  v_servant uuid;
  v_schedule uuid;
  v_valid uuid;
  v_message text;
  v_changed integer;
  v_prefix text;
BEGIN
  SELECT id INTO v_admin FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_location FROM public.locations ORDER BY name LIMIT 1;
  IF v_admin IS NULL OR v_location IS NULL THEN
    RAISE EXCEPTION 'A staging admin and location are required';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin JWT simulation failed'; END IF;
  v_prefix := 'GMS_TEST_PUBLISH_' || left(md5(txid_current()::text),10);
  INSERT INTO public.servants(full_name,active)
  VALUES (v_prefix || '_guard',true) RETURNING id INTO v_servant;
  v_schedule := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object('service_date','2099-12-20','location_id',v_location,
      'service_name',v_prefix || '_guard','start_time','08:00','end_time','09:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_servant))
  );
  UPDATE public.servants SET active=false WHERE id=v_servant;
  BEGIN
    PERFORM public.admin_publish_schedules_grouped(NULL,ARRAY[v_schedule],'published');
    RAISE EXCEPTION USING ERRCODE='ZX801',MESSAGE='Inactive servant was published';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'Cannot publish: one or more assigned servants are inactive. Review the assignments first.' THEN
      RAISE EXCEPTION 'Unexpected inactive-servant result: %',v_message;
    END IF;
  END;
  IF (SELECT status FROM public.schedules WHERE id=v_schedule) <> 'draft' THEN
    RAISE EXCEPTION 'Rejected publication changed schedule status';
  END IF;
  INSERT INTO public.servants(full_name,active)
  VALUES (v_prefix || '_valid',true) RETURNING id INTO v_servant;
  v_valid := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object('service_date','2099-12-21','location_id',v_location,
      'service_name',v_prefix || '_valid','start_time','10:00','end_time','11:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_servant))
  );
  v_changed := public.admin_publish_schedules_grouped(NULL,ARRAY[v_valid],'published');
  IF v_changed <> 1 THEN RAISE EXCEPTION 'Expected one publication, got %',v_changed; END IF;
  v_changed := public.admin_publish_schedules_grouped(NULL,ARRAY[v_valid],'published');
  IF v_changed <> 0 THEN RAISE EXCEPTION 'Repeated publication should be a no-op'; END IF;
  v_changed := public.admin_publish_schedules_grouped(NULL,ARRAY[v_valid],'draft');
  IF v_changed <> 1 OR (SELECT status FROM public.schedules WHERE id=v_valid) <> 'draft' THEN
    RAISE EXCEPTION 'Unpublish failed';
  END IF;
END;
$publication_integrity$;
ROLLBACK;
