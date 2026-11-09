-- Reduce staging/production push dispatch wait from up to 60 seconds to up to 5 seconds.
-- Only wake the Edge Function when an unprocessed queue row is eligible to be claimed.
-- The dispatcher's atomic claim RPC remains the source of truth for concurrency.

DO $migration$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid
    INTO v_job_id
  FROM cron.job
  WHERE jobname = 'gms-dispatch-web-push';

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION
      'gms-dispatch-web-push Cron job is missing; run supabase/setup_push_dispatch.sql first';
  END IF;

  PERFORM cron.alter_job(
    job_id := v_job_id,
    schedule := '5 seconds',
    command := $job$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'gms_push_project_url'
        ) || '/functions/v1/dispatch-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'gms_push_anon_key'
          ),
          'x-gms-push-secret', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'gms_push_dispatch_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      ) AS request_id
      WHERE EXISTS (
        SELECT 1
        FROM public.serving_push_queue AS q
        WHERE q.processed_at IS NULL
          AND q.next_attempt_at <= pg_catalog.clock_timestamp()
          AND (
            q.lease_expires_at IS NULL
            OR q.lease_expires_at <= pg_catalog.clock_timestamp()
          )
      );
    $job$
  );

  -- Sub-minute jobs create more run-history rows. Keep seven days for diagnosis.
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'gms-cron-history-cleanup'
  ) THEN
    PERFORM cron.schedule(
      'gms-cron-history-cleanup',
      '0 3 * * *',
      $cleanup$
        DELETE FROM cron.job_run_details
        WHERE end_time < pg_catalog.now() - interval '7 days';
      $cleanup$
    );
  END IF;
END;
$migration$;
