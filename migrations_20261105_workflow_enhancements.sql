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
