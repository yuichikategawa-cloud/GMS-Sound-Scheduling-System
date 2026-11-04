-- Serialize assignment conflict checks by servant and service date.
-- The helper is intentionally not SECURITY DEFINER; it runs under the
-- owner context of the SECURITY DEFINER trigger functions below.
CREATE OR REPLACE FUNCTION public.gms_lock_assignment_conflict_keys(
  p_old_servant_id uuid,
  p_old_service_date date,
  p_new_servant_id uuid,
  p_new_service_date date
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_lock_key bigint;
BEGIN
  FOR v_lock_key IN
    SELECT DISTINCT
      pg_catalog.hashtextextended(
        scope.servant_id::text || ':' ||
        pg_catalog.to_char(scope.service_date, 'YYYYMMDD'),
        6172026
      ) AS lock_key
    FROM (
      VALUES
        (p_old_servant_id, p_old_service_date),
        (p_new_servant_id, p_new_service_date)
    ) AS scope(servant_id, service_date)
    WHERE scope.servant_id IS NOT NULL
      AND scope.service_date IS NOT NULL
    ORDER BY lock_key
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.gms_lock_assignment_conflict_keys(uuid, date, uuid, date)
  FROM PUBLIC, anon, authenticated, service_role;

-- Restore the cross-location same-day guard and serialize both old/new
-- assignment scopes when an existing assignment is moved or reassigned.
CREATE OR REPLACE FUNCTION public.prevent_cross_location_same_day_assignment()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_new_date date;
  v_new_location uuid;
  v_old_date date;
  v_old_servant_id uuid;
BEGIN
  SELECT s.service_date, s.location_id
    INTO v_new_date, v_new_location
  FROM public.schedules s
  WHERE s.id = NEW.schedule_id;

  IF TG_OP = 'UPDATE' THEN
    SELECT s.service_date
      INTO v_old_date
    FROM public.schedules s
    WHERE s.id = OLD.schedule_id;

    v_old_servant_id := OLD.servant_id;
  END IF;

  PERFORM public.gms_lock_assignment_conflict_keys(
    v_old_servant_id,
    v_old_date,
    NEW.servant_id,
    v_new_date
  );

  IF EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE a.servant_id = NEW.servant_id
      AND a.id <> NEW.id
      AND s.service_date = v_new_date
      AND s.location_id <> v_new_location
  ) THEN
    RAISE EXCEPTION
      'Serving conflict: this person is already assigned at another church location on %.',
      v_new_date
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

-- The overlap guard uses the same lock namespace so same-location overlap
-- checks are protected from the same concurrent-write race.
CREATE OR REPLACE FUNCTION public.prevent_overlapping_same_location_assignment()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_new_date date;
  v_new_location uuid;
  v_new_start time;
  v_new_end time;
  v_old_date date;
  v_old_servant_id uuid;
BEGIN
  SELECT s.service_date, s.location_id, s.start_time, s.end_time
    INTO v_new_date, v_new_location, v_new_start, v_new_end
  FROM public.schedules s
  WHERE s.id = NEW.schedule_id;

  IF TG_OP = 'UPDATE' THEN
    SELECT s.service_date
      INTO v_old_date
    FROM public.schedules s
    WHERE s.id = OLD.schedule_id;

    v_old_servant_id := OLD.servant_id;
  END IF;

  PERFORM public.gms_lock_assignment_conflict_keys(
    v_old_servant_id,
    v_old_date,
    NEW.servant_id,
    v_new_date
  );

  IF EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE a.servant_id = NEW.servant_id
      AND a.id <> NEW.id
      AND s.service_date = v_new_date
      AND s.location_id = v_new_location
      AND v_new_start < s.end_time
      AND v_new_end > s.start_time
  ) THEN
    RAISE EXCEPTION
      'Serving conflict: this servant has an overlapping service at this location on %.',
      v_new_date
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_cross_location_same_day_assignment()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_overlapping_same_location_assignment()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS assignments_cross_location_guard ON public.assignments;

CREATE TRIGGER assignments_cross_location_guard
BEFORE INSERT OR UPDATE OF servant_id, schedule_id
ON public.assignments
FOR EACH ROW
EXECUTE FUNCTION public.prevent_cross_location_same_day_assignment();
