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
