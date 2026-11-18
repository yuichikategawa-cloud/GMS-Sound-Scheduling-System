-- Enforce custom weekly recurring availability rules consistently at every
-- assignment, edit, publication and schedule-replacement boundary.
--
-- The composite row parameter carries effective_from, weekdays and interval_weeks
-- together. The interval is anchored to the Monday of effective_from.

BEGIN;

CREATE OR REPLACE FUNCTION public.gms_availability_rule_matches(
  p_rule public.servant_availability_rules,
  p_service_date date
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE (p_rule).pattern
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
         )) - 3
    WHEN 'nth_weekday' THEN
      extract(dow FROM p_service_date) = (p_rule).weekday
      AND CASE
        WHEN (p_rule).ordinal = 5 THEN
          extract(day FROM p_service_date)::integer + 7 >
          extract(day FROM (
            date_trunc('month', p_service_date) + interval '1 month - 1 day'
          ))::integer
        ELSE
          ceil(extract(day FROM p_service_date) / 7.0)::integer = (p_rule).ordinal
      END
    WHEN 'custom_weekly' THEN
      (p_rule).effective_from IS NOT NULL
      AND p_service_date >= (p_rule).effective_from
      AND COALESCE((p_rule).interval_weeks, 0) BETWEEN 1 AND 52
      AND extract(dow FROM p_service_date)::smallint =
          ANY(COALESCE((p_rule).weekdays, '{}'::smallint[]))
      AND (
        ((p_service_date - date_trunc('week', (p_rule).effective_from)::date) / 7)
        % (p_rule).interval_weeks::integer
      ) = 0
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.gms_availability_rule_matches(
  public.servant_availability_rules, date
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.gms_availability_rule_matches(
  public.servant_availability_rules, date
) IS
'Matches legacy recurring availability patterns and custom_weekly rules using weekdays plus a Monday-anchored interval_weeks cycle.';

DO $migration$
DECLARE
  v_fn record;
  v_definition text;
  v_rewritten text;
  v_updated_functions integer := 0;
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname <> 'gms_availability_rule_matches'
      AND pg_get_functiondef(p.oid)
          LIKE '%public.gms_availability_rule_matches(%'
    ORDER BY p.proname, p.oid
  LOOP
    v_definition := pg_get_functiondef(v_fn.oid);
    v_rewritten := regexp_replace(
      v_definition,
      $pattern$public\.gms_availability_rule_matches\(\s*([[:alpha:]_][[:alnum:]_]*)\.pattern,\s*([^,]+),\s*\1\.weekday,\s*\1\.ordinal\s*\)$pattern$,
      $replacement$public.gms_availability_rule_matches(\1, \2)$replacement$,
      'g'
    );

    IF v_rewritten = v_definition THEN
      RAISE EXCEPTION
        'Could not upgrade recurring availability matcher calls in function %',
        v_fn.proname;
    END IF;

    IF regexp_count(
      v_rewritten,
      $pattern$public\.gms_availability_rule_matches\(\s*[[:alpha:]_][[:alnum:]_]*\.pattern,$pattern$
    ) > 0 THEN
      RAISE EXCEPTION
        'An old recurring availability matcher call remains in function %',
        v_fn.proname;
    END IF;

    EXECUTE v_rewritten;
    v_updated_functions := v_updated_functions + 1;
  END LOOP;

  IF v_updated_functions < 1 THEN
    RAISE EXCEPTION 'No recurring availability matcher callers were upgraded';
  END IF;
END;
$migration$;

DROP TRIGGER IF EXISTS gms_guard_recurring_availability_write_trigger
  ON public.servant_availability_rules;

CREATE TRIGGER gms_guard_recurring_availability_write_trigger
BEFORE INSERT OR DELETE OR UPDATE OF
  servant_id,
  pattern,
  status,
  effective_from,
  effective_until,
  weekday,
  ordinal,
  weekdays,
  interval_weeks
ON public.servant_availability_rules
FOR EACH ROW
EXECUTE FUNCTION public.gms_guard_recurring_availability_write();

COMMENT ON TRIGGER gms_guard_recurring_availability_write_trigger
  ON public.servant_availability_rules IS
'Enforces recurring unavailability changes, including custom weekdays and week intervals, against existing assignments.';

COMMIT;
