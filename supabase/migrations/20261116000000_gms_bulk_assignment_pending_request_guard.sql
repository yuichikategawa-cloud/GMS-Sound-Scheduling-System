-- Prevent bulk assignment edits from orphaning pending replacement/swap requests.
-- Run after migrations_20261115_bulk_assignment_commit_fix.sql.
--
-- The editor RPC already blocks schedule edits while a replacement or swap request
-- is pending. Keep the bulk editor on the same integrity boundary. Affected schedule
-- rows are locked in stable order before checking requests, matching the request
-- insert trigger's source/target schedule lock order.

create or replace function public.admin_bulk_assignments_grouped(
  p_assignments jsonb,
  p_batch_label text default 'Bulk assignment'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  v_schedule_count integer := 0;
  v_rows_changed integer := 0;
  v_user record;
  v_service_count integer;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can bulk assign servants';
  end if;

  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignment changes must be supplied as an array';
  end if;

  v_total := jsonb_array_length(p_assignments);
  if v_total = 0 then
    raise exception 'Select at least one service and review its assignment changes';
  end if;
  if v_total > 500 then
    raise exception 'A single bulk operation is limited to 500 role rows';
  end if;

  -- Temporary staging tables are transaction-scoped and contain no persistent data.
  create temporary table if not exists gms_bulk_stage (
    schedule_id uuid not null,
    role text not null,
    servant_id uuid,
    primary key (schedule_id, role)
  ) on commit drop;

  create temporary table if not exists gms_bulk_changes (
    schedule_id uuid not null,
    role text not null,
    old_servant_id uuid,
    new_servant_id uuid,
    service_date date not null,
    location_id uuid not null,
    service_name text not null,
    schedule_status text not null,
    primary key (schedule_id, role)
  ) on commit drop;

  create temporary table if not exists gms_bulk_recipients (
    user_id uuid primary key
  ) on commit drop;

  truncate table pg_temp.gms_bulk_stage;
  truncate table pg_temp.gms_bulk_changes;
  truncate table pg_temp.gms_bulk_recipients;

  insert into pg_temp.gms_bulk_stage(schedule_id, role, servant_id)
  select
    nullif(entry->>'schedule_id', '')::uuid,
    entry->>'role',
    nullif(entry->>'servant_id', '')::uuid
  from jsonb_array_elements(p_assignments) as expanded(entry);

  if exists (
    select 1 from pg_temp.gms_bulk_stage
    where schedule_id is null or role not in ('FOH', 'Monitor', 'Assistant')
  ) then
    raise exception 'A bulk assignment row has an invalid service or role';
  end if;

  -- Lock every affected schedule before checking requests or comparing assignments.
  select count(distinct s.id)
    into v_schedule_count
    from public.schedules s
   where s.id in (select distinct schedule_id from pg_temp.gms_bulk_stage);

  if v_schedule_count <> (select count(distinct schedule_id) from pg_temp.gms_bulk_stage) then
    raise exception 'One or more selected services no longer exist. Refresh the page and try again';
  end if;

  perform s.id
    from public.schedules s
   where s.id in (select distinct schedule_id from pg_temp.gms_bulk_stage)
   order by s.id
   for update;

  -- The schedule locks serialize this check with request creation, whose BEFORE
  -- INSERT trigger locks both source and target schedules before validating them.
  -- Check both ends of a swap: changing either service would invalidate the request.
  if exists (
    select 1
      from public.serving_requests r
     where r.status = 'pending'
       and (
         r.schedule_id in (select distinct schedule_id from pg_temp.gms_bulk_stage)
         or r.target_schedule_id in (select distinct schedule_id from pg_temp.gms_bulk_stage)
       )
  ) then
    raise exception 'Resolve pending replacement or swap requests for this service before editing it.';
  end if;

  -- A servant may occupy only one role in a particular service.
  if exists (
    select schedule_id, servant_id
      from pg_temp.gms_bulk_stage
     where servant_id is not null
     group by schedule_id, servant_id
    having count(*) > 1
  ) then
    raise exception 'The same servant is selected for more than one role in a service';
  end if;

  -- Validate all chosen servants before changing anything.
  if exists (
    select 1
      from pg_temp.gms_bulk_stage st
      left join public.servants v on v.id = st.servant_id
     where st.servant_id is not null
       and (v.id is null or v.active is distinct from true)
  ) then
    raise exception 'A selected servant is inactive or no longer exists';
  end if;

  if exists (
    select 1
      from pg_temp.gms_bulk_stage st
      join public.schedules sc on sc.id = st.schedule_id
      join public.servant_availability av
        on av.servant_id = st.servant_id
       and av.service_date = sc.service_date
       and av.status = 'unavailable'
     where st.servant_id is not null
  ) then
    raise exception 'A selected servant is marked unavailable on the service date';
  end if;

  -- Capture only slots whose value is actually changing. Unchanged roles retain their
  -- confirmation state and do not create redundant audit or notification activity.
  insert into pg_temp.gms_bulk_changes(
    schedule_id, role, old_servant_id, new_servant_id,
    service_date, location_id, service_name, schedule_status
  )
  select
    st.schedule_id,
    st.role,
    a.servant_id,
    st.servant_id,
    sc.service_date,
    sc.location_id,
    sc.service_name,
    sc.status
  from pg_temp.gms_bulk_stage st
  join public.schedules sc on sc.id = st.schedule_id
  left join public.assignments a
    on a.schedule_id = st.schedule_id
   and a.role = st.role
  where a.servant_id is distinct from st.servant_id;

  get diagnostics v_rows_changed = row_count;
  if v_rows_changed = 0 then
    return 0;
  end if;

  -- Prevent a new servant from colliding with an unchanged role in the same service.
  -- Changed roles are temporarily removed below, so moving a servant between roles in
  -- the same batch is supported.
  if exists (
    select 1
      from pg_temp.gms_bulk_changes c
      join public.assignments existing
        on existing.schedule_id = c.schedule_id
       and existing.servant_id = c.new_servant_id
     where c.new_servant_id is not null
       and not exists (
         select 1
           from pg_temp.gms_bulk_changes changed_slot
          where changed_slot.schedule_id = existing.schedule_id
            and changed_slot.role = existing.role
       )
  ) then
    raise exception 'A selected servant is already assigned to another unchanged role in the same service';
  end if;

  -- Collect notification recipients from both sides of every changed published slot.
  -- The notification is sent once per account after all rows have been applied.
  insert into pg_temp.gms_bulk_recipients(user_id)
  select distinct v.auth_user_id
    from pg_temp.gms_bulk_changes c
    join public.servants v on v.id = c.old_servant_id
   where c.schedule_status = 'published'
     and v.auth_user_id is not null
  union
  select distinct v.auth_user_id
    from pg_temp.gms_bulk_changes c
    join public.servants v on v.id = c.new_servant_id
   where c.schedule_status = 'published'
     and v.auth_user_id is not null
  on conflict (user_id) do nothing;

  -- Suppress row-level notification triggers so the final grouped notice is the only
  -- push/in-app notice generated by this bulk assignment operation.
  perform set_config('gms.suppress_assignment_notifications', 'on', true);

  -- Remove all changed role slots first. This allows valid role swaps/moves within the
  -- same service without tripping unique(schedule_id, servant_id) mid-operation.
  delete from public.assignments a
   using pg_temp.gms_bulk_changes c
   where a.schedule_id = c.schedule_id
     and a.role = c.role;

  -- Insert the requested final state. Existing database triggers still enforce
  -- eligibility, same-day cross-church conflicts and overlapping service rules.
  insert into public.assignments(schedule_id, servant_id, role, confirmation_status)
  select c.schedule_id, c.new_servant_id, c.role, 'pending'
    from pg_temp.gms_bulk_changes c
   where c.new_servant_id is not null
   order by c.service_date, c.location_id, c.schedule_id, c.role;

  -- Emit one consolidated notification per affected account, even if that account had
  -- several role changes across several selected services.
  for v_user in
    select user_id from pg_temp.gms_bulk_recipients
  loop
    select count(distinct s.id)::integer
      into v_service_count
      from public.schedules s
      join public.assignments a on a.schedule_id = s.id
      join public.servants v on v.id = a.servant_id
     where s.id in (select distinct schedule_id from pg_temp.gms_bulk_changes)
       and s.status = 'published'
       and v.auth_user_id = v_user.user_id;

    perform public.gms_emit_serving_notification(
      v_user.user_id,
      'Serving assignments updated',
      'Your serving assignments were updated across the selected services. '
        || coalesce(v_service_count, 0)
        || ' service(s) currently include you. Open GMS to review your roles and confirm.',
      'assignment_changed',
      'grouped-bulk-assignment:' || txid_current() || ':' || v_user.user_id::text,
      null,
      null
    );
  end loop;

  return v_rows_changed;
end;
$$;

revoke all on function public.admin_bulk_assignments_grouped(jsonb, text) from public;
grant execute on function public.admin_bulk_assignments_grouped(jsonb, text) to authenticated;

comment on function public.admin_bulk_assignments_grouped(jsonb, text) is
'Admin-only transactional bulk assignment commit. Stages final role values, clears changed slots before re-inserting, preserves unchanged confirmations, blocks edits to services with pending replacement or swap requests, keeps database eligibility triggers active and emits one grouped notification per affected account.';
