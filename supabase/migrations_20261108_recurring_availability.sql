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
