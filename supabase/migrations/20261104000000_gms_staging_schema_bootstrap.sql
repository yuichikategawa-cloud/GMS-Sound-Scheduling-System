-- GMS Sound Scheduling System clean-install baseline for isolated staging.
-- Reconstructed from the repository's historical SQL sequence and intended to be
-- applied only to a new, empty staging database.
--
-- STAGING SAFETY DIFFERENCES:
--   * No pg_cron extension or scheduled jobs are created.
--   * No immediate cleanup/retention procedures are run during installation.
--   * No push-dispatch HTTP job, Vault secret, or Edge Function is configured.
--   * Only the default sample locations/service templates in the original schema
--     are inserted. No production people, availability, assignments, or history
--     are copied.
--
-- The production database is not modified by this file. Production migrations
-- remain tracked separately by their live migration ledger.


-- ============================================================================
-- Historical source: supabase/schema.sql
-- ============================================================================

-- GMS Serving Management System
-- Run the complete file in Supabase Dashboard > SQL Editor.
-- Uses Supabase Auth. Never put a service_role key in the frontend.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'servant' check (role in ('admin','servant')),
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.servants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  active boolean not null default true,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.service_templates (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  day_of_week smallint not null check (day_of_week in (0,6)), -- 0 Sunday, 6 Saturday
  service_name text not null,
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(location_id, day_of_week, service_name)
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  location_id uuid not null references public.locations(id) on delete restrict,
  service_name text not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_date, location_id, service_name)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  servant_id uuid not null references public.servants(id) on delete restrict,
  role text not null check (role in ('FOH','Monitor','Assistant')),
  created_at timestamptz not null default now(),
  unique(schedule_id, role),
  unique(schedule_id, servant_id)
);

create index if not exists schedules_date_idx on public.schedules(service_date);
create index if not exists schedules_location_idx on public.schedules(location_id);
create index if not exists assignments_servant_idx on public.assignments(servant_id);
create index if not exists templates_location_day_idx on public.service_templates(location_id, day_of_week);

-- Automatically create a basic profile when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), 'servant')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Security-definer helper avoids recursive RLS when checking profile role.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.servants enable row level security;
alter table public.service_templates enable row level security;
alter table public.schedules enable row level security;
alter table public.assignments enable row level security;

-- Authenticated users can view schedules and the servant names needed to display them.
drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());
drop policy if exists "admins update profiles" on public.profiles;
create policy "admins update profiles" on public.profiles for update to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read locations" on public.locations;
create policy "authenticated read locations" on public.locations for select to authenticated using (true);
drop policy if exists "admins manage locations" on public.locations;
create policy "admins manage locations" on public.locations for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read servants" on public.servants;
create policy "authenticated read servants" on public.servants for select to authenticated using (true);
drop policy if exists "admins manage servants" on public.servants;
create policy "admins manage servants" on public.servants for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read templates" on public.service_templates;
create policy "authenticated read templates" on public.service_templates for select to authenticated using (true);
drop policy if exists "admins manage templates" on public.service_templates;
create policy "admins manage templates" on public.service_templates for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read schedules" on public.schedules;
create policy "authenticated read schedules" on public.schedules for select to authenticated using (true);
drop policy if exists "admins manage schedules" on public.schedules;
create policy "admins manage schedules" on public.schedules for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read assignments" on public.assignments;
create policy "authenticated read assignments" on public.assignments for select to authenticated using (true);
drop policy if exists "admins manage assignments" on public.assignments;
create policy "admins manage assignments" on public.assignments for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Seed the three church locations.
insert into public.locations(name) values
 ('GMS Alam Sutera'), ('GMS BSD'), ('GMS Karawaci')
on conflict (name) do nothing;

-- Seed recurring Saturday (6) and Sunday (0) service templates.
with seed(location_name, day_of_week, service_name, start_time, end_time) as (
 values
 ('GMS Alam Sutera',6,'VSS','10:00','15:00'),
 ('GMS Alam Sutera',6,'AOG Teen','16:00','18:00'),
 ('GMS Alam Sutera',6,'AOG Youth','18:00','20:00'),
 ('GMS Alam Sutera',0,'Service 1','07:00','09:00'),
 ('GMS Alam Sutera',0,'Service 2','09:00','11:00'),
 ('GMS Alam Sutera',0,'Service 3','11:00','13:00'),
 ('GMS Alam Sutera',0,'Service 4','13:00','15:00'),
 ('GMS Alam Sutera',0,'Service 5','15:00','17:00'),
 ('GMS Alam Sutera',0,'Service 6','17:00','19:00'),
 ('GMS Alam Sutera',0,'Service 7','19:00','21:00'),
 ('GMS BSD',6,'VSS','10:00','15:00'),
 ('GMS BSD',6,'AOG','16:00','18:00'),
 ('GMS BSD',0,'Service 1','09:00','11:00'),
 ('GMS BSD',0,'Service 2','11:00','13:00'),
 ('GMS BSD',0,'Service 3','13:00','15:00'),
 ('GMS BSD',0,'Service 4','15:00','17:00'),
 ('GMS Karawaci',6,'AOG','16:00','18:00'),
 ('GMS Karawaci',0,'Service 1','09:00','11:00'),
 ('GMS Karawaci',0,'Service 2','11:00','13:00'),
 ('GMS Karawaci',0,'Service 3','13:00','15:00')
)
insert into public.service_templates(location_id,day_of_week,service_name,start_time,end_time)
select l.id,s.day_of_week,s.service_name,s.start_time::time,s.end_time::time
from seed s join public.locations l on l.name=s.location_name
on conflict(location_id,day_of_week,service_name) do update
set start_time=excluded.start_time,end_time=excluded.end_time,active=true;

-- After signing up with your own email, promote that account to admin:
-- update public.profiles set role='admin' where id=(select id from auth.users where email='YOUR_EMAIL');

-- Availability records and cross-location same-day assignment protection.
-- This block is also provided separately in migrations_20261102.sql for existing projects.
create table if not exists public.servant_availability (
  id uuid primary key default gen_random_uuid(),
  servant_id uuid not null references public.servants(id) on delete cascade,
  service_date date not null,
  status text not null check (status in ('available','unavailable','prefer_not')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(servant_id, service_date)
);
create index if not exists servant_availability_date_idx on public.servant_availability(service_date);
create index if not exists servant_availability_servant_idx on public.servant_availability(servant_id);
alter table public.servant_availability enable row level security;
drop policy if exists "authenticated read availability" on public.servant_availability;
create policy "authenticated read availability" on public.servant_availability for select to authenticated using (true);
drop policy if exists "admins manage availability" on public.servant_availability;
create policy "admins manage availability" on public.servant_availability for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.prevent_cross_location_same_day_assignment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare new_date date; new_location uuid;
begin
  select service_date, location_id into new_date, new_location from public.schedules where id = new.schedule_id;
  if exists (
    select 1 from public.assignments a join public.schedules s on s.id = a.schedule_id
    where a.servant_id = new.servant_id
      and a.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and s.service_date = new_date and s.location_id <> new_location
  ) then
    raise exception 'Serving conflict: this person is already assigned at another church location on %.', new_date using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists assignments_cross_location_guard on public.assignments;
create trigger assignments_cross_location_guard before insert or update of servant_id, schedule_id on public.assignments
for each row execute function public.prevent_cross_location_same_day_assignment();

create or replace function public.touch_availability_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists servant_availability_touch_updated_at on public.servant_availability;
create trigger servant_availability_touch_updated_at before update on public.servant_availability
for each row execute function public.touch_availability_updated_at();

-- Linked servants can manage their own availability; admins can manage all records.
drop policy if exists "servants manage own availability" on public.servant_availability;
create policy "servants manage own availability" on public.servant_availability for all to authenticated
using (exists (select 1 from public.servants s where s.id = servant_id and s.auth_user_id = auth.uid()))
with check (exists (select 1 from public.servants s where s.id = servant_id and s.auth_user_id = auth.uid()));

-- ============================================================================
-- Historical source: supabase/migrations_20261102.sql
-- ============================================================================

-- GMS Serving System: availability management + cross-location assignment guard
-- Run this once in Supabase SQL Editor for an existing installation.

create table if not exists public.servant_availability (
  id uuid primary key default gen_random_uuid(),
  servant_id uuid not null references public.servants(id) on delete cascade,
  service_date date not null,
  status text not null check (status in ('available','unavailable','prefer_not')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(servant_id, service_date)
);

create index if not exists servant_availability_date_idx
  on public.servant_availability(service_date);
create index if not exists servant_availability_servant_idx
  on public.servant_availability(servant_id);

alter table public.servant_availability enable row level security;
drop policy if exists "authenticated read availability" on public.servant_availability;
create policy "authenticated read availability"
  on public.servant_availability for select to authenticated using (true);
drop policy if exists "admins manage availability" on public.servant_availability;
create policy "admins manage availability"
  on public.servant_availability for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "servants manage own availability" on public.servant_availability;
create policy "servants manage own availability"
  on public.servant_availability for all to authenticated
  using (exists (select 1 from public.servants s where s.id = servant_id and s.auth_user_id = auth.uid()))
  with check (exists (select 1 from public.servants s where s.id = servant_id and s.auth_user_id = auth.uid()));

-- Enforce the rule in the database, not only in the browser:
-- a servant may not be assigned to different church locations on the same date.
create or replace function public.prevent_cross_location_same_day_assignment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  new_date date;
  new_location uuid;
begin
  select service_date, location_id into new_date, new_location
  from public.schedules where id = new.schedule_id;

  if exists (
    select 1
    from public.assignments a
    join public.schedules s on s.id = a.schedule_id
    where a.servant_id = new.servant_id
      and a.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and s.service_date = new_date
      and s.location_id <> new_location
  ) then
    raise exception 'Serving conflict: this person is already assigned at another church location on %.', new_date
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists assignments_cross_location_guard on public.assignments;
create trigger assignments_cross_location_guard
before insert or update of servant_id, schedule_id on public.assignments
for each row execute function public.prevent_cross_location_same_day_assignment();

-- Keep updated_at fresh for future integrations.
create or replace function public.touch_availability_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists servant_availability_touch_updated_at on public.servant_availability;
create trigger servant_availability_touch_updated_at
before update on public.servant_availability
for each row execute function public.touch_availability_updated_at();

-- ============================================================================
-- Historical source: supabase/migrations_20261103.sql
-- ============================================================================

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

-- ============================================================================
-- Historical source: supabase/migrations_20261104.sql
-- ============================================================================

-- GMS Sound Scheduling System v4: member profiles, username login lookup, archive support.
-- Run once in Supabase SQL Editor after the v3 migrations.

create extension if not exists pgcrypto;

alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username)) where username is not null;

create table if not exists public.member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  gender text not null check (gender in ('Male','Female','Prefer not to say')),
  date_of_birth date not null,
  nij text not null unique,
  phone_number text not null,
  domicile_area text not null check (domicile_area in ('Alam Sutera','BSD','Karawaci','Others')),
  domicile_other text,
  cg_category text not null check (cg_category in ('AOG Teen','AOG Youth','Young Adult','Family','Senior')),
  cg_status text not null check (cg_status in ('Team Leader','Coach','CG Leader','Sponsor','Member')),
  cg_number text not null,
  cg_days text[] not null default '{}',
  cg_time text not null,
  team_leader_name text,
  coach_name text,
  cg_leader_name text,
  leader_phone_numbers text[] not null default '{}',
  last_verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_profiles_other_area_check check (domicile_area <> 'Others' or nullif(trim(domicile_other),'') is not null),
  constraint member_profiles_leader_phone_check check (cardinality(leader_phone_numbers) >= 1)
);

alter table public.member_profiles enable row level security;
drop policy if exists "member profiles read own or admin" on public.member_profiles;
create policy "member profiles read own or admin" on public.member_profiles
 for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "members insert own profile" on public.member_profiles;
create policy "members insert own profile" on public.member_profiles
 for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "members update own profile" on public.member_profiles;
create policy "members update own profile" on public.member_profiles
 for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "admins manage member profiles" on public.member_profiles;
create policy "admins manage member profiles" on public.member_profiles
 for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- A profile created by Auth stores its username and registration details atomically.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, display_name, role, username)
  values (new.id, coalesce(m->>'full_name', split_part(new.email,'@',1)), 'servant', lower(m->>'username'))
  on conflict (id) do update set username = excluded.username;

  if m ? 'nij' then
    insert into public.servants(full_name, active, auth_user_id)
    values (m->>'full_name', true, new.id)
    on conflict (auth_user_id) do update set full_name = excluded.full_name, active = true;

    insert into public.member_profiles (
      user_id,full_name,email,gender,date_of_birth,nij,phone_number,domicile_area,domicile_other,
      cg_category,cg_status,cg_number,cg_days,cg_time,team_leader_name,coach_name,cg_leader_name,leader_phone_numbers
    ) values (
      new.id, m->>'full_name', coalesce(new.email,m->>'email'), m->>'gender', (m->>'date_of_birth')::date,
      m->>'nij',m->>'phone_number',m->>'domicile_area',nullif(m->>'domicile_other',''),m->>'cg_category',
      m->>'cg_status',m->>'cg_number',array(select jsonb_array_elements_text(coalesce(m->'cg_days','[]'::jsonb))),
      m->>'cg_time',nullif(m->>'team_leader_name',''),nullif(m->>'coach_name',''),nullif(m->>'cg_leader_name',''),
      array(select jsonb_array_elements_text(coalesce(m->'leader_phone_numbers','[]'::jsonb)))
    ) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

-- Past schedules remain in the database. UI hides them from current schedules;
-- only administrators can export the historical archive through the admin view.
create index if not exists schedules_history_date_idx on public.schedules(service_date desc);

-- Admin-only read policy already exists for audit logs. No public username lookup table is created.

-- Keep the servant directory display name in sync when a member edits their own name.
create or replace function public.sync_member_profile_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set display_name = new.full_name where id = new.user_id;
  insert into public.servants(full_name, active, auth_user_id)
  values (new.full_name, true, new.user_id)
  on conflict (auth_user_id) do update set full_name = excluded.full_name, active = true;
  return new;
end;
$$;
drop trigger if exists member_profile_name_sync on public.member_profiles;
create trigger member_profile_name_sync after insert or update of full_name on public.member_profiles
for each row execute function public.sync_member_profile_name();

-- ============================================================================
-- Historical source: supabase/migrations_20261105_workflow_enhancements.sql
-- ============================================================================

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

-- ============================================================================
-- Historical source: supabase/migrations_20261106_assignment_notifications.sql
-- ============================================================================

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

-- ============================================================================
-- Historical source: supabase/migrations_20261107_smart_scheduling_d1.sql
-- ============================================================================

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


-- Scheduled execution intentionally omitted from the staging bootstrap.

-- ============================================================================
-- Historical source: supabase/migrations_20261108_recurring_availability.sql
-- ============================================================================

-- Recurring servant availability restrictions for GMS Sound Scheduling System.
-- Run in Supabase SQL Editor after the existing servant_availability table and public.is_admin() are present.

create table if not exists public.servant_availability_rules (
  id uuid primary key default gen_random_uuid(),
  servant_id uuid not null references public.servants(id) on delete cascade,
  pattern text not null check (pattern in ('weekday','saturday','sunday','second_week','nth_weekday','month_edges')),
  status text not null default 'unavailable' check (status in ('unavailable','prefer_not')),
  effective_from date not null,
  effective_until date,
  weekday smallint not null default 6 check (weekday between 0 and 6),
  ordinal smallint not null default 2 check (ordinal between 1 and 5),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint servant_availability_rules_date_order check (effective_until is null or effective_until >= effective_from)
);

create index if not exists servant_availability_rules_servant_dates_idx
  on public.servant_availability_rules(servant_id, effective_from, effective_until);

alter table public.servant_availability_rules enable row level security;

drop policy if exists "servants and admins read availability rules" on public.servant_availability_rules;
create policy "servants and admins read availability rules"
  on public.servant_availability_rules for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.servants s
    where s.id = servant_id and s.auth_user_id = auth.uid()
  ));

drop policy if exists "servants and admins create availability rules" on public.servant_availability_rules;
create policy "servants and admins create availability rules"
  on public.servant_availability_rules for insert to authenticated
  with check (public.is_admin() or exists (
    select 1 from public.servants s
    where s.id = servant_id and s.auth_user_id = auth.uid()
  ));

drop policy if exists "servants and admins delete availability rules" on public.servant_availability_rules;
create policy "servants and admins delete availability rules"
  on public.servant_availability_rules for delete to authenticated
  using (public.is_admin() or exists (
    select 1 from public.servants s
    where s.id = servant_id and s.auth_user_id = auth.uid()
  ));

-- Rules are expanded by the application for the next 24 months when checking assignment eligibility.
-- This table stores the rule itself; it does not create or overwrite dated availability rows.

-- ============================================================================
-- Historical source: supabase/migrations_20261109_cleanup_expired_availability.sql
-- ============================================================================

-- Automatically remove expired one-off availability records.
-- Recurring rules are retained; only dated servant_availability rows before today are deleted.
-- Uses UTC scheduling; current_date is safe for Indonesia (UTC+7) because it never deletes today's rows.

create or replace function public.cleanup_expired_servant_availability()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.servant_availability
  where service_date < current_date;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_servant_availability() from public;
revoke all on function public.cleanup_expired_servant_availability() from anon, authenticated;


-- Scheduled execution intentionally omitted from the staging bootstrap.


-- Staging does not run the production cleanup function automatically.

-- ============================================================================
-- Historical source: supabase/migrations_20261110_scheduling_intelligence_pwa_notifications.sql
-- ============================================================================

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

-- Staging deliberately omits the recurring reminder schedule.
comment on table public.serving_notifications is 'Primary in-app notification history; retained for 30 days. Push is an optional secondary channel.';
comment on table public.serving_push_subscriptions is 'Per-device web push subscriptions, scoped to the signed-in user.';
comment on table public.servant_serving_preferences is 'Hard allow-list rules checked when assigning servants to schedules.';

-- ============================================================================
-- Historical source: supabase/migrations_20261111_notification_audit_retention.sql
-- ============================================================================

-- GMS retention policy:
--   * In-app notification history: retain a maximum of 30 days.
--   * Audit history: visible in the app for 14 days; records aged more than 14 days
--     can be downloaded by an administrator; delete records older than 30 days.
-- Run after migrations that create public.serving_notifications and public.audit_logs.

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

-- Scheduled execution intentionally omitted from the staging bootstrap.


-- Retention is not executed automatically in staging.

-- ============================================================================
-- Historical source: supabase/migrations_20261112_profile_verification_reminders.sql
-- ============================================================================

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

-- Scheduled execution intentionally omitted from the staging bootstrap.


comment on function public.gms_generate_daily_serving_reminders() is
  'Daily Jakarta-time reminders for D-1 assignments, availability deadlines, and member profile verification at D-3/D-1/D-0. Notifications are idempotent through event_key.';

-- ============================================================================
-- Historical source: supabase/migrations_20261113_bulk_assignment_grouped_notifications.sql
-- ============================================================================

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

-- ============================================================================
-- Historical source: supabase/migrations_20261114_publish_all_churches.sql
-- ============================================================================

-- GMS: allow administrators to publish/unpublish all church locations in one action.
-- The UI uses p_location_id = NULL and p_schedule_ids = NULL for the explicit All churches option.
-- Grouped notification delivery remains one Inbox/push event per affected account per operation.

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
  -- NULL location + NULL schedule IDs intentionally means all church locations.

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


comment on function public.admin_publish_schedules_grouped(uuid,uuid[],text) is
  'Admin-only publish/unpublish for one church, selected services, or all church locations when both filters are NULL. Sends one grouped notification per affected account.';

-- ============================================================================
-- Historical source: supabase/migrations_20261115_bulk_assignment_commit_fix.sql
-- ============================================================================

-- GMS Sound Scheduling System: reliable transactional bulk-assignment saves.
-- Run after migrations 20261102 through 20261114.
--
-- Fixes two issues in the original bulk RPC:
-- 1. It processed each role one by one, which could hit the unique(schedule_id, servant_id)
--    constraint while a servant was being moved between roles in the same batch.
-- 2. It did not stage the complete final state before applying changes.
--
-- This version stages all rows, validates the final role map, removes changed slots first,
-- then inserts the final assignments in one transaction. Any validation failure rolls back
-- the entire operation. It emits at most one in-app/push notification per affected account.

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

  -- Lock every affected schedule before comparing existing and proposed assignments.
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
'Admin-only transactional bulk assignment commit. Stages final role values, clears changed slots before re-inserting, preserves unchanged confirmations, keeps database eligibility triggers active and emits one grouped notification per affected account.';