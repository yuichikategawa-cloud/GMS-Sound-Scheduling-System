-- GMS Web Push dispatcher schedule.
-- 1) Replace every placeholder below with values from YOUR Supabase project.
-- 2) Deploy supabase/functions/dispatch-push and set its function secrets first.
-- 3) Run this file in Supabase SQL Editor.
-- The shared dispatch secret must be identical in the Edge Function secret and Vault.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Supabase Vault is used so the cron job does not contain credentials in plain text.
-- If these names already exist, update/remove the existing Vault secrets before rerunning.
select vault.create_secret('https://zqpmzvhudxprzdfijrtu.supabase.co', 'gms_push_project_url');
select vault.create_secret('sb_publishable_7nURmIs2t0CUGA7PUzGI7Q_NJWDS8RQ', 'gms_push_anon_key');
select vault.create_secret('<SET_A_NEW_RANDOM_SECRET_HERE>', 'gms_push_dispatch_secret');

do $setup$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'gms-dispatch-web-push';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'gms-dispatch-web-push',
    '* * * * *',
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
      ) as request_id;
    $job$
  );
end
$setup$;
