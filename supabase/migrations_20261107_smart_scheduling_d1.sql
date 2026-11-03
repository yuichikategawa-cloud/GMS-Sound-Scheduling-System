-- GMS Smart Scheduling + D-1 automatic confirmation
-- Prerequisite: run migrations through 20261106 first.

-- Run once daily at 00:00 Asia/Jakarta (17:00 UTC previous day).
create or replace function public.auto_confirm_d1_assignments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  local_tomorrow date := (timezone('Asia/Jakarta', now())::date + 1);
  affected integer := 0;
begin
  create temporary table if not exists pg_temp.gms_d1_due (
    assignment_id uuid, servant_id uuid, schedule_id uuid, service_date date,
    service_name text, location_name text, role text, full_name text, auth_user_id uuid
  ) on commit drop;
  truncate table pg_temp.gms_d1_due;

  insert into pg_temp.gms_d1_due
  select a.id, a.servant_id, a.schedule_id, s.service_date, s.service_name,
         l.name, a.role, sv.full_name, sv.auth_user_id
  from public.assignments a
  join public.schedules s on s.id=a.schedule_id
  join public.locations l on l.id=s.location_id
  join public.servants sv on sv.id=a.servant_id
  where s.status='published'
    and s.service_date=local_tomorrow
    and coalesce(a.confirmation_status,'pending')='pending';

  update public.assignments a
     set confirmation_status='confirmed'
    from pg_temp.gms_d1_due d
   where a.id=d.assignment_id;
  get diagnostics affected = row_count;

  insert into public.serving_notifications
    (recipient_user_id,title,body,notification_type,schedule_id,is_read)
  select d.auth_user_id,
         'Assignment automatically confirmed',
         'Your '||d.role||' assignment for '||d.service_name||' at '||
         d.location_name||' on '||d.service_date||
         ' was automatically confirmed because the service is tomorrow (D-1).',
         'd1_auto_confirmed',d.schedule_id,false
  from pg_temp.gms_d1_due d
  where d.auth_user_id is not null;

  if affected > 0 then
    insert into public.serving_notifications
      (recipient_user_id,title,body,notification_type,is_read)
    select p.id,'D-1 assignments auto-confirmed',
           affected||' pending assignment(s) for tomorrow were automatically confirmed.',
           'd1_admin_summary',false
    from public.profiles p where p.role='admin';
  end if;
  return affected;
end;
$$;

revoke all on function public.auto_confirm_d1_assignments() from public, anon, authenticated;
grant execute on function public.auto_confirm_d1_assignments() to service_role;

-- Supabase projects with pg_cron enabled can schedule the D-1 job.
do $schedule$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid)
      from cron.job
     where jobname='gms-auto-confirm-d1';
    perform cron.schedule(
      'gms-auto-confirm-d1',
      '0 17 * * *',
      'select public.auto_confirm_d1_assignments();'
    );
  else
    raise notice 'pg_cron is not enabled. Enable it in Supabase Database > Extensions, then rerun this migration to schedule D-1 auto-confirmation.';
  end if;
end;
$schedule$;
