-- GMS v5 workflow enhancement migration
-- Run this in Supabase SQL Editor before deploying the matching frontend.

alter table public.serving_requests
  add column if not exists target_schedule_id uuid references public.schedules(id) on delete cascade,
  add column if not exists target_assignment_id uuid references public.assignments(id) on delete cascade,
  add column if not exists target_servant_id uuid references public.servants(id) on delete cascade;

create table if not exists public.serving_request_reads (
  request_id uuid not null references public.serving_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (request_id,user_id)
);
alter table public.serving_request_reads enable row level security;
drop policy if exists "users read own serving request receipts" on public.serving_request_reads;
create policy "users read own serving request receipts" on public.serving_request_reads
  for select to authenticated using (user_id=auth.uid());
drop policy if exists "servants manage own request receipts" on public.serving_request_reads;
create policy "servants manage own request receipts" on public.serving_request_reads
  for all to authenticated using (
    user_id=auth.uid() and exists (
      select 1 from public.serving_requests r
      join public.servants s on s.id=r.requester_servant_id
      where r.id=request_id and s.auth_user_id=auth.uid()
    )
  ) with check (
    user_id=auth.uid() and exists (
      select 1 from public.serving_requests r
      join public.servants s on s.id=r.requester_servant_id
      where r.id=request_id and s.auth_user_id=auth.uid()
    )
  );

-- Atomic, admin-only cross-date swap execution.
create or replace function public.admin_execute_servant_swap(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.serving_requests%rowtype;
  src public.schedules%rowtype;
  dst public.schedules%rowtype;
  src_assignment public.assignments%rowtype;
  dst_assignment public.assignments%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can approve and execute swaps';
  end if;

  select * into req from public.serving_requests where id=p_request_id for update;
  if not found or req.status <> 'pending' or req.request_type <> 'swap' then
    raise exception 'Swap request is unavailable or no longer pending';
  end if;
  if req.target_schedule_id is null or req.target_assignment_id is null then
    raise exception 'Swap request is missing its target assignment';
  end if;

  select * into src from public.schedules where id=req.schedule_id for update;
  select * into dst from public.schedules where id=req.target_schedule_id for update;
  select * into src_assignment from public.assignments where id=req.assignment_id for update;
  select * into dst_assignment from public.assignments where id=req.target_assignment_id for update;

  if src.id is null or dst.id is null or src_assignment.id is null or dst_assignment.id is null then
    raise exception 'One of the selected services or assignments no longer exists';
  end if;
  if src.status <> 'published' or dst.status <> 'published' then
    raise exception 'Both services must still be published';
  end if;
  if src.service_date = dst.service_date then
    raise exception 'Choose a different service date for a cross-date swap';
  end if;
  if src_assignment.servant_id <> req.requester_servant_id then
    raise exception 'The requester is no longer assigned to the original service';
  end if;
  if dst_assignment.servant_id is null or dst_assignment.servant_id = req.requester_servant_id then
    raise exception 'The target assignment is no longer valid';
  end if;

  -- Target servant must not be assigned at another church on the requester's original date.
  if exists (
    select 1 from public.assignments a join public.schedules s on s.id=a.schedule_id
    where a.servant_id=dst_assignment.servant_id
      and s.service_date=src.service_date and s.location_id<>src.location_id
      and s.id not in (src.id,dst.id)
  ) then raise exception 'Target servant already has an assignment at another church on the first date'; end if;

  -- Requester must not be assigned at another church on the target date.
  if exists (
    select 1 from public.assignments a join public.schedules s on s.id=a.schedule_id
    where a.servant_id=src_assignment.servant_id
      and s.service_date=dst.service_date and s.location_id<>dst.location_id
      and s.id not in (src.id,dst.id)
  ) then raise exception 'Requester already has an assignment at another church on the second date'; end if;

  update public.assignments set servant_id=dst_assignment.servant_id, confirmation_status='pending' where id=src_assignment.id;
  update public.assignments set servant_id=src_assignment.servant_id, confirmation_status='pending' where id=dst_assignment.id;
  update public.serving_requests set status='approved', reviewed_by=auth.uid(), reviewed_at=now() where id=req.id;
end;
$$;

revoke all on function public.admin_execute_servant_swap(uuid) from public;
grant execute on function public.admin_execute_servant_swap(uuid) to authenticated;


-- Assignment confirmation and replacement notifications
alter table public.serving_requests
  add column if not exists replacement_servant_id uuid references public.servants(id) on delete set null;

create table if not exists public.serving_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  notification_type text not null,
  schedule_id uuid references public.schedules(id) on delete set null,
  request_id uuid references public.serving_requests(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists serving_notifications_recipient_idx
  on public.serving_notifications(recipient_user_id,created_at desc);
alter table public.serving_notifications enable row level security;
drop policy if exists "users read own serving notifications" on public.serving_notifications;
create policy "users read own serving notifications" on public.serving_notifications
  for select to authenticated using (recipient_user_id=auth.uid());
drop policy if exists "users update own serving notifications" on public.serving_notifications;
create policy "users update own serving notifications" on public.serving_notifications
  for update to authenticated using (recipient_user_id=auth.uid()) with check (recipient_user_id=auth.uid());

-- Notify every active admin when a servant confirms an assignment.
create or replace function public.notify_admin_assignment_confirmation(p_assignment_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare
  a public.assignments%rowtype;
  s public.schedules%rowtype;
  servant_name text;
begin
  select * into a from public.assignments where id=p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  select * into s from public.schedules where id=a.schedule_id;
  select full_name into servant_name from public.servants where id=a.servant_id;
  if not exists(select 1 from public.servants where id=a.servant_id and auth_user_id=auth.uid()) then
    raise exception 'You can only confirm your own assignment';
  end if;
  if a.confirmation_status <> 'confirmed' then raise exception 'Assignment is not confirmed'; end if;
  insert into public.serving_notifications(recipient_user_id,title,body,notification_type,schedule_id)
  select p.id,'Servant confirmed assignment',
    servant_name||' confirmed '||s.service_name||' at '||s.service_date||'.',
    'assignment_confirmed',s.id
  from public.profiles p where p.role='admin';
end;
$$;

-- Admin assigns a replacement. The assignment changes only after all checks pass.
create or replace function public.admin_resolve_replacement(p_request_id uuid,p_replacement_servant_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare
  req public.serving_requests%rowtype;
  a public.assignments%rowtype;
  s public.schedules%rowtype;
  old_servant public.servants%rowtype;
  new_servant public.servants%rowtype;
begin
  if not public.is_admin() then raise exception 'Only administrators can assign a replacement'; end if;
  select * into req from public.serving_requests where id=p_request_id for update;
  if not found or req.status<>'pending' or req.request_type<>'replacement' then
    raise exception 'Replacement request is no longer pending';
  end if;
  select * into a from public.assignments where id=req.assignment_id for update;
  select * into s from public.schedules where id=req.schedule_id for update;
  select * into old_servant from public.servants where id=req.requester_servant_id;
  select * into new_servant from public.servants where id=p_replacement_servant_id and active=true;
  if a.id is null or s.id is null or old_servant.id is null or new_servant.id is null then
    raise exception 'Schedule, assignment or servant not found';
  end if;
  if a.servant_id<>req.requester_servant_id then raise exception 'Original assignment has already changed'; end if;
  if new_servant.id=old_servant.id then raise exception 'Choose a different replacement servant'; end if;
  if exists(select 1 from public.assignments ax where ax.schedule_id=s.id and ax.servant_id=new_servant.id and ax.id<>a.id) then
    raise exception 'Replacement servant already has another role in this service';
  end if;
  if exists(
    select 1 from public.assignments ax join public.schedules sx on sx.id=ax.schedule_id
    where ax.servant_id=new_servant.id and sx.service_date=s.service_date and sx.location_id<>s.location_id
  ) then raise exception 'Replacement servant already serves at another church on this date'; end if;

  update public.assignments set servant_id=new_servant.id,confirmation_status='pending' where id=a.id;
  update public.serving_requests set status='approved',replacement_servant_id=new_servant.id,reviewed_by=auth.uid(),reviewed_at=now() where id=req.id;

  if old_servant.auth_user_id is not null then
    insert into public.serving_notifications(recipient_user_id,title,body,notification_type,schedule_id,request_id)
    values(old_servant.auth_user_id,'Replacement found',
      'Your assignment for '||s.service_name||' at '||s.service_date||' has been covered by '||new_servant.full_name||'.',
      'replacement_found',s.id,req.id);
  end if;
  if new_servant.auth_user_id is not null then
    insert into public.serving_notifications(recipient_user_id,title,body,notification_type,schedule_id,request_id)
    values(new_servant.auth_user_id,'New serving assignment',
      'You have been assigned as replacement for '||old_servant.full_name||' in '||s.service_name||' at '||s.service_date||'. Please confirm your assignment.',
      'replacement_assigned',s.id,req.id);
  end if;
end;
$$;
revoke all on function public.notify_admin_assignment_confirmation(uuid) from public;
revoke all on function public.admin_resolve_replacement(uuid,uuid) from public;
grant execute on function public.notify_admin_assignment_confirmation(uuid) to authenticated;
grant execute on function public.admin_resolve_replacement(uuid,uuid) to authenticated;
