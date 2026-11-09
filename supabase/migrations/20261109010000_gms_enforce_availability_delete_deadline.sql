-- Close the availability deadline bypass through servant-owned DELETE operations.
-- The original deadline migration is already recorded on Staging, so this
-- follow-up adds DELETE enforcement without changing RLS policies or grants.

CREATE OR REPLACE FUNCTION public.gms_guard_dated_availability_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_old_servant_id uuid;
  v_deadline text;
  v_deadline_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old_servant_id := OLD.servant_id;
    PERFORM public.gms_lock_availability_servants(v_old_servant_id, v_old_servant_id);
  ELSE
    IF TG_OP = 'UPDATE' THEN
      v_old_servant_id := OLD.servant_id;
    END IF;
    PERFORM public.gms_lock_availability_servants(v_old_servant_id, NEW.servant_id);
  END IF;

  IF NOT public.is_admin() THEN
    SELECT ss.value INTO v_deadline
    FROM public.system_settings ss
    WHERE ss.key = 'availability_deadline';

    IF coalesce(v_deadline, '') <> '' THEN
      BEGIN
        v_deadline_date := v_deadline::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Availability deadline is misconfigured; contact an administrator.';
      END;

      IF (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date > v_deadline_date THEN
        RAISE EXCEPTION 'The availability submission deadline has passed; contact an administrator.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status = 'unavailable' AND EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE a.servant_id = NEW.servant_id AND s.service_date = NEW.service_date
  ) THEN
    RAISE EXCEPTION 'Cannot mark this servant unavailable on % because an assignment already exists.', NEW.service_date
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gms_guard_recurring_availability_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_old_servant_id uuid;
  v_conflict_date date;
  v_deadline text;
  v_deadline_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old_servant_id := OLD.servant_id;
    PERFORM public.gms_lock_availability_servants(v_old_servant_id, v_old_servant_id);
  ELSE
    IF TG_OP = 'UPDATE' THEN
      v_old_servant_id := OLD.servant_id;
    END IF;
    PERFORM public.gms_lock_availability_servants(v_old_servant_id, NEW.servant_id);
  END IF;

  IF NOT public.is_admin() THEN
    SELECT ss.value INTO v_deadline
    FROM public.system_settings ss
    WHERE ss.key = 'availability_deadline';

    IF coalesce(v_deadline, '') <> '' THEN
      BEGIN
        v_deadline_date := v_deadline::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Availability deadline is misconfigured; contact an administrator.';
      END;

      IF (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date > v_deadline_date THEN
        RAISE EXCEPTION 'The availability submission deadline has passed; contact an administrator.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status = 'unavailable' THEN
    SELECT s.service_date INTO v_conflict_date
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE a.servant_id = NEW.servant_id
      AND s.service_date >= NEW.effective_from
      AND (NEW.effective_until IS NULL OR s.service_date <= NEW.effective_until)
      AND public.gms_availability_rule_matches(NEW.pattern, s.service_date, NEW.weekday, NEW.ordinal)
    ORDER BY s.service_date
    LIMIT 1;

    IF v_conflict_date IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot save this recurring unavailable rule because an assignment already exists on %.', v_conflict_date
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS gms_guard_dated_availability_write_trigger
  ON public.servant_availability;
CREATE TRIGGER gms_guard_dated_availability_write_trigger
BEFORE INSERT OR UPDATE OF servant_id, service_date, status OR DELETE
ON public.servant_availability
FOR EACH ROW EXECUTE FUNCTION public.gms_guard_dated_availability_write();

DROP TRIGGER IF EXISTS gms_guard_recurring_availability_write_trigger
  ON public.servant_availability_rules;
CREATE TRIGGER gms_guard_recurring_availability_write_trigger
BEFORE INSERT OR UPDATE OF servant_id, pattern, status, effective_from, effective_until, weekday, ordinal OR DELETE
ON public.servant_availability_rules
FOR EACH ROW EXECUTE FUNCTION public.gms_guard_recurring_availability_write();
