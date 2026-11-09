-- GMS Web Push dispatcher schedule.
-- 1) Replace every placeholder below with values from YOUR Supabase project.
-- 2) Deploy supabase/functions/dispatch-push and set its function secrets first.
-- 3) Run this file in Supabase SQL Editor.
-- Requires PostgreSQL 15.1.1.61+ for the 5-second Supabase Cron interval.
-- Generate a fresh random 32-byte dispatch secret. Set the same value as PUSH_DISPATCH_SECRET in the Edge Function secrets and in Vault below. Do not reuse or paste a production secret into source control.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Supabase Vault is used so scheduled requests do not contain credentials in plain text.
-- If these names already exist, update/remove the existing Vault secrets before rerunning.
-- Replace placeholders in your private SQL Editor session; never commit live values.
select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'gms_push_project_url');
select vault.create_secret('sb_publishable_REPLACE_WITH_PROJECT_KEY', 'gms_push_anon_key');
select vault.create_secret('REPLACE_WITH_A_NEW_RANDOM_32_BYTE_HEX_SECRET', 'gms_push_dispatch_secret');

do $setup$
declare
  existing_job bigint;
  existing_cleanup_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'gms-dispatch-web-push';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  select jobid into existing_cleanup_job
  from cron.job
  where jobname = 'gms-cron-history-cleanup';
  if existing_cleanup_job is not null then
    perform cron.unschedule(existing_cleanup_job);
  end if;

  perform cron.schedule(
    'gms-dispatch-web-push',
    '5 seconds',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'gms_push_project_url') || '/functions/v1/dispatch-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'gms_push_anon_key'),
          'x-gms-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gms_push_dispatch_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      ) as request_id
      where exists (
        select 1
        from public.serving_push_queue q
        where q.processed_at is null
          and q.next_attempt_at <= pg_catalog.clock_timestamp()
          and (
            q.lease_expires_at is null
            or q.lease_expires_at <= pg_catalog.clock_timestamp()
          )
      );
    $job$
  );

  -- Sub-minute jobs create more run-history rows. Keep seven days for diagnosis.
  perform cron.schedule(
    'gms-cron-history-cleanup',
    '0 3 * * *',
    $cleanup$
      delete from cron.job_run_details
      where end_time < pg_catalog.now() - interval '7 days';
    $cleanup$
  );
end
$setup$;
