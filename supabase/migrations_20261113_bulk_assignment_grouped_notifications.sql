-- GMS Scheduling Intelligence 2.0
-- Bulk/manual assignment RPCs and one grouped Inbox + push notification per recipient per action.
-- Run after migrations 20261102 through 20261112.

create or replace function public.gms_notify_assignment_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare sc public.schedules%rowtype; old_user uuid; new_user uuid; servant_name text;
begin
  if current_setting('gms.suppress_assignment_notifications',true)='on' then return new; end if;
  select * into sc from public.schedules where id=new.schedule_id;
  if not found or sc.status<>'published' then return new; end if;
  select auth_user_id,full_name into new_user,servant_name from public.servants where id=new.servant_id;
  if tg_op='UPDATE' and old.servant_id is distinct from new.servant_id then
    select auth_user_id into old_user from public.servants where id=old.servant_id;
    perform public.gms_emit_serving_notification(old_user,'Serving assignment changed',
      'Your assignment for '||sc.service_name||' on '||sc.service_date||' has changed. Please review your updated schedule.',
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

create or replace function public.gms_notify_schedule_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare a record; v_title text; v_body text; v_type text; v_key text;
begin
  if current_setting('gms.suppress_assignment_notifications',true)='on' then return new; end if;
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
  for a in select distinct v.auth_user_id from public.assignments x join public.servants v on v.id=x.servant_id where x.schedule_id=new.id and v.auth_user_id is not null loop
    perform public.gms_emit_serving_notification(a.auth_user_id,v_title,v_body,v_type,v_key||':'||a.auth_user_id::text,new.id,null);
  end loop;
  return new;
end;
$$;

-- Admin publishes/unpublishes one or many slots atomically and emits one grouped notification per affected account.
create or replace function public.admin_publish_schedules_grouped(
  p_location_id uuid default null,
  p_schedule_ids uuid[] default null,
  p_status text default 'published'
) returns integer
language plpgsql security definer set search_path=public as $$
declare v_changed integer; v_user record; v_count integer; v_title text; v_body text; v_type text;
begin
  if not public.is_admin() then raise exception 'Only administrators can publish schedules'; end if;
  if p_status not in ('published','draft') then raise exception 'Invalid schedule status'; end if;
  if p_location_id is null and coalesce(cardinality(p_schedule_ids),0)=0 then raise exception 'Choose a church or at least one service'; end if;

  create temporary table if not exists gms_publish_changed(schedule_id uuid primary key) on commit drop;
  truncate table pg_temp.gms_publish_changed;
  perform set_config('gms.suppress_assignment_notifications','on',true);
  with changed as (
    update public.schedules s set status=p_status
    where s.status is distinct from p_status
      and (p_location_id is null or s.location_id=p_location_id)
      and (p_schedule_ids is null or s.id=any(p_schedule_ids))
    returning s.id
  ) insert into pg_temp.gms_publish_changed(schedule_id) select id from changed;
  select count(*) into v_changed from pg_temp.gms_publish_changed;

  if v_changed=0 then return 0; end if;
  v_title:=case when p_status='published' then 'Serving schedule published' else 'Serving schedule unpublished' end;
  v_type:=case when p_status='published' then 'new_assignment' else 'schedule_unpublished' end;
  for v_user in
    select v.auth_user_id,count(distinct s.id)::integer as service_count
    from public.schedules s
    join public.assignments a on a.schedule_id=s.id
    join public.servants v on v.id=a.servant_id
    where v.auth_user_id is not null
      and s.id in (select schedule_id from pg_temp.gms_publish_changed)
    group by v.auth_user_id
  loop
    v_body:=case when p_status='published'
      then 'Your serving schedule has been published with '||v_user.service_count||' service assignment(s). Open GMS to review all dates, locations and roles.'
      else 'Your published schedule has been updated. '||v_user.service_count||' service assignment(s) are now drafts. Open GMS to review.'
    end;
    perform public.gms_emit_serving_notification(v_user.auth_user_id,v_title,v_body,v_type,
      'grouped-publish:'||txid_current()||':'||v_user.auth_user_id::text,null,null);
  end loop;
  return v_changed;
end;
$$;
revoke all on function public.admin_publish_schedules_grouped(uuid,uuid[],text) from public;
grant execute on function public.admin_publish_schedules_grouped(uuid,uuid[],text) to authenticated;

-- Apply a reviewed matrix of assignments in one transaction. Null servant_id clears that role.
-- Existing assignment eligibility/cross-location triggers remain active for every insert/update.
create or replace function public.admin_bulk_assignments_grouped(p_assignments jsonb,p_batch_label text default 'Bulk assignment')
returns integer
language plpgsql security definer set search_path=public as $$
declare item jsonb; v_schedule public.schedules%rowtype; v_servant public.servants%rowtype;
        v_role text; v_servant_id uuid; v_old_servant_id uuid; v_old_user uuid; v_new_user uuid;
        v_rows integer:=0; v_user record; v_service_count integer;
begin
  if not public.is_admin() then raise exception 'Only administrators can bulk assign servants'; end if;
  if jsonb_typeof(p_assignments)<>'array' or jsonb_array_length(p_assignments)=0 then
    raise exception 'Provide at least one assignment row';
  end if;
  if jsonb_array_length(p_assignments)>500 then raise exception 'A single bulk operation is limited to 500 role rows'; end if;

  create temporary table if not exists gms_bulk_recipients(user_id uuid primary key) on commit drop;
  create temporary table if not exists gms_bulk_schedules(schedule_id uuid primary key) on commit drop;
  truncate table pg_temp.gms_bulk_recipients;
  truncate table pg_temp.gms_bulk_schedules;

  perform set_config('gms.suppress_assignment_notifications','on',true);
  for item in select value from jsonb_array_elements(p_assignments)
  loop
    v_role:=item->>'role';
    if v_role not in ('FOH','Monitor','Assistant') then raise exception 'Invalid assignment role: %',v_role; end if;
    v_servant_id:=nullif(item->>'servant_id','')::uuid;
    select * into v_schedule from public.schedules where id=(item->>'schedule_id')::uuid for update;
    if not found then raise exception 'A selected service no longer exists'; end if;
    insert into pg_temp.gms_bulk_schedules(schedule_id) values(v_schedule.id) on conflict do nothing;

    select servant_id into v_old_servant_id from public.assignments where schedule_id=v_schedule.id and role=v_role for update;
    if v_old_servant_id is not null then
      select auth_user_id into v_old_user from public.servants where id=v_old_servant_id;
      if v_old_user is not null and v_schedule.status='published' then insert into pg_temp.gms_bulk_recipients(user_id) values(v_old_user) on conflict do nothing; end if;
    end if;

    if v_servant_id is null then
      delete from public.assignments where schedule_id=v_schedule.id and role=v_role;
    else
      select * into v_servant from public.servants where id=v_servant_id and active=true;
      if not found then raise exception 'A selected servant is inactive or no longer exists'; end if;
      if exists(select 1 from public.servant_availability av where av.servant_id=v_servant_id and av.service_date=v_schedule.service_date and av.status='unavailable') then
        raise exception '% is marked unavailable on %',v_servant.full_name,v_schedule.service_date;
      end if;
      insert into public.assignments(schedule_id,servant_id,role,confirmation_status)
      values(v_schedule.id,v_servant_id,v_role,'pending')
      on conflict(schedule_id,role) do update set servant_id=excluded.servant_id,confirmation_status='pending';
      if v_servant.auth_user_id is not null and v_schedule.status='published' then
        insert into pg_temp.gms_bulk_recipients(user_id) values(v_servant.auth_user_id) on conflict do nothing;
      end if;
    end if;
    v_rows:=v_rows+1;
  end loop;

  for v_user in select user_id from pg_temp.gms_bulk_recipients
  loop
    select count(distinct s.id)::integer into v_service_count
    from public.schedules s join public.assignments a on a.schedule_id=s.id
    join public.servants v on v.id=a.servant_id
    where s.id in (select schedule_id from pg_temp.gms_bulk_schedules) and s.status='published' and v.auth_user_id=v_user.user_id;
    perform public.gms_emit_serving_notification(v_user.user_id,'Serving assignments updated',
      'Your serving assignments were updated across the selected services. '||coalesce(v_service_count,0)||' service(s) currently include you. Open GMS to review your roles and confirm.',
      'assignment_changed','grouped-bulk-assignment:'||txid_current()||':'||v_user.user_id::text,null,null);
  end loop;
  return v_rows;
end;
$$;
revoke all on function public.admin_bulk_assignments_grouped(jsonb,text) from public;
grant execute on function public.admin_bulk_assignments_grouped(jsonb,text) to authenticated;

comment on function public.admin_bulk_assignments_grouped(jsonb,text) is
'Admin-only transactional bulk assignment editor. Preserves assignment validation triggers and emits one grouped notification per affected account.';


-- Per-account push preferences. Inbox history is always retained; these flags affect push delivery only.
create table if not exists public.serving_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  new_assignments boolean not null default true,
  schedule_changes boolean not null default true,
  confirmation_reminders boolean not null default true,
  availability_deadlines boolean not null default true,
  request_updates boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.serving_notification_preferences enable row level security;
drop policy if exists "users manage own notification preferences" on public.serving_notification_preferences;
create policy "users manage own notification preferences" on public.serving_notification_preferences
  for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
grant select,insert,update,delete on public.serving_notification_preferences to authenticated;
grant select on public.serving_notification_preferences to service_role;
