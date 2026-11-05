-- Rollback-only tests for push subscription registration security.
-- STAGING ONLY. Requires two existing profiles (admin/servant) without
-- registered push subscriptions. No synthetic users or operational rows are created.
BEGIN;
DO $push_registration_security$
DECLARE
  v_user_1 uuid;
  v_user_2 uuid;
  v_unregistered uuid := gen_random_uuid();
  v_endpoint text;
  v_id uuid;
  v_again uuid;
  v_owner uuid;
  v_message text;
  v_count integer;
  v_suffix text := left(md5(txid_current()::text || clock_timestamp()::text), 16);
  i integer;
BEGIN
  SELECT p.id INTO v_user_1
  FROM public.profiles p
  WHERE p.role IN ('admin','servant')
    AND NOT EXISTS (SELECT 1 FROM public.serving_push_subscriptions s WHERE s.user_id=p.id)
  ORDER BY CASE WHEN p.role='admin' THEN 0 ELSE 1 END, p.created_at
  LIMIT 1;

  SELECT p.id INTO v_user_2
  FROM public.profiles p
  WHERE p.role IN ('admin','servant')
    AND p.id IS DISTINCT FROM v_user_1
    AND NOT EXISTS (SELECT 1 FROM public.serving_push_subscriptions s WHERE s.user_id=p.id)
  ORDER BY p.created_at
  LIMIT 1;

  IF v_user_1 IS NULL OR v_user_2 IS NULL THEN
    RAISE EXCEPTION 'Two existing GMS profiles without push subscriptions are required';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_unregistered::text, true);
  BEGIN
    PERFORM public.register_serving_push_subscription(
      'https://fcm.googleapis.com/fcm/send/unregistered-' || v_suffix,
      repeat('A',87), repeat('B',22), 'phase 1 test'
    );
    RAISE EXCEPTION USING ERRCODE='ZX801', MESSAGE='Unregistered UID was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'A GMS member account is required' THEN RAISE; END IF;
  END;

  v_endpoint := 'https://fcm.googleapis.com/fcm/send/phase1-' || v_suffix;
  PERFORM set_config('request.jwt.claim.sub', v_user_1::text, true);
  v_id := public.register_serving_push_subscription(v_endpoint,repeat('A',87),repeat('B',22),'phase 1 test');
  v_again := public.register_serving_push_subscription(v_endpoint,repeat('A',87),repeat('B',22),'phase 1 test');
  IF v_id IS DISTINCT FROM v_again THEN RAISE EXCEPTION 'Same endpoint registration was not idempotent'; END IF;

  FOREACH v_endpoint IN ARRAY ARRAY[
    'http://fcm.googleapis.com/fcm/send/phase1-' || v_suffix,
    'https://attacker.example/fcm/send/phase1-' || v_suffix,
    'https://push.apple.com/phase1-' || v_suffix,
    'https://push.apple.com.attacker.example/phase1-' || v_suffix,
    'https://fcm.googleapis.com/fcm/send/phase1-' || v_suffix || chr(10)
  ] LOOP
    BEGIN
      PERFORM public.register_serving_push_subscription(v_endpoint,repeat('A',87),repeat('B',22),'phase 1 test');
      RAISE EXCEPTION USING ERRCODE='ZX802', MESSAGE='Unsupported endpoint was accepted';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      IF v_message <> 'Push endpoint URL is not supported' THEN RAISE; END IF;
    END;
  END LOOP;

  BEGIN
    PERFORM public.register_serving_push_subscription(
      'https://fcm.googleapis.com/fcm/send/bad-key-' || v_suffix,'bad-key',repeat('B',22),'phase 1 test'
    );
    RAISE EXCEPTION USING ERRCODE='ZX803', MESSAGE='Malformed key was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Push subscription keys are invalid' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.register_serving_push_subscription(
      'https://fcm.googleapis.com/fcm/send/bad-agent-' || v_suffix,repeat('A',87),repeat('B',22),repeat('x',513)
    );
    RAISE EXCEPTION USING ERRCODE='ZX804', MESSAGE='Oversized user agent was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'Push user agent is invalid or too long' THEN RAISE; END IF;
  END;

  -- Restore the valid test endpoint after the FOREACH loop reused this variable.
  v_endpoint := 'https://fcm.googleapis.com/fcm/send/phase1-' || v_suffix;

  PERFORM set_config('request.jwt.claim.sub', v_user_2::text, true);
  BEGIN
    PERFORM public.register_serving_push_subscription(v_endpoint,repeat('C',87),repeat('D',22),'phase 1 test');
    RAISE EXCEPTION USING ERRCODE='ZX805', MESSAGE='Cross-account endpoint takeover succeeded';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'Push endpoint is already registered to another account%' THEN RAISE; END IF;
  END;
  SELECT user_id INTO v_owner FROM public.serving_push_subscriptions WHERE id=v_id;
  IF v_owner IS DISTINCT FROM v_user_1 THEN RAISE EXCEPTION 'Rejected takeover changed endpoint owner'; END IF;

  v_again := public.register_serving_push_subscription(v_endpoint,repeat('A',87),repeat('B',22),'phase 1 test');
  IF v_again IS DISTINCT FROM v_id THEN RAISE EXCEPTION 'Shared-device transfer changed subscription identity'; END IF;
  SELECT user_id INTO v_owner FROM public.serving_push_subscriptions WHERE id=v_id;
  IF v_owner IS DISTINCT FROM v_user_2 THEN RAISE EXCEPTION 'Proven shared-device transfer did not update owner'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user_1::text, true);
  FOR i IN 1..10 LOOP
    PERFORM public.register_serving_push_subscription(
      'https://fcm.googleapis.com/fcm/send/phase1-cap-' || v_suffix || '-' || i::text,
      repeat('A',87),repeat('B',22),'phase 1 test'
    );
  END LOOP;
  SELECT count(*)::integer INTO v_count FROM public.serving_push_subscriptions WHERE user_id=v_user_1;
  IF v_count <> 10 THEN RAISE EXCEPTION 'Expected 10 devices, found %',v_count; END IF;
  BEGIN
    PERFORM public.register_serving_push_subscription(
      'https://fcm.googleapis.com/fcm/send/phase1-cap-overflow-' || v_suffix,
      repeat('A',87),repeat('B',22),'phase 1 test'
    );
    RAISE EXCEPTION USING ERRCODE='ZX806', MESSAGE='Eleventh device was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'This account already has ten registered devices%' THEN RAISE; END IF;
  END;
END;
$push_registration_security$;
ROLLBACK;
