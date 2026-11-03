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

-- Supabase projects commonly provide pg_cron. If it is not enabled, enable it
-- in Database > Extensions, then run this migration again.
create extension if not exists pg_cron;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'gms-clean-expired-availability'
  ) then
    perform cron.schedule(
      'gms-clean-expired-availability',
      '15 0 * * *',
      'select public.cleanup_expired_servant_availability();'
    );
  end if;
end
$$;

-- Clean expired rows immediately when this migration is first applied.
select public.cleanup_expired_servant_availability();
