-- Keep push queue ownership valid during long sends and preserve checkpoints on retry.

CREATE OR REPLACE FUNCTION public.gms_renew_serving_push_queue_claim(
  p_notification_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer DEFAULT 180
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.serving_push_queue AS q
     SET lease_expires_at = pg_catalog.clock_timestamp()
       + pg_catalog.make_interval(
           secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 180), 30), 180)
         )
   WHERE q.notification_id = p_notification_id
     AND q.claim_token = p_claim_token
     AND q.processed_at IS NULL
     AND q.lease_expires_at > pg_catalog.clock_timestamp();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

-- Endpoint progress is written atomically by PostgreSQL using its own clock.
CREATE OR REPLACE FUNCTION public.gms_checkpoint_serving_push_queue_endpoint(
  p_notification_id uuid,
  p_claim_token uuid,
  p_endpoint text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_endpoint IS NULL OR pg_catalog.length(p_endpoint) = 0 THEN
    RAISE EXCEPTION 'A non-empty push endpoint is required.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.serving_push_queue AS q
     SET delivered_endpoints = CASE
       WHEN p_endpoint = ANY(COALESCE(q.delivered_endpoints, ARRAY[]::text[]))
         THEN COALESCE(q.delivered_endpoints, ARRAY[]::text[])
       ELSE pg_catalog.array_append(
         COALESCE(q.delivered_endpoints, ARRAY[]::text[]),
         p_endpoint
       )
     END
   WHERE q.notification_id = p_notification_id
     AND q.claim_token = p_claim_token
     AND q.processed_at IS NULL
     AND q.lease_expires_at > pg_catalog.clock_timestamp();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

-- Retry/complete updates deliberately do not write delivered_endpoints.
-- This preserves every endpoint checkpoint already committed by this worker.
CREATE OR REPLACE FUNCTION public.gms_release_serving_push_queue_claim(
  p_notification_id uuid,
  p_claim_token uuid,
  p_attempts integer,
  p_retry_delay_seconds integer,
  p_last_error text,
  p_processed boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF NOT p_processed AND p_retry_delay_seconds IS NULL THEN
    RAISE EXCEPTION 'A retry delay is required when releasing a claim for retry.'
      USING ERRCODE = '22004';
  END IF;

  UPDATE public.serving_push_queue AS q
     SET attempts = GREATEST(COALESCE(p_attempts, q.attempts), q.attempts),
         processed_at = CASE
           WHEN p_processed THEN pg_catalog.clock_timestamp()
           ELSE NULL
         END,
         next_attempt_at = CASE
           WHEN p_processed THEN q.next_attempt_at
           ELSE pg_catalog.clock_timestamp()
             + pg_catalog.make_interval(
                 secs => LEAST(GREATEST(p_retry_delay_seconds, 0), 900)
               )
         END,
         last_error = p_last_error,
         claim_token = NULL,
         claimed_at = NULL,
         lease_expires_at = NULL
   WHERE q.notification_id = p_notification_id
     AND q.claim_token = p_claim_token
     AND q.processed_at IS NULL
     AND q.lease_expires_at > pg_catalog.clock_timestamp();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.gms_renew_serving_push_queue_claim(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gms_renew_serving_push_queue_claim(uuid, uuid, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.gms_checkpoint_serving_push_queue_endpoint(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gms_checkpoint_serving_push_queue_endpoint(uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.gms_release_serving_push_queue_claim(uuid, uuid, integer, integer, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gms_release_serving_push_queue_claim(uuid, uuid, integer, integer, text, boolean)
  TO service_role;
