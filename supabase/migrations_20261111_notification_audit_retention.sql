-- GMS retention policy:
--   * In-app notification history: retain a maximum of 30 days.
--   * Audit history: visible in the app for 14 days; records aged more than 14 days
--     can be downloaded by an administrator; delete records older than 30 days.
-- Run after migrations that create public.serving_notifications and public.audit_logs.

create extension if not exists pg_cron;

create index if not exists serving_notifications_created_at_idx
  on public.serving_notifications(created_at);

create or replace function public.cleanup_gms_notification_audit_retention()
returns table (notifications_deleted bigint, audit_logs_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notifications_deleted bigint := 0;
  v_audit_logs_deleted bigint := 0;
begin
  -- Remove pending push queue rows before their parent notifications so an
  -- optional FK cannot prevent the 30-day notification cleanup.
  if to_regclass('public.serving_push_queue') is not null then
    execute $q$
      delete from public.serving_push_queue q
      using public.serving_notifications n
      where q.notification_id = n.id
        and n.created_at < now() - interval '30 days'
    $q$;
    execute $q$
      delete from public.serving_push_queue
      where created_at < now() - interval '30 days'
    $q$;
  end if;

  delete from public.serving_notifications
  where created_at < now() - interval '30 days';
  get diagnostics v_notifications_deleted = row_count;

  delete from public.audit_logs
  where created_at < now() - interval '30 days';
  get diagnostics v_audit_logs_deleted = row_count;

  return query select v_notifications_deleted, v_audit_logs_deleted;
end;
$$;

revoke all on function public.cleanup_gms_notification_audit_retention() from public;
revoke all on function public.cleanup_gms_notification_audit_retention() from anon, authenticated;

-- Run daily at 19:00 UTC (02:00 Asia/Jakarta). Export audit records older than 14 days from the Audit log page. When first
-- applied, this migration immediately removes records older than 30 days; export
-- existing older history before running it if you need to preserve that data.
do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'gms-notification-audit-30day-retention';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'gms-notification-audit-30day-retention',
    '0 19 * * *',
    'select * from public.cleanup_gms_notification_audit_retention();'
  );
end;
$$;

-- Apply the retention policy immediately, then continue daily.
select * from public.cleanup_gms_notification_audit_retention();
