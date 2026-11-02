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
