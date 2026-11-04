-- Read-only post-migration assertions for availability timestamp trigger hardening.
-- Run in staging after 20261105100000_gms_availability_touch_search_path.sql.

DO $gms_availability_touch_search_path_test$
DECLARE
  v_config text[];
  v_definition text;
  v_function_oid oid;
BEGIN
  SELECT p.oid, p.proconfig, pg_get_functiondef(p.oid)
    INTO v_function_oid, v_config, v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'touch_availability_updated_at'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Availability timestamp trigger function is missing';
  END IF;

  IF NOT (coalesce(v_config, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog']) THEN
    RAISE EXCEPTION 'Availability timestamp trigger function search_path is not pinned';
  END IF;

  IF position('pg_catalog.now()' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Availability timestamp trigger must call pg_catalog.now() explicitly';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgfoid = v_function_oid
      AND NOT t.tgisinternal
      AND t.tgrelid = 'public.servant_availability'::regclass
  ) THEN
    RAISE EXCEPTION 'Availability timestamp trigger is not attached to public.servant_availability';
  END IF;
END;
$gms_availability_touch_search_path_test$;
