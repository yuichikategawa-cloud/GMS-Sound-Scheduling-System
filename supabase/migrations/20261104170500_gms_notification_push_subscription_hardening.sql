-- Harden the two authenticated notification entry points reviewed in
-- supabase/SECURITY_HARDENING.md.
--
-- 1. Make assignment-confirmation notifications idempotent per audited
--    transition from a non-confirmed state to confirmed.
-- 2. Restrict push subscription registration to authenticated users, known
--    HTTPS push-service origins, valid browser key encodings, bounded inputs,
--    and ten devices per account. Cross-account transfer is allowed only when
--    the caller proves possession of the exact existing subscription key pair.

CREATE OR REPLACE FUNCTION public.notify_admin_assignment_confirmation(
  p_assignment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_assignment public.assignments%rowtype;
  v_servant_user_id uuid;
  v_servant_name text;
  v_service_name text;
  v_service_date date;
  v_confirmation_event_at timestamptz;
  v_confirmation_transition_count bigint;
  v_event_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
    INTO v_assignment
  FROM public.assignments
  WHERE id = p_assignment_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  SELECT v.auth_user_id, v.full_name, s.service_name, s.service_date
    INTO v_servant_user_id, v_servant_name, v_service_name, v_service_date
  FROM public.servants v
  JOIN public.schedules s ON s.id = v_assignment.schedule_id
  WHERE v.id = v_assignment.servant_id;

  IF NOT FOUND OR v_servant_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only notify administrators about your own assignment';
  END IF;

  IF v_assignment.confirmation_status IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'Assignment is not confirmed';
  END IF;

  -- The assignments audit trigger records each status transition in the same
  -- transaction as the UPDATE. Concurrent/repeated RPC calls therefore derive
  -- the same event token for one confirmation cycle, while a later
  -- pending/declined -> confirmed cycle gets a new audit timestamp/count.
  SELECT max(l.created_at), count(*)
    INTO v_confirmation_event_at, v_confirmation_transition_count
  FROM public.audit_logs l
  WHERE l.table_name = 'assignments'
    AND l.record_id = v_assignment.id::text
    AND l.action = 'UPDATE'
    AND l.old_data->>'confirmation_status' IS DISTINCT FROM 'confirmed'
    AND l.new_data->>'confirmation_status' = 'confirmed';

  IF v_confirmation_event_at IS NULL THEN
    -- Safe fallback for a pre-existing assignment confirmed before audit
    -- transition rows were available. It remains stable for repeated calls.
    v_confirmation_event_at := v_assignment.created_at;
    v_confirmation_transition_count := 1;
  END IF;

  v_event_token :=
    pg_catalog.to_char(
      v_confirmation_event_at AT TIME ZONE 'UTC',
      'YYYYMMDDHH24MISSUS'
    )
    || ':' || GREATEST(v_confirmation_transition_count, 1)::text;

  INSERT INTO public.serving_notifications (
    recipient_user_id,
    title,
    body,
    notification_type,
    schedule_id,
    event_key
  )
  SELECT
    p.id,
    'Servant confirmed assignment',
    v_servant_name || ' confirmed ' || v_service_name || ' at ' || v_service_date || '.',
    'assignment_confirmed',
    v_assignment.schedule_id,
    'assignment-confirmation:' || v_assignment.id::text
      || ':' || v_event_token || ':' || p.id::text
  FROM public.profiles p
  WHERE p.role = 'admin'
  ON CONFLICT DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_admin_assignment_confirmation(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.notify_admin_assignment_confirmation(uuid)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.register_serving_push_subscription(
  p_endpoint text,
  pp256dh text,
  pauth text,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing_id uuid;
  v_existing_user_id uuid;
  v_existing_p256dh text;
  v_existing_auth text;
  v_has_existing boolean := false;
  v_user_subscription_count integer;
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.role IN ('admin', 'servant')
  ) THEN
    RAISE EXCEPTION 'A GMS member account is required';
  END IF;

  -- Keep this allowlist aligned with dispatch-push/security.ts. Endpoint URLs
  -- are later used for outbound requests by the web-push worker, so arbitrary
  -- hosts, IP literals, local addresses and non-HTTPS schemes are rejected.
  IF p_endpoint IS NULL
     OR pg_catalog.char_length(p_endpoint) < 40
     OR pg_catalog.char_length(p_endpoint) > 2048
     OR p_endpoint !~* '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9]([a-z0-9-]*[a-z0-9])?\.notify\.windows\.com)(:443)?/[^[:space:]#]+$'
  THEN
    RAISE EXCEPTION 'Push endpoint URL is not supported';
  END IF;

  -- A browser P-256 public key is 65 bytes (87 base64url characters,
  -- optionally followed by one padding character); auth is 16 bytes.
  IF pp256dh IS NULL
     OR pp256dh !~ '^[A-Za-z0-9_-]{87}=?$'
     OR pauth IS NULL
     OR pauth !~ '^[A-Za-z0-9_-]{22}(==)?$'
  THEN
    RAISE EXCEPTION 'Push subscription keys are invalid';
  END IF;

  IF p_user_agent IS NOT NULL
     AND (
       pg_catalog.char_length(p_user_agent) > 512
       OR p_user_agent ~ '[[:cntrl:]]'
     )
  THEN
    RAISE EXCEPTION 'Push user agent is invalid or too long';
  END IF;

  -- Serialize attempts to claim the same endpoint, then serialize per-user
  -- device-cap checks. All callers take locks in this order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gms.push.endpoint:' || p_endpoint, 0)
  );

  SELECT id, user_id, p256dh, auth
    INTO v_existing_id, v_existing_user_id, v_existing_p256dh, v_existing_auth
  FROM public.serving_push_subscriptions
  WHERE endpoint = p_endpoint
  FOR UPDATE;
  v_has_existing := FOUND;

  IF v_has_existing AND v_existing_user_id <> v_user_id THEN
    -- A shared-device account switch is allowed only when the caller has the
    -- same browser subscription key pair already stored for this endpoint.
    -- Knowing an endpoint URL alone must not let another account evict it.
    IF v_existing_p256dh IS DISTINCT FROM pp256dh
       OR v_existing_auth IS DISTINCT FROM pauth
    THEN
      RAISE EXCEPTION
        'Push endpoint is already registered to another account. Sign out of that account on this device before switching.';
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gms.push.user:' || v_user_id::text, 0)
  );

  IF NOT v_has_existing OR v_existing_user_id <> v_user_id THEN
    SELECT count(*)::integer
      INTO v_user_subscription_count
    FROM public.serving_push_subscriptions
    WHERE user_id = v_user_id;

    IF v_user_subscription_count >= 10 THEN
      RAISE EXCEPTION
        'This account already has ten registered devices. Remove an unused device before enabling push here.';
    END IF;
  END IF;

  IF v_has_existing THEN
    UPDATE public.serving_push_subscriptions
       SET user_id = v_user_id,
           p256dh = pp256dh,
           auth = pauth,
           user_agent = NULLIF(pg_catalog.btrim(p_user_agent), ''),
           updated_at = pg_catalog.now(),
           last_used_at = pg_catalog.now()
     WHERE id = v_existing_id
     RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.serving_push_subscriptions (
      user_id, endpoint, p256dh, auth, user_agent, updated_at, last_used_at
    )
    VALUES (
      v_user_id,
      p_endpoint,
      pp256dh,
      pauth,
      NULLIF(pg_catalog.btrim(p_user_agent), ''),
      pg_catalog.now(),
      pg_catalog.now()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_serving_push_subscription(text, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.register_serving_push_subscription(text, text, text, text)
  TO authenticated;
