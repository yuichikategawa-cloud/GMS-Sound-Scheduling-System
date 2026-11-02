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
