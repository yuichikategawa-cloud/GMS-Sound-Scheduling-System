-- Keep the SQL registration allowlist aligned with
-- supabase/functions/dispatch-push/security.ts.
--
-- Apple documents Web Push URLs on any subdomain of push.apple.com.
-- Permit one or more valid DNS labels before that suffix, while rejecting
-- the bare suffix and lookalike domains such as push.apple.com.attacker.test.

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

  -- Endpoints are later used for outbound requests by the web-push worker.
  -- Keep this host allowlist synchronized with the Edge Function validator.
  IF p_endpoint IS NULL
     OR pg_catalog.char_length(p_endpoint) < 40
     OR pg_catalog.char_length(p_endpoint) > 2048
     OR p_endpoint ~ '[[:cntrl:]]'
     OR p_endpoint !~* '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+push\.apple\.com|[a-z0-9]([a-z0-9-]*[a-z0-9])?\.notify\.windows\.com)(:443)?/[^[:space:]#]+$'
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
