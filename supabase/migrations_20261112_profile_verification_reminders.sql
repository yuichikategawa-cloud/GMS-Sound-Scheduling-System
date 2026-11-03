-- GMS profile verification reminders.
-- Sends in-app notifications (which are also queued for Web Push) 3 days before,
-- 1 day before, and on the 90-day profile verification due date.
-- Jakarta calendar dates are used consistently with the rest of GMS.

create or replace function public.gms_generate_daily_serving_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  deadline_date date;
  profile_due_date date;
  days_left integer;
  total integer := 0;
  jakarta_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  -- D-1 serving confirmation reminders.
  for a in
    select x.id assignment_id, x.servant_id, v.auth_user_id,
           s.id schedule_id, s.service_name, s.service_date,
           s.start_time, s.end_time, l.name location_name
    from public.assignments x
    join public.servants v on v.id = x.servant_id
    join public.schedules s on s.id = x.schedule_id
    join public.locations l on l.id = s.location_id
    where v.auth_user_id is not null
      and x.confirmation_status = 'pending'
      and s.status = 'published'
      and s.service_date = jakarta_today + 1
  loop
    perform public.gms_emit_serving_notification(
      a.auth_user_id,
      'Serving confirmation reminder',
      'Please confirm tomorrow’s ' || a.service_name || ' at ' || a.location_name ||
        ' (' || left(a.start_time::text,5) || '–' || left(a.end_time::text,5) || ').',
      'confirmation_reminder',
      'confirmation-reminder:' || a.assignment_id || ':' || a.service_date,
      a.schedule_id,
      null
    );
    total := total + 1;
  end loop;

  -- Member profile verification: due 90 days after last verification.
  -- Notify at D-3, D-1 and D-0. event_key makes each reminder idempotent.
  for a in
    select mp.user_id, mp.full_name,
           ((mp.last_verified_at at time zone 'Asia/Jakarta')::date + 90) as due_date
    from public.member_profiles mp
    join public.servants v on v.auth_user_id = mp.user_id and v.active = true
    where v.auth_user_id is not null
  loop
    profile_due_date := a.due_date;
    days_left := profile_due_date - jakarta_today;
    if days_left in (3, 1, 0) then
      perform public.gms_emit_serving_notification(
        a.user_id,
        case
          when days_left = 0 then 'Profile verification due today'
          when days_left = 1 then 'Profile verification due tomorrow'
          else 'Profile verification reminder'
        end,
        case
          when days_left = 0 then 'Your member information verification is due today. Please review and update your information.'
          when days_left = 1 then 'Your member information verification is due tomorrow. Please review and update your information.'
          else 'Your member information verification is due in 3 days. Please review and update your information.'
        end,
        'profile_verification_reminder',
        'profile-verification:' || a.user_id || ':' || profile_due_date || ':' || days_left,
        null,
        null
      );
      total := total + 1;
    end if;
  end loop;

  -- Existing availability deadline reminders: D-3, D-1 and D-0.
  select value::date
    into deadline_date
  from public.system_settings
  where key = 'availability_deadline'
    and value ~ '^\d{4}-\d{2}-\d{2}$';

  if deadline_date is not null then
    days_left := deadline_date - jakarta_today;
    if days_left in (3, 1, 0) then
      for a in
        select id, auth_user_id
        from public.servants
        where active = true and auth_user_id is not null
      loop
        perform public.gms_emit_serving_notification(
          a.auth_user_id,
          'Availability deadline reminder',
          case
            when days_left = 0 then 'Today is the availability submission deadline. Please update your availability if needed.'
            when days_left = 1 then 'The availability submission deadline is tomorrow. Please update your availability if needed.'
            else 'The availability submission deadline is in 3 days. Please update your availability if needed.'
          end,
          'availability_deadline',
          'availability-deadline:' || deadline_date || ':' || days_left || ':' || a.id,
          null,
          null
        );
        total := total + 1;
      end loop;
    end if;
  end if;

  -- Align scheduled cleanup with the configured 30-day notification retention.
  delete from public.serving_notifications
  where created_at < now() - interval '30 days';

  delete from public.serving_push_queue
  where processed_at is not null
    and processed_at < now() - interval '30 days';

  return total;
end;
$$;

revoke all on function public.gms_generate_daily_serving_reminders() from public;
revoke all on function public.gms_generate_daily_serving_reminders() from anon, authenticated;

-- Ensure the existing daily job is present. The 01:00 UTC schedule is 08:00 WIB.
create extension if not exists pg_cron;
do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'gms-daily-serving-reminders'
  ) then
    perform cron.schedule(
      'gms-daily-serving-reminders',
      '0 1 * * *',
      'select public.gms_generate_daily_serving_reminders();'
    );
  end if;
end
$$;

comment on function public.gms_generate_daily_serving_reminders() is
  'Daily Jakarta-time reminders for D-1 assignments, availability deadlines, and member profile verification at D-3/D-1/D-0. Notifications are idempotent through event_key.';
