-- GMS Scheduling Intelligence + PWA notification delivery foundation.
-- Run after migrations_20261102 through migrations_20261109.

-- 1) Per-servant serving eligibility rules.
create table if not exists public.servant_serving_preferences (
  id uuid primary key default gen_random_uuid(),
  servant_id uuid not null references public.servants(id) on delete cascade,
  rule_type text not null check (rule_type in ('allowed_time_window','allowed_service_scope')),
  days_of_week smallint[] not null default '{}', -- PostgreSQL DOW: Sunday=0 .. Saturday=6
  start_time time,
  end_time time,
  location_id uuid references public.locations(id) on delete cascade,
  service_names text[] not null default '{}',
  effective_from date,
  effective_until date,
  active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint serving_pref_date_order check (effective_until is null or effective_from is null or effective_until >= effective_from),
  constraint serving_pref_time_rule check (rule_type <> 'allowed_time_window' or (start_time is not null and end_time is not null and end_time > start_time and location_id is null)),
  constraint serving_pref_service_rule check (rule_type <> 'allowed_service_scope' or (location_id is not null and cardinality(service_names) > 0 and start_time is null and end_time is null)),
  constraint serving_pref_weekdays check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[])
);
create index if not exists servant_serving_preferences_active_idx
  on public.servant_serving_preferences(servant_id,rule_type) where active=true;
alter table public.servant_serving_preferences enable row level security;
drop policy if exists "admins and servants read serving preferences" on public.servant_serving_preferences;
create policy "admins and servants read serving preferences" on public.servant_serving_preferences
  for select to authenticated using (public.is_admin() or exists(select 1 from public.servants s where s.id=servant_id and s.auth_user_id=auth.uid()));
drop policy if exists "admins and servants create serving preferences" on public.servant_serving_preferences;
create policy "admins and servants create serving preferences" on public.servant_serving_preferences
  for insert to authenticated with check (public.is_admin() or exists(select 1 from public.servants s where s.id=servant_id and s.auth_user_id=auth.uid()));
drop policy if exists "admins and servants delete serving preferences" on public.servant_serving_preferences;
create policy "admins and servants delete serving preferences" on public.servant_serving_preferences
  for delete to authenticated using (public.is_admin() or exists(select 1 from public.servants s where s.id=servant_id and s.auth_user_id=auth.uid()));

-- Central matcher: each preference dimension is an allow-list. If a servant has one or more
-- rules in a dimension, at least one must match. Time windows and service scopes are combined (AND).
create or replace function public.gms_servant_matches_preferences(
  p_servant_id uuid,p_service_date date,p_location_id uuid,p_service_name text,p_start_time time,p_end_time time
) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare v_count integer; v_dow integer;
begin
  v_dow:=extract(dow from p_service_date)::integer;
  select count(*) into v_count from public.servant_serving_preferences
    where servant_id=p_servant_id and active and rule_type='allowed_time_window'
      and (effective_from is null or effective_from<=p_service_date)
      and (effective_until is null or effective_until>=p_service_date);
  if v_count>0 and not exists(
    select 1 from public.servant_serving_preferences r where r.servant_id=p_servant_id and r.active and r.rule_type='allowed_time_window'
      and (r.effective_from is null or r.effective_from<=p_service_date)
      and (r.effective_until is null or r.effective_until>=p_service_date)
      and (cardinality(r.days_of_week)=0 or v_dow=any(r.days_of_week))
      and p_start_time>=r.start_time and p_end_time<=r.end_time
  ) then return false; end if;

  select count(*) into v_count from public.servant_serving_preferences
    where servant_id=p_servant_id and active and rule_type='allowed_service_scope'
      and (effective_from is null or effective_from<=p_service_date)
      and (effective_until is null or effective_until>=p_service_date);
  if v_count>0 and not exists(
    select 1 from public.servant_serving_preferences r where r.servant_id=p_servant_id and r.active and r.rule_type='allowed_service_scope'
      and (r.effective_from is null or r.effective_from<=p_service_date)
      and (r.effective_until is null or r.effective_until>=p_service_date)
      and r.location_id=p_location_id and p_service_name=any(r.service_names)
  ) then return false; end if;
  return true;
end;
$$;
revoke all on function public.gms_servant_matches_preferences(uuid,date,uuid,text,time,time) from public;

create or replace function public.gms_guard_assignment_preferences()
returns trigger language plpgsql security definer set search_path=public as $$
declare sc public.schedules%rowtype;
begin
  if new.servant_id is null then return new; end if;
  select * into sc from public.schedules where id=new.schedule_id;
  if not found then raise exception 'Schedule not found for assignment'; end if;
  if not public.gms_servant_matches_preferences(new.servant_id,sc.service_date,sc.location_id,sc.service_name,sc.start_time,sc.end_time) then
    raise exception 'Serving eligibility rule: this servant is restricted from this service date, time window, church or service.';
  end if;
  return new;
end;
$$;
drop trigger if exists gms_guard_assignment_preferences_trigger on public.assignments;
create trigger gms_guard_assignment_preferences_trigger before insert or update of servant_id,schedule_id on public.assignments
  for each row execute function public.gms_guard_assignment_preferences();

-- Schedule edits are followed by the app replacing the assignment rows.
-- Do not validate old assignments against newly edited schedule fields here: that would
-- prevent admins from correcting/reassigning a schedule before the new assignments are saved.
-- The BEFORE INSERT/UPDATE assignment trigger above enforces eligibility for every new assignment.
drop trigger if exists gms_guard_schedule_preferences_trigger on public.schedules;
drop function if exists public.gms_guard_schedule_preferences();

-- 2) In-app notifications remain the primary history. Keep recent records bounded and queue optional push delivery.
alter table public.serving_notifications add column if not exists event_key text;
create unique index if not exists serving_notifications_event_key_uidx
  on public.serving_notifications(event_key) where event_key is not null;

create table if not exists public.serving_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index if not exists serving_push_subscriptions_user_idx on public.serving_push_subscriptions(user_id);
alter table public.serving_push_subscriptions enable row level security;
drop policy if exists "users manage own push subscriptions" on public.serving_push_subscriptions;
create policy "users manage own push subscriptions" on public.serving_push_subscriptions
  for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create table if not exists public.serving_push_queue (
  notification_id uuid primary key references public.serving_notifications(id) on delete cascade,
  attempts integer not null default 0,
  delivered_endpoints text[] not null default '{}',
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);
alter table public.serving_push_queue add column if not exists delivered_endpoints text[] not null default '{}';
create index if not exists serving_push_queue_pending_idx on public.serving_push_queue(created_at) where processed_at is null;
alter table public.serving_push_queue enable row level security;
-- No authenticated policies: only the Edge Function service role processes this queue.
grant select, insert, update, delete on public.servant_serving_preferences to authenticated;
grant select, update on public.serving_notifications to authenticated;
grant select, insert, update, delete on public.serving_push_subscriptions to authenticated;
grant select, update, delete on public.serving_push_queue to service_role;
grant select, update, delete on public.serving_push_subscriptions to service_role;
grant select on public.serving_notifications to service_role;

-- A device endpoint belongs to one signed-in account at a time. This SECURITY DEFINER RPC
-- safely transfers the browser's current endpoint when a different GMS account signs in.
create or replace function public.register_serving_push_subscription(
  p_endpoint text, pp256dh text, pauth text, p_user_agent text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_user_id uuid; v_id uuid;
begin
  v_user_id:=auth.uid();
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if coalesce(length(p_endpoint),0)<20 or coalesce(length(pp256dh),0)<10 or coalesce(length(pauth),0)<10 then
    raise exception 'Invalid push subscription';
  end if;
  delete from public.serving_push_subscriptions where endpoint=p_endpoint and user_id<>v_user_id;
  insert into public.serving_push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,updated_at,last_used_at)
  values(v_user_id,p_endpoint,pp256dh,pauth,p_user_agent,now(),now())
  on conflict(endpoint) do update set user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,
    user_agent=excluded.user_agent,updated_at=now(),last_used_at=now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.register_serving_push_subscription(text,text,text,text) from public;
grant execute on function public.register_serving_push_subscription(text,text,text,text) to authenticated;

create or replace function public.gms_queue_push_for_notification()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.serving_push_queue(notification_id) values(new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists gms_queue_push_after_notification_trigger on public.serving_notifications;
create trigger gms_queue_push_after_notification_trigger after insert on public.serving_notifications
  for each row execute function public.gms_queue_push_for_notification();

create or replace function public.gms_emit_serving_notification(
  p_user_id uuid,p_title text,p_body text,p_type text,p_event_key text,p_schedule_id uuid default null,p_request_id uuid default null
) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_user_id is null then return; end if;
  insert into public.serving_notifications(recipient_user_id,title,body,notification_type,schedule_id,request_id,event_key)
  values(p_user_id,p_title,p_body,p_type,p_schedule_id,p_request_id,p_event_key)
  on conflict do nothing;
end;
$$;
revoke all on function public.gms_emit_serving_notification(uuid,text,text,text,text,uuid,uuid) from public;

-- New assignments, publication and schedule edits.
create or replace function public.gms_notify_assignment_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare sc public.schedules%rowtype; old_user uuid; new_user uuid; servant_name text;
begin
  select * into sc from public.schedules where id=new.schedule_id;
  if not found or sc.status<>'published' then return new; end if;
  select auth_user_id,full_name into new_user,servant_name from public.servants where id=new.servant_id;
  if tg_op='UPDATE' and old.servant_id is distinct from new.servant_id then
    select auth_user_id into old_user from public.servants where id=old.servant_id;
    perform public.gms_emit_serving_notification(old_user,'Serving assignment changed',
      'Your assignment for '||sc.service_name||' on '||sc.service_date||' has been changed. Please review the updated schedule.',
      'assignment_changed','assignment-removed:'||new.id||':'||txid_current(),sc.id,null);
  end if;
  if tg_op='INSERT' or (tg_op='UPDATE' and old.servant_id is distinct from new.servant_id) then
    perform public.gms_emit_serving_notification(new_user,'New serving assignment',
      'You have been assigned to '||sc.service_name||' at '||sc.service_date||' ('||left(sc.start_time::text,5)||'–'||left(sc.end_time::text,5)||'). Please review and confirm.',
      'new_assignment','assignment-added:'||new.id||':'||new.servant_id||':'||txid_current(),sc.id,null);
  end if;
  return new;
end;
$$;
drop trigger if exists gms_notify_assignment_change_trigger on public.assignments;
create trigger gms_notify_assignment_change_trigger after insert or update of servant_id on public.assignments
  for each row execute function public.gms_notify_assignment_change();

create or replace function public.gms_notify_schedule_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare a record; v_title text; v_body text; v_type text; v_key text;
begin
  if tg_op='INSERT' then
    if new.status='published' then
      for a in select x.id,x.servant_id,v.auth_user_id from public.assignments x join public.servants v on v.id=x.servant_id where x.schedule_id=new.id loop
        perform public.gms_emit_serving_notification(a.auth_user_id,'New serving assignment',
          'You have been assigned to '||new.service_name||' at '||new.service_date||' ('||left(new.start_time::text,5)||'–'||left(new.end_time::text,5)||'). Please review and confirm.',
          'new_assignment','schedule-published:'||new.id||':'||a.id||':'||txid_current(),new.id,null);
      end loop;
    end if;
    return new;
  end if;
  if old.status<>'published' and new.status='published' then
    v_title:='Schedule published';v_body:='The schedule for '||new.service_name||' at '||new.service_date||' is now published. Please review your assignment.';v_type:='new_assignment';v_key:='schedule-published:'||new.id||':'||txid_current();
  elsif old.status='published' and new.status='draft' then
    v_title:='Schedule unpublished';v_body:='The schedule for '||old.service_name||' at '||old.service_date||' has been moved back to draft and is no longer final.';v_type:='schedule_unpublished';v_key:='schedule-unpublished:'||new.id||':'||txid_current();
  elsif new.status='published' and old.status='published' and
    (old.service_date,old.location_id,old.service_name,old.start_time,old.end_time) is distinct from (new.service_date,new.location_id,new.service_name,new.start_time,new.end_time) then
    v_title:='Schedule changed';v_body:='The published service details changed. Please check the updated date, time, church or service name.';v_type:='schedule_changed';v_key:='schedule-changed:'||new.id||':'||txid_current();
  else return new;
  end if;
  for a in select v.auth_user_id from public.assignments x join public.servants v on v.id=x.servant_id where x.schedule_id=new.id loop
    perform public.gms_emit_serving_notification(a.auth_user_id,v_title,v_body,v_type,v_key||':'||coalesce(a.auth_user_id::text,'unlinked'),new.id,null);
  end loop;
  return new;
end;
$$;
drop trigger if exists gms_notify_schedule_change_trigger on public.schedules;
create trigger gms_notify_schedule_change_trigger after insert or update of status,service_date,location_id,service_name,start_time,end_time on public.schedules
  for each row execute function public.gms_notify_schedule_change();

-- Request created / approved / declined notifications.
create or replace function public.gms_notify_serving_request_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare p record; requester_user uuid; s public.schedules%rowtype;
begin
  select * into s from public.schedules where id=new.schedule_id;
  if tg_op='INSERT' then
    for p in select id from public.profiles where role='admin' loop
      perform public.gms_emit_serving_notification(p.id,'New servant request',
        coalesce((select full_name from public.servants where id=new.requester_servant_id),'A servant')||' submitted a '||new.request_type||' request for '||coalesce(s.service_name,'a service')||' on '||coalesce(s.service_date::text,'an upcoming date')||'.',
        'servant_request','servant-request:'||new.id||':'||p.id,new.schedule_id,new.id);
    end loop;
  elsif old.status='pending' and new.status in ('approved','declined','cancelled') then
    select auth_user_id into requester_user from public.servants where id=new.requester_servant_id;
    perform public.gms_emit_serving_notification(requester_user,'Request '||new.status,
      'Your '||new.request_type||' request for '||coalesce(s.service_name,'a service')||' on '||coalesce(s.service_date::text,'an upcoming date')||' was '||new.status||' by the administrator.',
      'request_decision','request-decision:'||new.id||':'||new.status,new.schedule_id,new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists gms_notify_serving_request_change_trigger on public.serving_requests;
create trigger gms_notify_serving_request_change_trigger after insert or update of status on public.serving_requests
  for each row execute function public.gms_notify_serving_request_change();

-- Recreate replacement resolution without duplicate manual notification inserts;
-- assignment and request triggers create the Inbox and push events consistently.
create or replace function public.admin_resolve_replacement(p_request_id uuid,p_replacement_servant_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare req public.serving_requests%rowtype; a public.assignments%rowtype; s public.schedules%rowtype; old_servant public.servants%rowtype; new_servant public.servants%rowtype;
begin
  if not public.is_admin() then raise exception 'Only administrators can assign a replacement'; end if;
  select * into req from public.serving_requests where id=p_request_id for update;
  if not found or req.status<>'pending' or req.request_type<>'replacement' then raise exception 'Replacement request is no longer pending'; end if;
  select * into a from public.assignments where id=req.assignment_id for update;
  select * into s from public.schedules where id=req.schedule_id for update;
  select * into old_servant from public.servants where id=req.requester_servant_id;
  select * into new_servant from public.servants where id=p_replacement_servant_id and active=true;
  if a.id is null or s.id is null or old_servant.id is null or new_servant.id is null then raise exception 'Schedule, assignment or servant not found'; end if;
  if a.servant_id<>req.requester_servant_id then raise exception 'Original assignment has already changed'; end if;
  if new_servant.id=old_servant.id then raise exception 'Choose a different replacement servant'; end if;
  if exists(select 1 from public.assignments ax where ax.schedule_id=s.id and ax.servant_id=new_servant.id and ax.id<>a.id) then raise exception 'Replacement servant already has another role in this service'; end if;
  if exists(select 1 from public.assignments ax join public.schedules sx on sx.id=ax.schedule_id where ax.servant_id=new_servant.id and sx.service_date=s.service_date and sx.location_id<>s.location_id) then raise exception 'Replacement servant already serves at another church on this date'; end if;
  update public.assignments set servant_id=new_servant.id,confirmation_status='pending' where id=a.id;
  update public.serving_requests set status='approved',replacement_servant_id=new_servant.id,reviewed_by=auth.uid(),reviewed_at=now() where id=req.id;
end;
$$;
revoke all on function public.admin_resolve_replacement(uuid,uuid) from public;
grant execute on function public.admin_resolve_replacement(uuid,uuid) to authenticated;

-- 3) Scheduled reminders and bounded notification history. Inbox retains 180 days of events.
create or replace function public.gms_generate_daily_serving_reminders()
returns integer language plpgsql security definer set search_path=public as $$
declare a record; deadline_date date; days_left integer; total integer:=0; jakarta_today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
  for a in
    select x.id assignment_id,x.servant_id,v.auth_user_id,s.id schedule_id,s.service_name,s.service_date,s.start_time,s.end_time,l.name location_name
    from public.assignments x join public.servants v on v.id=x.servant_id
    join public.schedules s on s.id=x.schedule_id join public.locations l on l.id=s.location_id
    where v.auth_user_id is not null and x.confirmation_status='pending' and s.status='published' and s.service_date=jakarta_today+1
  loop
    perform public.gms_emit_serving_notification(a.auth_user_id,'Serving confirmation reminder',
      'Please confirm tomorrow’s '||a.service_name||' at '||a.location_name||' ('||left(a.start_time::text,5)||'–'||left(a.end_time::text,5)||').',
      'confirmation_reminder','confirmation-reminder:'||a.assignment_id||':'||a.service_date,a.schedule_id,null);
    total:=total+1;
  end loop;

  select value::date into deadline_date from public.system_settings where key='availability_deadline' and value ~ '^\d{4}-\d{2}-\d{2}$';
  if deadline_date is not null then
    days_left:=deadline_date-jakarta_today;
    if days_left in (3,1,0) then
      for a in select id,auth_user_id from public.servants where active=true and auth_user_id is not null loop
        perform public.gms_emit_serving_notification(a.auth_user_id,'Availability deadline reminder',
          case when days_left=0 then 'Today is the availability submission deadline. Please update your availability if needed.' else 'The availability submission deadline is in '||days_left||' day(s). Please update your availability if needed.' end,
          'availability_deadline','availability-deadline:'||deadline_date||':'||days_left||':'||a.id,null,null);
        total:=total+1;
      end loop;
    end if;
  end if;

  delete from public.serving_notifications where created_at < now()-interval '180 days';
  delete from public.serving_push_queue where processed_at is not null and processed_at < now()-interval '30 days';
  return total;
end;
$$;
revoke all on function public.gms_generate_daily_serving_reminders() from public;

create extension if not exists pg_cron;
do $$ begin
  if not exists(select 1 from cron.job where jobname='gms-daily-serving-reminders') then
    perform cron.schedule('gms-daily-serving-reminders','0 1 * * *','select public.gms_generate_daily_serving_reminders();');
  end if;
end $$;

comment on table public.serving_notifications is 'Primary in-app notification history; retained for 180 days. Push is an optional secondary channel.';
comment on table public.serving_push_subscriptions is 'Per-device web push subscriptions, scoped to the signed-in user.';
comment on table public.servant_serving_preferences is 'Hard allow-list rules checked when assigning servants to schedules.';
