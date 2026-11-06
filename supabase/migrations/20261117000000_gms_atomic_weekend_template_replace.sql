-- Transactional weekend-template replacement.
-- Existing matching service slots are revalidated as one final state before any
-- times are changed. Assignment IDs are retained and confirmations reset.
CREATE OR REPLACE FUNCTION public.admin_replace_weekend_schedules_atomic(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_total integer;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_lock record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can replace weekend schedules';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Replacement rows must be supplied as an array';
  END IF;

  v_total := jsonb_array_length(p_rows);
  IF v_total = 0 THEN
    RAISE EXCEPTION 'Select at least one weekend service to replace';
  END IF;
  IF v_total > 500 THEN
    RAISE EXCEPTION 'A single weekend replacement is limited to 500 service rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) AS expanded(entry)
    WHERE jsonb_typeof(entry) <> 'object'
       OR NULLIF(pg_catalog.btrim(entry->>'service_date'), '') IS NULL
       OR NULLIF(pg_catalog.btrim(entry->>'location_id'), '') IS NULL
       OR NULLIF(pg_catalog.btrim(entry->>'service_name'), '') IS NULL
       OR NULLIF(pg_catalog.btrim(entry->>'start_time'), '') IS NULL
       OR NULLIF(pg_catalog.btrim(entry->>'end_time'), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Every replacement row requires a date, church, service name, start time and end time';
  END IF;

  CREATE TEMPORARY TABLE IF NOT EXISTS gms_weekend_replace_stage (
    service_date date NOT NULL,
    location_id uuid NOT NULL,
    service_name text NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    schedule_id uuid,
    previous_start_time time,
    previous_end_time time,
    PRIMARY KEY (service_date, location_id, service_name)
  ) ON COMMIT DROP;

  TRUNCATE TABLE pg_temp.gms_weekend_replace_stage;

  INSERT INTO pg_temp.gms_weekend_replace_stage (
    service_date, location_id, service_name, start_time, end_time
  )
  SELECT
    (entry->>'service_date')::date,
    (entry->>'location_id')::uuid,
    pg_catalog.btrim(entry->>'service_name'),
    (entry->>'start_time')::time,
    (entry->>'end_time')::time
  FROM jsonb_array_elements(p_rows) AS expanded(entry);

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_weekend_replace_stage
    WHERE start_time >= end_time
  ) THEN
    RAISE EXCEPTION 'Every replacement service must end after it starts';
  END IF;

  -- Insert only missing natural-key slots as drafts. A concurrent add/replace
  -- using the same key is serialized by the unique constraint; the following
  -- row-lock pass then reads the winning row before validation.
  INSERT INTO public.schedules (
    service_date, location_id, service_name, start_time, end_time, status
  )
  SELECT service_date, location_id, service_name, start_time, end_time, 'draft'
  FROM pg_temp.gms_weekend_replace_stage
  ORDER BY service_date, location_id, service_name
  ON CONFLICT (service_date, location_id, service_name) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Lock every target service in a stable order, then capture its current
  -- time window. No existing slot is changed before the full batch validates.
  PERFORM s.id
  FROM public.schedules s
  JOIN pg_temp.gms_weekend_replace_stage st
    ON st.service_date = s.service_date
   AND st.location_id = s.location_id
   AND st.service_name = s.service_name
  ORDER BY s.id
  FOR UPDATE OF s;

  UPDATE pg_temp.gms_weekend_replace_stage st
     SET schedule_id = s.id,
         previous_start_time = s.start_time,
         previous_end_time = s.end_time
  FROM public.schedules s
  WHERE st.service_date = s.service_date
    AND st.location_id = s.location_id
    AND st.service_name = s.service_name;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_weekend_replace_stage
    WHERE schedule_id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more target services could not be locked. Refresh and try again';
  END IF;

  -- Lock all current assignment rows after their parent schedules, matching
  -- the schedule editor's lock order.
  PERFORM a.id
  FROM public.assignments a
  JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = a.schedule_id
  ORDER BY a.id
  FOR UPDATE OF a;

  IF EXISTS (
    SELECT 1
    FROM public.serving_requests r
    WHERE r.status = 'pending'
      AND (
        r.schedule_id IN (SELECT schedule_id FROM pg_temp.gms_weekend_replace_stage)
        OR r.target_schedule_id IN (SELECT schedule_id FROM pg_temp.gms_weekend_replace_stage)
      )
  ) THEN
    RAISE EXCEPTION
      'Resolve pending replacement or swap requests for the selected services before replacing their times';
  END IF;

  -- Acquire the same advisory locks as assignment and publication writes:
  -- conflict-key locks first (servant/date), then availability locks (servant).
  FOR v_lock IN
    SELECT DISTINCT a.servant_id, s.service_date
    FROM public.assignments a
    JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = a.schedule_id
    JOIN public.schedules s ON s.id = a.schedule_id
    ORDER BY a.servant_id, s.service_date
  LOOP
    PERFORM public.gms_lock_assignment_conflict_keys(
      NULL, NULL, v_lock.servant_id, v_lock.service_date
    );
  END LOOP;

  FOR v_lock IN
    SELECT DISTINCT a.servant_id
    FROM public.assignments a
    JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = a.schedule_id
    ORDER BY a.servant_id
  LOOP
    PERFORM public.gms_lock_availability_servants(NULL, v_lock.servant_id);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = s.id
    JOIN public.servants v ON v.id = a.servant_id
    WHERE v.active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'A selected servant is inactive or no longer exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = s.id
    JOIN public.servant_availability av
      ON av.servant_id = a.servant_id
     AND av.service_date = s.service_date
     AND av.status = 'unavailable'
  ) THEN
    RAISE EXCEPTION 'A selected servant is marked unavailable on the service date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = s.id
    JOIN public.servant_availability_rules r
      ON r.servant_id = a.servant_id
     AND r.status = 'unavailable'
     AND r.effective_from <= s.service_date
     AND (r.effective_until IS NULL OR r.effective_until >= s.service_date)
     AND public.gms_availability_rule_matches(
       r.pattern, s.service_date, r.weekday, r.ordinal
     )
  ) THEN
    RAISE EXCEPTION 'A selected servant is unavailable under a recurring rule';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = s.id
    WHERE NOT public.gms_servant_matches_preferences(
      a.servant_id,
      s.service_date,
      s.location_id,
      s.service_name,
      st.start_time,
      st.end_time
    )
  ) THEN
    RAISE EXCEPTION 'A selected servant does not match their serving eligibility rules';
  END IF;

  -- Same-day cross-church conflicts include other target slots in this batch.
  IF EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = s.id
    JOIN public.assignments other_a
      ON other_a.servant_id = a.servant_id
     AND other_a.id <> a.id
    JOIN public.schedules other_s ON other_s.id = other_a.schedule_id
    WHERE other_s.service_date = s.service_date
      AND other_s.location_id <> s.location_id
  ) THEN
    RAISE EXCEPTION 'A selected servant is already assigned at another church location on the same date';
  END IF;

  -- Compare each target slot against the final replacement window of any
  -- other target slot, and the current window of every non-target service.
  IF EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.schedules s ON s.id = a.schedule_id
    JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = s.id
    JOIN public.assignments other_a
      ON other_a.servant_id = a.servant_id
     AND other_a.id <> a.id
    JOIN public.schedules other_s ON other_s.id = other_a.schedule_id
    LEFT JOIN pg_temp.gms_weekend_replace_stage other_st
      ON other_st.schedule_id = other_s.id
    WHERE other_s.service_date = s.service_date
      AND other_s.location_id = s.location_id
      AND st.start_time < COALESCE(other_st.start_time, other_s.start_time)
      AND st.end_time > COALESCE(other_st.end_time, other_s.end_time)
  ) THEN
    RAISE EXCEPTION 'A selected servant has an overlapping service at this church';
  END IF;

  -- Commit all changed time windows together. Existing schedule statuses and
  -- assignment IDs remain intact; published schedule-change triggers still run.
  UPDATE public.schedules s
     SET start_time = st.start_time,
         end_time = st.end_time,
         updated_at = now()
  FROM pg_temp.gms_weekend_replace_stage st
  WHERE s.id = st.schedule_id
    AND (s.start_time, s.end_time) IS DISTINCT FROM (st.start_time, st.end_time);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Any actual time change requires reconfirmation. Assignment rows are
  -- retained, so IDs and request history continue to reference the same rows.
  UPDATE public.assignments a
     SET confirmation_status = 'pending'
  WHERE a.schedule_id IN (
    SELECT st.schedule_id
    FROM pg_temp.gms_weekend_replace_stage st
    WHERE (st.previous_start_time, st.previous_end_time)
      IS DISTINCT FROM (st.start_time, st.end_time)
  )
    AND a.confirmation_status IS DISTINCT FROM 'pending';

  RETURN v_inserted + v_updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_replace_weekend_schedules_atomic(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_replace_weekend_schedules_atomic(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_replace_weekend_schedules_atomic(jsonb) IS
'Admin-only atomic weekend-template replacement. Stages and locks every target service, validates the final set of assignments against date/time/location/service eligibility and conflicts, inserts missing services as drafts, updates changed times in one transaction, preserves assignment IDs and resets confirmations when times change.';
