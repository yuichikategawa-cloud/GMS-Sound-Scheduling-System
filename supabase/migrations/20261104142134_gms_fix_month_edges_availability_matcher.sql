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
         )) - 3
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
