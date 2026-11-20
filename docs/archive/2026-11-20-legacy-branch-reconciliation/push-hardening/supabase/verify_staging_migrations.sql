-- Read-only post-install assertions for the isolated staging database.
WITH app_tables AS (
  SELECT c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
),
checks AS (
  SELECT '18 application tables exist' AS check_name, (SELECT count(*)=18 FROM app_tables) AS passed
  UNION ALL SELECT 'all application tables have RLS enabled',
    (SELECT count(*)=18 AND bool_and(relrowsecurity) FROM app_tables)
  UNION ALL SELECT 'push queue is inaccessible to anon',
    NOT has_table_privilege('anon','public.serving_push_queue','SELECT')
  UNION ALL SELECT 'push queue is inaccessible to authenticated',
    NOT has_table_privilege('authenticated','public.serving_push_queue','SELECT')
  UNION ALL SELECT 'push queue is accessible to service_role',
    has_table_privilege('service_role','public.serving_push_queue','SELECT')
  UNION ALL SELECT 'subscriptions allow authenticated SELECT and DELETE',
    has_table_privilege('authenticated','public.serving_push_subscriptions','SELECT')
    AND has_table_privilege('authenticated','public.serving_push_subscriptions','DELETE')
  UNION ALL SELECT 'subscriptions deny authenticated INSERT and UPDATE',
    NOT has_table_privilege('authenticated','public.serving_push_subscriptions','INSERT')
    AND NOT has_table_privilege('authenticated','public.serving_push_subscriptions','UPDATE')
  UNION ALL SELECT 'atomic schedule save RPC exists',
    to_regprocedure('public.admin_save_schedule_with_assignments(uuid,jsonb,jsonb)') IS NOT NULL
  UNION ALL SELECT 'push queue claim lifecycle RPCs exist',
    to_regprocedure('public.gms_claim_serving_push_queue(integer,integer)') IS NOT NULL
    AND to_regprocedure('public.gms_renew_serving_push_queue_claim(uuid,uuid,integer)') IS NOT NULL
    AND to_regprocedure('public.gms_checkpoint_serving_push_queue_endpoint(uuid,uuid,text)') IS NOT NULL
    AND to_regprocedure('public.gms_release_serving_push_queue_claim(uuid,uuid,integer,integer,text,boolean)') IS NOT NULL
  UNION ALL SELECT 'pg_cron is not installed',
    NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron')
)
SELECT check_name, passed FROM checks ORDER BY check_name;
