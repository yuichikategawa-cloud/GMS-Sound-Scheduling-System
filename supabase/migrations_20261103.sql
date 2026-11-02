-- GMS Sound Scheduling System: publishing, servant experience, requests, multi-location growth and audit trail.
-- Run once in Supabase SQL Editor on an existing installation.

-- Draft/published workflow. Existing schedules remain visible by marking them published.
alter table public.schedules add column if not exists status text not null default 'published';
alter table public.schedules drop constraint if exists schedules_status_check;
alter table public.schedules add constraint schedules_status_check check (status in ('draft','published'));
alter table public.schedules alter column status set default 'draft';

-- Servant confirmation of their own assignment.
alter table public.assignments add column if not exists confirmation_status text not null default 'pending';
alter table public.assignments drop constraint if exists assignments_confirmation_status_check;
alter table public.assignments add constraint assignments_confirmation_status_check check (confirmation_status in ('pending','confirmed','declined'));

-- Availability deadline and app-wide settings.
create table if not exists public.system_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.system_settings enable row level security;
drop policy if exists "authenticated read system settings" on public.system_settings;
create policy "authenticated read system settings" on public.system_settings for select to authenticated using (true);
drop policy if exists "admins manage system settings" on public.system_settings;
create policy "admins manage system settings" on public.system_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Replacement and swap requests use one workflow table.
create table if not exists public.serving_requests (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  requester_servant_id uuid not null references public.servants(id) on delete cascade,
  request_type text not null check (request_type in ('replacement','swap')),
  details text,
  status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists serving_requests_status_idx on public.serving_requests(status, created_at desc);
create index if not exists serving_requests_schedule_idx on public.serving_requests(schedule_id);
alter table public.serving_requests enable row level security;
drop policy if exists "admins manage serving requests" on public.serving_requests;
create policy "admins manage serving requests" on public.serving_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "servants read own serving requests" on public.serving_requests;
create policy "servants read own serving requests" on public.serving_requests for select to authenticated using (
  exists (select 1 from public.servants s where s.id = requester_servant_id and s.auth_user_id = auth.uid())
);
drop policy if exists "servants create own serving requests" on public.serving_requests;
create policy "servants create own serving requests" on public.serving_requests for insert to authenticated with check (
  exists (select 1 from public.servants s where s.id = requester_servant_id and s.auth_user_id = auth.uid())
);

-- Admins see every schedule; servants only see published schedules.
drop policy if exists "authenticated read schedules" on public.schedules;
drop policy if exists "users read published schedules" on public.schedules;
create policy "users read published schedules" on public.schedules for select to authenticated
using (public.is_admin() or status = 'published');

-- Assignments for published services are visible to servants so they can see their team.
drop policy if exists "authenticated read assignments" on public.assignments;
drop policy if exists "users read published assignments" on public.assignments;
create policy "users read published assignments" on public.assignments for select to authenticated using (
  public.is_admin() or exists (select 1 from public.schedules s where s.id = schedule_id and s.status = 'published')
);
-- Servants may update only their own confirmation status; admins retain full management.
drop policy if exists "servants confirm own assignment" on public.assignments;
create policy "servants confirm own assignment" on public.assignments for update to authenticated
using (exists (select 1 from public.servants s where s.id = servant_id and s.auth_user_id = auth.uid()))
with check (exists (select 1 from public.servants s where s.id = servant_id and s.auth_user_id = auth.uid()));

create or replace function public.guard_servant_assignment_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if new.schedule_id <> old.schedule_id or new.servant_id <> old.servant_id or new.role <> old.role then
      raise exception 'Servants may only update their own confirmation status.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_servant_assignment_update_trigger on public.assignments;
create trigger guard_servant_assignment_update_trigger before update on public.assignments
for each row execute function public.guard_servant_assignment_update();

-- Audit log for schedule and assignment changes.
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  table_name text not null,
  record_id text not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
alter table public.audit_logs enable row level security;
drop policy if exists "admins read audit logs" on public.audit_logs;
create policy "admins read audit logs" on public.audit_logs for select to authenticated using (public.is_admin());
create or replace function public.write_audit_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(actor_id,table_name,record_id,action,old_data,new_data)
  values (auth.uid(), tg_table_name,
    coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id','unknown'), tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists schedules_audit_trigger on public.schedules;
create trigger schedules_audit_trigger after insert or update or delete on public.schedules for each row execute function public.write_audit_log();
drop trigger if exists assignments_audit_trigger on public.assignments;
create trigger assignments_audit_trigger after insert or update or delete on public.assignments for each row execute function public.write_audit_log();

-- Helpful indexes for monthly/weekly schedule reads.
create index if not exists schedules_date_status_idx on public.schedules(service_date,status);

-- Add future church locations through the app's Add church action; no schema change is needed.

-- Prevent overlapping same-location services for the same servant (cross-location same-day guard already exists).
create or replace function public.prevent_overlapping_same_location_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_date date; new_location uuid; new_start time; new_end time;
begin
  select service_date,location_id,start_time,end_time into new_date,new_location,new_start,new_end
  from public.schedules where id=new.schedule_id;
  if exists (
    select 1 from public.assignments a join public.schedules s on s.id=a.schedule_id
    where a.servant_id=new.servant_id
      and a.id <> coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
      and s.service_date=new_date and s.location_id=new_location
      and new_start < s.end_time and new_end > s.start_time
  ) then
    raise exception 'Serving conflict: this servant has an overlapping service at this location on %.',new_date using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists assignments_overlap_guard on public.assignments;
create trigger assignments_overlap_guard before insert or update of servant_id,schedule_id on public.assignments
for each row execute function public.prevent_overlapping_same_location_assignment();

-- Availability notes may contain personal context; servants can read only their own records.
drop policy if exists "authenticated read availability" on public.servant_availability;
drop policy if exists "users read own availability" on public.servant_availability;
create policy "users read own availability" on public.servant_availability for select to authenticated using (
  public.is_admin() or exists (select 1 from public.servants s where s.id = servant_id and s.auth_user_id = auth.uid())
);
