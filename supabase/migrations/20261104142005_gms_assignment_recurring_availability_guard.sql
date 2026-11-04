-- Serialize assignment writes against date-specific and recurring availability
-- writes for the affected servant(s).
CREATE OR REPLACE FUNCTION public.gms_lock_availability_servants(
  p_old_servant_id uuid,
  p_new_servant_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_lock_key integer;
BEGIN
  FOR v_lock_key IN
    SELECT DISTINCT pg_catalog.hashtext(scope.servant_id::text) AS lock_key
    FROM (
      VALUES (p_old_servant_id), (p_new_servant_id)
    ) AS scope(servant_id)
    WHERE scope.servant_id IS NOT NULL
    ORDER BY lock_key
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(6172027, v_lock_key);
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.gms_lock_availability_servants(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep pattern interpretation identical to the production UI:
-- weekday = Mon-Fri; second_week = calendar days 8-14;
-- month_edges = first/last three calendar days;
-- nth_weekday ordinal 5 means the last occurrence in that month.
CREATE OR REPLACE FUNCTION public.gms_availability_rule_matches(
  p_pattern text,
  p_service_date date,
  p_weekday smallint,
  p_ordinal smallint
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE p_pattern
    WHEN 'weekday' THEN
      extract(dow FROM p_service_date) BETWEEN 1 AND 5
    WHEN 'saturday' THEN
      extract(dow FROM p_service_date) = 6
    WHEN 'sunday' THEN
      extract(dow FROM p_service_date) = 0
    WHEN 'second_week' THEN
      extract(day FROM p_service_date) BETWEEN 8 AND 14
    WHEN 'month_edges' THEN
      extract(day FROM p_service_date) <= 3
      OR extract(day FROM p_service_date) >
         extract(day FROM (
           date_trunc('month', p_service_date) + interval '1 month - 1 day'
         ))
    WHEN 'nth_weekday' THEN
      extract(dow FROM p_service_date) = p_weekday
      AND CASE
        WHEN p_ordinal = 5 THEN
          extract(day FROM p_service_date)::integer + 7 >
          extract(day FROM (
            date_trunc('month', p_service_date) + interval '1 month - 1 day'
          ))::integer
        ELSE
          ceil(extract(day FROM p_service_date) / 7.0)::integer = p_ordinal
      END
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.gms_availability_rule_matches(text, date, smallint, smallint)
  FROM PUBLIC, anon, authenticated, service_role;

-- The assignment trigger now enforces explicit unavailable dates and all
-- recurring unavailable rules before checking serving eligibility preferences.
CREATE OR REPLACE FUNCTION public.gms_guard_assignment_preferences()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  sc public.schedules%rowtype;
  v_old_servant_id uuid;
BEGIN
  IF NEW.servant_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_servant_id := OLD.servant_id;
  END IF;

  PERFORM public.gms_lock_availability_servants(
    v_old_servant_id,
    NEW.servant_id
  );

  SELECT *
    INTO sc
  FROM public.schedules
  WHERE id = NEW.schedule_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule not found for assignment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.servant_availability av
    WHERE av.servant_id = NEW.servant_id
      AND av.service_date = sc.service_date
      AND av.status = 'unavailable'
  ) THEN
    RAISE EXCEPTION
      'Serving availability rule: this servant is marked unavailable on %.',
      sc.service_date
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.servant_availability_rules r
    WHERE r.servant_id = NEW.servant_id
      AND r.status = 'unavailable'
      AND r.effective_from <= sc.service_date
      AND (r.effective_until IS NULL OR r.effective_until >= sc.service_date)
      AND public.gms_availability_rule_matches(
        r.pattern,
        sc.service_date,
        r.weekday,
        r.ordinal
      )
  ) THEN
    RAISE EXCEPTION
      'Recurring availability rule: this servant is marked unavailable on %.',
      sc.service_date
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.gms_servant_matches_preferences(
    NEW.servant_id,
    sc.service_date,
    sc.location_id,
    sc.service_name,
    sc.start_time,
    sc.end_time
  ) THEN
    RAISE EXCEPTION
      'Serving eligibility rule: this servant is restricted from this service date, time window, church or service.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.gms_guard_assignment_preferences()
  FROM PUBLIC, anon, authenticated, service_role;

-- Prevent setting a dated status to "unavailable" when an assignment already
-- exists for that servant/date. "Prefer not" remains advisory, as in the UI.
CREATE OR REPLACE FUNCTION public.gms_guard_dated_availability_write()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_old_servant_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_servant_id := OLD.servant_id;
  END IF;

  PERFORM public.gms_lock_availability_servants(
    v_old_servant_id,
    NEW.servant_id
  );

  IF NEW.status = 'unavailable' AND EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE a.servant_id = NEW.servant_id
      AND s.service_date = NEW.service_date
  ) THEN
    RAISE EXCEPTION
      'Cannot mark this servant unavailable on % because an assignment already exists.',
      NEW.service_date
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.gms_guard_dated_availability_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS gms_guard_dated_availability_write_trigger
  ON public.servant_availability;

CREATE TRIGGER gms_guard_dated_availability_write_trigger
BEFORE INSERT OR UPDATE OF servant_id, service_date, status
ON public.servant_availability
FOR EACH ROW
EXECUTE FUNCTION public.gms_guard_dated_availability_write();

-- Prevent adding/changing an unavailable recurring rule when an existing
-- assignment falls inside its effective range and matches its recurrence.
CREATE OR REPLACE FUNCTION public.gms_guard_recurring_availability_write()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_old_servant_id uuid;
  v_conflict_date date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_servant_id := OLD.servant_id;
  END IF;

  PERFORM public.gms_lock_availability_servants(
    v_old_servant_id,
    NEW.servant_id
  );

  IF NEW.status = 'unavailable' THEN
    SELECT s.service_date
      INTO v_conflict_date
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE a.servant_id = NEW.servant_id
      AND s.service_date >= NEW.effective_from
      AND (NEW.effective_until IS NULL OR s.service_date <= NEW.effective_until)
      AND public.gms_availability_rule_matches(
        NEW.pattern,
        s.service_date,
        NEW.weekday,
        NEW.ordinal
      )
    ORDER BY s.service_date
    LIMIT 1;

    IF v_conflict_date IS NOT NULL THEN
      RAISE EXCEPTION
        'Cannot save this recurring unavailable rule because an assignment already exists on %.',
        v_conflict_date
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.gms_guard_recurring_availability_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS gms_guard_recurring_availability_write_trigger
  ON public.servant_availability_rules;

CREATE TRIGGER gms_guard_recurring_availability_write_trigger
BEFORE INSERT OR UPDATE OF servant_id, pattern, status, effective_from, effective_until, weekday, ordinal
ON public.servant_availability_rules
FOR EACH ROW
EXECUTE FUNCTION public.gms_guard_recurring_availability_write();
