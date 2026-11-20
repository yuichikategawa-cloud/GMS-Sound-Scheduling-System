-- Align retention and push dispatch polling across Supabase environments.
-- In-app notifications are retained for 30 days; audit logs are retained for 14 days.
-- The push poller is matched by its Edge Function command, not a project-specific job ID.

BEGIN;

CREATE OR REPLACE FUNCTION public.cleanup_gms_notification_audit_retention()
RETURNS TABLE(notifications_deleted bigint, audit_logs_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_notifications_deleted bigint := 0;
  v_audit_logs_deleted bigint := 0;
BEGIN
  IF to_regclass('public.serving_push_queue') IS NOT NULL THEN
    EXECUTE $q$
      DELETE FROM public.serving_push_queue q
      USING public.serving_notifications n
      WHERE q.notification_id = n.id
        AND n.created_at < now() - interval '30 days'
    $q$;
    EXECUTE $q$
      DELETE FROM public.serving_push_queue
      WHERE created_at < now() - interval '30 days'
    $q$;
  END IF;

  DELETE FROM public.serving_notifications
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

  DELETE FROM public.audit_logs
  WHERE created_at < now() - interval '14 days';
  GET DIAGNOSTICS v_audit_logs_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_notifications_deleted, v_audit_logs_deleted;
END;
$function$;

COMMENT ON TABLE public.serving_notifications IS
  'Primary in-app notification history; retained for 30 days. Push is an optional secondary channel.';

COMMENT ON FUNCTION public.cleanup_gms_notification_audit_retention() IS
  'Daily cleanup: retains in-app notifications for 30 days and audit logs for 14 days; removes pending push queue rows before their parent notifications.';

DO $migration$
DECLARE
  v_job_id bigint;
  v_job_count integer;
BEGIN
  SELECT count(*), min(jobid)
    INTO v_job_count, v_job_id
  FROM cron.job
  WHERE active
    AND command ILIKE '%/functions/v1/dispatch-push%';

  IF v_job_count <> 1 OR v_job_id IS NULL THEN
    RAISE EXCEPTION
      'Expected exactly one active GMS dispatch-push cron job, found %',
      v_job_count;
  END IF;

  PERFORM cron.alter_job(v_job_id, schedule => '30 seconds');
END;
$migration$;

COMMIT;
