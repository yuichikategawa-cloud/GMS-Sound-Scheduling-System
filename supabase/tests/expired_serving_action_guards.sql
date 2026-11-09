-- Rollback-only regression tests for database-side temporal enforcement.
-- Run after 20261108010000_gms_enforce_expired_serving_actions.sql and
-- 20261109010000_gms_enforce_availability_delete_deadline.sql.
-- No persistent data or settings changes remain after ROLLBACK.

BEGIN;

DO $expired_action_guards$
DECLARE
  v_admin uuid;
  v_servant_user uuid;
  v_servant uuid;
  v_target_servant uuid;
  v_location uuid;
  v_past_schedule uuid;
  v_future_source uuid;
  v_future_target uuid;
  v_past_assignment uuid;
  v_source_assignment uuid;
  v_target_assignment uuid;
  v_request uuid;
  v_dated_availability_id uuid;
  v_recurring_availability_id uuid;
  v_message text;
BEGIN
  SELECT id INTO v_admin FROM public.profiles WHERE role='admin' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_target_servant FROM public.servants
  WHERE active=true ORDER BY id LIMIT 1;
  SELECT id INTO v_location FROM public.locations ORDER BY name LIMIT 1;

  IF v_admin IS NULL OR v_target_servant IS NULL OR v_location IS NULL THEN
    RAISE EXCEPTION 'Test requires an admin profile, one active target servant, and a location';
  END IF;

  -- Reuse the existing authenticated admin identity as a temporary servant.
  -- The profile-role change, fixture servant, and all test rows are inside this
  -- transaction and are reverted by the final ROLLBACK. This avoids inserting
  -- synthetic rows into Supabase's protected auth schema.
  v_servant_user := v_admin;
  INSERT INTO public.servants(full_name,active,auth_user_id)
  VALUES('GMS rollback-only temporal test servant',true,v_servant_user)
  RETURNING id INTO v_servant;
  UPDATE public.profiles SET role='servant' WHERE id=v_servant_user;
  PERFORM set_config('request.jwt.claim.sub',v_servant_user::text,true);
  IF public.is_admin() THEN RAISE EXCEPTION 'Temporary servant JWT unexpectedly resolves as admin'; END IF;
  UPDATE public.profiles SET role='admin' WHERE id=v_admin;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin JWT simulation failed'; END IF;

  -- A published service in the past must reject a new replacement request.
  v_past_schedule := public.admin_save_schedule_with_assignments(
    NULL,
    jsonb_build_object('service_date','2000-01-01','location_id',v_location,
      'service_name','GMS_TEST_EXPIRED_REQUEST','start_time','08:00','end_time','09:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_servant))
  );
  SELECT id INTO v_past_assignment FROM public.assignments WHERE schedule_id=v_past_schedule LIMIT 1;
  UPDATE public.schedules SET status='published' WHERE id=v_past_schedule;

  BEGIN
    INSERT INTO public.serving_requests(schedule_id,assignment_id,requester_servant_id,request_type,details,status)
    VALUES(v_past_schedule,v_past_assignment,v_servant,'replacement','rollback temporal test','pending');
    RAISE EXCEPTION USING ERRCODE='ZX901', MESSAGE='Expired replacement request was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'The original service has already started%' THEN
      RAISE EXCEPTION 'Unexpected expired request result: %',v_message;
    END IF;
  END;

  -- A servant cannot change confirmation status after service start.
  UPDATE public.profiles SET role='servant' WHERE id=v_servant_user;
  PERFORM set_config('request.jwt.claim.sub',v_servant_user::text,true);
  IF public.is_admin() THEN RAISE EXCEPTION 'Servant JWT unexpectedly resolves as admin'; END IF;
  BEGIN
    UPDATE public.assignments SET confirmation_status='confirmed' WHERE id=v_past_assignment;
    RAISE EXCEPTION USING ERRCODE='ZX902', MESSAGE='Expired confirmation update was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'This service has started%' THEN
      RAISE EXCEPTION 'Unexpected expired confirmation result: %',v_message;
    END IF;
  END;

  -- A configured, elapsed deadline must reject dated and recurring availability writes.
  UPDATE public.profiles SET role='admin' WHERE id=v_admin;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  -- Create owned availability rows before closing the deadline so DELETE can
  -- be tested independently of INSERT rejection.
  INSERT INTO public.servant_availability(servant_id,service_date,status,notes)
  VALUES(v_servant,DATE '2099-01-02','available','rollback delete deadline test')
  RETURNING id INTO v_dated_availability_id;
  INSERT INTO public.servant_availability_rules(servant_id,pattern,status,effective_from,effective_until,weekday,ordinal,notes)
  VALUES(v_servant,'saturday','prefer_not',DATE '2099-01-01',DATE '2099-12-31',6,1,'rollback delete deadline test')
  RETURNING id INTO v_recurring_availability_id;

  INSERT INTO public.system_settings(key,value,updated_at,updated_by)
  VALUES('availability_deadline','2000-01-01',pg_catalog.now(),v_admin)
  ON CONFLICT (key) DO UPDATE
    SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at, updated_by=EXCLUDED.updated_by;

  UPDATE public.profiles SET role='servant' WHERE id=v_servant_user;
  PERFORM set_config('request.jwt.claim.sub',v_servant_user::text,true);
  BEGIN
    INSERT INTO public.servant_availability(servant_id,service_date,status,notes)
    VALUES(v_servant,DATE '2099-01-01','available','rollback deadline test');
    RAISE EXCEPTION USING ERRCODE='ZX903', MESSAGE='Expired deadline allowed dated availability write';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'The availability submission deadline has passed%' THEN
      RAISE EXCEPTION 'Unexpected dated availability deadline result: %',v_message;
    END IF;
  END;

  BEGIN
    INSERT INTO public.servant_availability_rules(servant_id,pattern,status,effective_from,effective_until,weekday,ordinal,notes)
    VALUES(v_servant,'saturday','prefer_not',DATE '2099-01-01',DATE '2099-12-31',6,1,'rollback deadline test');
    RAISE EXCEPTION USING ERRCODE='ZX904', MESSAGE='Expired deadline allowed recurring availability write';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'The availability submission deadline has passed%' THEN
      RAISE EXCEPTION 'Unexpected recurring availability deadline result: %',v_message;
    END IF;
  END;

  -- Servants must not bypass the deadline by deleting existing availability.
  BEGIN
    DELETE FROM public.servant_availability WHERE id=v_dated_availability_id;
    RAISE EXCEPTION USING ERRCODE='ZX907', MESSAGE='Expired deadline allowed dated availability delete';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'The availability submission deadline has passed%' THEN
      RAISE EXCEPTION 'Unexpected dated availability delete deadline result: %',v_message;
    END IF;
  END;

  BEGIN
    DELETE FROM public.servant_availability_rules WHERE id=v_recurring_availability_id;
    RAISE EXCEPTION USING ERRCODE='ZX908', MESSAGE='Expired deadline allowed recurring availability delete';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'The availability submission deadline has passed%' THEN
      RAISE EXCEPTION 'Unexpected recurring availability delete deadline result: %',v_message;
    END IF;
  END;

  -- Restore administrator identity for creation of a pending swap.
  UPDATE public.profiles SET role='admin' WHERE id=v_admin;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  v_future_source := public.admin_save_schedule_with_assignments(
    NULL,jsonb_build_object('service_date','2099-12-26','location_id',v_location,
      'service_name','GMS_TEST_EXPIRED_SWAP_SOURCE','start_time','08:00','end_time','09:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_servant))
  );
  v_future_target := public.admin_save_schedule_with_assignments(
    NULL,jsonb_build_object('service_date','2099-12-27','location_id',v_location,
      'service_name','GMS_TEST_EXPIRED_SWAP_TARGET','start_time','08:00','end_time','09:00'),
    jsonb_build_array(jsonb_build_object('role','FOH','servant_id',v_target_servant))
  );
  SELECT id INTO v_source_assignment FROM public.assignments WHERE schedule_id=v_future_source LIMIT 1;
  SELECT id INTO v_target_assignment FROM public.assignments WHERE schedule_id=v_future_target LIMIT 1;
  UPDATE public.schedules SET status='published' WHERE id IN (v_future_source,v_future_target);

  -- A future source cannot be swapped into a target service that has already started.
  UPDATE public.schedules SET service_date=DATE '2000-01-02' WHERE id=v_future_target;
  BEGIN
    INSERT INTO public.serving_requests(schedule_id,assignment_id,requester_servant_id,request_type,details,status,
      target_schedule_id,target_assignment_id,target_servant_id)
    VALUES(v_future_source,v_source_assignment,v_servant,'swap','rollback expired target test','pending',
      v_future_target,v_target_assignment,v_target_servant);
    RAISE EXCEPTION USING ERRCODE='ZX906', MESSAGE='Swap request with expired target was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'The target service has already started%' THEN
      RAISE EXCEPTION 'Unexpected expired target request result: %',v_message;
    END IF;
  END;
  UPDATE public.schedules SET service_date=DATE '2099-12-27' WHERE id=v_future_target;

  INSERT INTO public.serving_requests(schedule_id,assignment_id,requester_servant_id,request_type,details,status,
    target_schedule_id,target_assignment_id,target_servant_id)
  VALUES(v_future_source,v_source_assignment,v_servant,'swap','rollback temporal swap test','pending',
    v_future_target,v_target_assignment,v_target_servant)
  RETURNING id INTO v_request;

  -- Simulate that both services have started while the request remains pending.
  UPDATE public.schedules SET service_date=DATE '2000-01-02' WHERE id IN (v_future_source,v_future_target);
  BEGIN
    PERFORM public.admin_execute_servant_swap(v_request);
    RAISE EXCEPTION USING ERRCODE='ZX905', MESSAGE='Expired pending swap was executed';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message NOT LIKE 'Both services must still be in the future%' THEN
      RAISE EXCEPTION 'Unexpected expired swap result: %',v_message;
    END IF;
  END;

  IF (SELECT status FROM public.serving_requests WHERE id=v_request) <> 'pending' THEN
    RAISE EXCEPTION 'Rejected expired swap changed request status';
  END IF;
END;
$expired_action_guards$;

ROLLBACK;
