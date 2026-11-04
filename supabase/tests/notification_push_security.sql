-- Rollback-only security regression tests for the notification/push hardening migration.
--
-- STAGING ONLY. Do not run against production.
-- Prerequisites: at least one synthetic admin account, one synthetic servant
-- account linked to an active servant roster row, and two profile accounts
-- without registered push subscriptions.
--
-- The script creates one future test schedule/assignment and test push rows,
-- exercises notification deduplication, endpoint validation, cross-account
-- transfer proof and the ten-device cap, then ROLLBACKs every change.

BEGIN;

DO $gms_notification_push_security_tests$
DECLARE
  v_admin_user uuid;
  v_servant_user uuid;
  v_servant_id uuid;
  v_other_user uuid;
  v_location_id uuid;
  v_schedule_id uuid;
  v_assignment_id uuid;
  v_assignment_notifications integer;
  v_admin_count integer;
  v_push_user_1 uuid;
  v_push_user_2 uuid;
  v_endpoint text;
  v_endpoint_id uuid;
  v_duplicate_id uuid;
  v_transfer_id uuid;
  v_user_1_count integer;
  v_user_2_count integer;
  v_endpoint_owner uuid;
  v_cap_user uuid;
  v_unregistered_user uuid;
  v_message text;
  v_suffix text := left(md5(txid_current()::text || clock_timestamp()::text), 16);
  v_i integer;
BEGIN
  SELECT id INTO v_admin_user
  FROM public.profiles
  WHERE role = 'admin'
  ORDER BY created_at
  LIMIT 1;

  SELECT s.id, s.auth_user_id
    INTO v_servant_id, v_servant_user
  FROM public.servants s
  JOIN public.profiles p ON p.id = s.auth_user_id AND p.role = 'servant'
  WHERE s.active = true AND s.auth_user_id IS NOT NULL
  ORDER BY s.full_name
  LIMIT 1;

  SELECT id INTO v_location_id
  FROM public.locations
  ORDER BY name
  LIMIT 1;

  SELECT count(*)::integer INTO v_admin_count
  FROM public.profiles
  WHERE role = 'admin';

  IF v_admin_user IS NULL OR v_servant_user IS NULL
     OR v_servant_id IS NULL OR v_location_id IS NULL
     OR v_admin_count < 1 THEN
    RAISE EXCEPTION
      'Create synthetic admin and linked active-servant accounts plus a location before running these staging tests';
  END IF;

  v_other_user := v_admin_user;

  -- A. The same confirmation transition must notify each admin exactly once.
  INSERT INTO public.schedules (
    service_date, location_id, service_name, start_time, end_time, status
  )
  VALUES (
    DATE '2099-12-26',
    v_location_id,
    'GMS_TEST_PUSH_' || v_suffix,
    TIME '23:00',
    TIME '23:30',
    'published'
  )
  RETURNING id INTO v_schedule_id;

  INSERT INTO public.assignments (
    schedule_id, servant_id, role, confirmation_status
  )
  VALUES (v_schedule_id, v_servant_id, 'FOH', 'pending')
  RETURNING id INTO v_assignment_id;

  PERFORM set_config('request.jwt.claim.sub', v_servant_user::text, true);
  UPDATE public.assignments
  SET confirmation_status = 'confirmed'
  WHERE id = v_assignment_id;

  PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);
  PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);

  SELECT count(*)::integer INTO v_assignment_notifications
  FROM public.serving_notifications
  WHERE event_key LIKE 'assignment-confirmation:' || v_assignment_id::text || ':%';

  IF v_assignment_notifications <> v_admin_count THEN
    RAISE EXCEPTION
      'Repeated confirmation calls created % notifications; expected %',
      v_assignment_notifications, v_admin_count;
  END IF;

  -- A later decline -> confirm cycle is a new event and should notify once.
  UPDATE public.assignments
  SET confirmation_status = 'declined'
  WHERE id = v_assignment_id;

  UPDATE public.assignments
  SET confirmation_status = 'confirmed'
  WHERE id = v_assignment_id;

  PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);
  PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);

  SELECT count(*)::integer INTO v_assignment_notifications
  FROM public.serving_notifications
  WHERE event_key LIKE 'assignment-confirmation:' || v_assignment_id::text || ':%';

  IF v_assignment_notifications <> v_admin_count * 2 THEN
    RAISE EXCEPTION
      'A second confirmation cycle created % notifications; expected %',
      v_assignment_notifications, v_admin_count * 2;
  END IF;

  -- A different signed-in user must not notify admins about this servant's row.
  IF v_other_user IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_other_user::text, true);
    BEGIN
      PERFORM public.notify_admin_assignment_confirmation(v_assignment_id);
      RAISE EXCEPTION USING ERRCODE = 'ZX701',
        MESSAGE = 'A different user invoked another servant confirmation';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      IF v_message NOT LIKE 'You can only notify administrators about your own assignment%' THEN
        RAISE EXCEPTION 'Unexpected cross-user notification result: %', v_message;
      END IF;
    END;
  END IF;

  -- Select two clean staging identities for push-registration isolation tests.
  SELECT p.id INTO v_push_user_1
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.serving_push_subscriptions ps WHERE ps.user_id = p.id
  )
  ORDER BY CASE WHEN p.role = 'admin' THEN 0 ELSE 1 END, p.created_at
  LIMIT 1;

  SELECT p.id INTO v_push_user_2
  FROM public.profiles p
  WHERE p.id IS DISTINCT FROM v_push_user_1
    AND NOT EXISTS (
      SELECT 1 FROM public.serving_push_subscriptions ps WHERE ps.user_id = p.id
    )
  ORDER BY p.created_at
  LIMIT 1;

  IF v_push_user_1 IS NULL OR v_push_user_2 IS NULL THEN
    RAISE EXCEPTION
      'Two profile accounts without existing push subscriptions are required for the staging registration tests';
  END IF;

  -- A non-null UID without a GMS profile must not register endpoints.
  v_unregistered_user := gen_random_uuid();
  PERFORM set_config('request.jwt.claim.sub', v_unregistered_user::text, true);
  BEGIN
    PERFORM public.register_serving_push_subscription(
      'https://fcm.googleapis.com/fcm/send/gms-unregistered-' || v_suffix,
      repeat('A', 87), repeat('B', 22), 'GMS security test'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX708', MESSAGE = 'UID without a GMS profile was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A GMS member account is required' THEN
      RAISE EXCEPTION 'Unexpected unregistered-user result: %', v_message;
    END IF;
  END;

  -- B. First registration and same-account registration are idempotent.
  v_endpoint :=
    'https://fcm.googleapis.com/fcm/send/gms-hardening-' || v_suffix;

  PERFORM set_config('request.jwt.claim.sub', v_push_user_1::text, true);
  v_endpoint_id := public.register_serving_push_subscription(
    v_endpoint, repeat('A', 87), repeat('B', 22), 'GMS security test'
  );
  v_duplicate_id := public.register_serving_push_subscription(
    v_endpoint, repeat('A', 87), repeat('B', 22), 'GMS security test'
  );

  IF v_endpoint_id IS DISTINCT FROM v_duplicate_id THEN
    RAISE EXCEPTION 'Re-registering the same endpoint created a second row';
  END IF;

  SELECT count(*)::integer INTO v_user_1_count
  FROM public.serving_push_subscriptions
  WHERE user_id = v_push_user_1 AND endpoint = v_endpoint;

  IF v_user_1_count <> 1 THEN
    RAISE EXCEPTION 'Same-account registration did not retain exactly one endpoint';
  END IF;

  -- C. Non-HTTPS and unapproved endpoint hosts are rejected.
  BEGIN
    PERFORM public.register_serving_push_subscription(
      'http://127.0.0.1/fcm/send/gms-hardening-' || v_suffix,
      repeat('A', 87), repeat('B', 22), 'GMS security test'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX702', MESSAGE = 'HTTP/private endpoint was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Push endpoint URL is not supported' THEN
      RAISE EXCEPTION 'Unexpected invalid-endpoint result: %', v_message;
    END IF;
  END;

  BEGIN
    PERFORM public.register_serving_push_subscription(
      'https://attacker.example/send/gms-hardening-' || v_suffix,
      repeat('A', 87), repeat('B', 22), 'GMS security test'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX703', MESSAGE = 'Unapproved host was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Push endpoint URL is not supported' THEN
      RAISE EXCEPTION 'Unexpected unapproved-host result: %', v_message;
    END IF;
  END;

  BEGIN
    PERFORM public.register_serving_push_subscription(
      v_endpoint || chr(10), repeat('A', 87), repeat('B', 22), 'GMS security test'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX709', MESSAGE = 'Control character in endpoint was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Push endpoint URL is not supported' THEN
      RAISE EXCEPTION 'Unexpected control-character endpoint result: %', v_message;
    END IF;
  END;

  -- D. Key encodings and user-agent size are bounded.
  BEGIN
    PERFORM public.register_serving_push_subscription(
      'https://fcm.googleapis.com/fcm/send/gms-invalid-key-' || v_suffix,
      'too-short', repeat('B', 22), 'GMS security test'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX704', MESSAGE = 'Invalid key material was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Push subscription keys are invalid' THEN
      RAISE EXCEPTION 'Unexpected invalid-key result: %', v_message;
    END IF;
  END;

  BEGIN
    PERFORM public.register_serving_push_subscription(
      'https://fcm.googleapis.com/fcm/send/gms-invalid-agent-' || v_suffix,
      repeat('A', 87), repeat('B', 22), repeat('x', 513)
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX705', MESSAGE = 'Oversized user agent was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Push user agent is invalid or too long' THEN
      RAISE EXCEPTION 'Unexpected user-agent result: %', v_message;
    END IF;
  END;

  -- E. Endpoint possession is required for a shared-device account switch.
  PERFORM set_config('request.jwt.claim.sub', v_push_user_2::text, true);

  BEGIN
    PERFORM public.register_serving_push_subscription(
      v_endpoint, repeat('C', 87), repeat('D', 22), 'GMS security test'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX706',
      MESSAGE = 'A different key pair took over another account endpoint';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'Push endpoint is already registered to another account%' THEN
      RAISE EXCEPTION 'Unexpected endpoint ownership result: %', v_message;
    END IF;
  END;

  SELECT user_id INTO v_endpoint_owner
  FROM public.serving_push_subscriptions
  WHERE id = v_endpoint_id;

  IF v_endpoint_owner IS DISTINCT FROM v_push_user_1 THEN
    RAISE EXCEPTION 'The rejected endpoint claim removed its original owner';
  END IF;

  -- The exact key pair from the active browser subscription may transfer it.
  v_transfer_id := public.register_serving_push_subscription(
    v_endpoint, repeat('A', 87), repeat('B', 22), 'GMS security test'
  );

  IF v_transfer_id IS DISTINCT FROM v_endpoint_id THEN
    RAISE EXCEPTION 'Shared-device transfer changed the subscription identity';
  END IF;

  SELECT user_id INTO v_endpoint_owner
  FROM public.serving_push_subscriptions
  WHERE id = v_endpoint_id;

  IF v_endpoint_owner IS DISTINCT FROM v_push_user_2 THEN
    RAISE EXCEPTION 'Proven shared-device endpoint transfer did not update ownership';
  END IF;

  -- F. Ten endpoints are allowed; an eleventh is rejected.
  v_cap_user := v_push_user_1;
  PERFORM set_config('request.jwt.claim.sub', v_cap_user::text, true);

  FOR v_i IN 1..10 LOOP
    PERFORM public.register_serving_push_subscription(
      'https://fcm.googleapis.com/fcm/send/gms-cap-' || v_suffix || '-' || v_i::text,
      repeat('A', 87),
      repeat('B', 22),
      'GMS security test'
    );
  END LOOP;

  SELECT count(*)::integer INTO v_user_2_count
  FROM public.serving_push_subscriptions
  WHERE user_id = v_cap_user;

  IF v_user_2_count <> 10 THEN
    RAISE EXCEPTION 'Expected ten registered devices, found %', v_user_2_count;
  END IF;

  BEGIN
    PERFORM public.register_serving_push_subscription(
      'https://fcm.googleapis.com/fcm/send/gms-cap-overflow-' || v_suffix,
      repeat('A', 87), repeat('B', 22), 'GMS security test'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX707', MESSAGE = 'Eleventh device was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'This account already has ten registered devices%' THEN
      RAISE EXCEPTION 'Unexpected device-cap result: %', v_message;
    END IF;
  END;
END;
$gms_notification_push_security_tests$;

ROLLBACK;
