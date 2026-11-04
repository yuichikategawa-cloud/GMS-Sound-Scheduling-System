-- Atomic claim and lease support for the push delivery queue.
-- Applied to production as migration 20261104110028.

ALTER TABLE public.serving_push_queue
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS serving_push_queue_claimable_idx
  ON public.serving_push_queue (next_attempt_at, lease_expires_at, created_at)
  WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION public.gms_claim_serving_push_queue(
  p_batch_size integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE (
  notification_id uuid,
  attempts integer,
  delivered_endpoints text[],
  claim_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT q.notification_id
    FROM public.serving_push_queue AS q
    WHERE q.processed_at IS NULL
      AND q.next_attempt_at <= pg_catalog.clock_timestamp()
      AND (
        q.lease_expires_at IS NULL
        OR q.lease_expires_at <= pg_catalog.clock_timestamp()
      )
    ORDER BY q.created_at ASC
    LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 5), 1), 5)
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.serving_push_queue AS q
    SET claim_token = pg_catalog.gen_random_uuid(),
        claimed_at = pg_catalog.clock_timestamp(),
        lease_expires_at = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 180), 30), 180))
    FROM candidates AS c
    WHERE q.notification_id = c.notification_id
    RETURNING q.notification_id, q.attempts, q.delivered_endpoints, q.claim_token
  )
  SELECT c.notification_id, c.attempts, c.delivered_endpoints, c.claim_token
  FROM claimed AS c;
END;
$function$;

REVOKE ALL ON FUNCTION public.gms_claim_serving_push_queue(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gms_claim_serving_push_queue(integer, integer)
  TO service_role;
