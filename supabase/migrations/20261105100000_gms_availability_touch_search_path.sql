-- Pin the availability timestamp trigger to trusted schemas.
-- The function remains SECURITY INVOKER; this only makes name resolution
-- deterministic when the trigger fires during an availability update.

CREATE OR REPLACE FUNCTION public.touch_availability_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$function$;
