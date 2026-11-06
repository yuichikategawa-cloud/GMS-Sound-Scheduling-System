-- Atomically replace generated weekend service times without bypassing assignment integrity.
-- This is an additive RPC. It does not alter tables, constraints, RLS policies or triggers.
-- Replace mode is safe only when the entire set validates and commits in this transaction.

CREATE OR REPLACE FUNCTION public.admin_replace_generated_weekend_schedules(
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_total integer;
  v_lock record;
  v_user record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can replace generated weekend schedules';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Weekend replacement rows must be supplied as an array';
  END IF;

  v_total := jsonb_array_length(p_rows);
  IF v_total < 1 THEN
    RAISE EXCEPTION 'Select at least one weekend service to replace';
  END IF;
  IF v_total > 500 THEN
    RAISE EXCEPTION 'A single weekend replacement is limited to 500 service rows';
  END IF;

  CREATE TEMPORARY TABLE IF NOT EXISTS gms_weekend_replace_stage (
    service_date date NOT NULL,
    location_id uuid NOT NULL,
    service_name text NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    schedule_id uuid,
    old_status text,
    metadata_changed boolean NOT NULL DEFAULT false,
    PRIMARY KEY (service_date, location_id, service_name)
  ) ON COMMIT DROP;

  CREATE TEMPORARY TABLE IF NOT EXISTS gms_weekend_replace_recipients (
    user_id uuid PRIMARY KEY,
    service_count integer NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE pg_temp.gms_weekend_replace_stage;
  TRUNCATE TABLE pg_temp.gms_weekend_replace_recipients;

  INSERT INTO pg_temp.gms_weekend_replace_stage(
    service_date, location_id, service_name, start_time, end_time
  )
  SELECT
    item.service_date,
    item.location_id,
    pg_catalog.btrim(item.service_name),
    item.start_time,
    item.end_time
  FROM pg_catalog.jsonb_to_recordset(p_rows) AS item(
    service_date date,
    location_id uuid,
    service_name text,
    start_time time,
    end_time time
  );

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_weekend_replace_stage
    WHERE service_name = ''
       OR start_time >= end_time
       OR extract(dow FROM service_date) NOT IN (0, 6)
  ) THEN
    RAISE EXCEPTION 'Each replacement row must contain a weekend date, service name and valid time range';
  END IF;

  -- Create missing slots as drafts. Existing rows are matched with the same
  -- natural key used by the Add mode upsert; no existing assignments are touched.
  INSERT INTO public.schedules(
    service_date, location_id, service_name, start_time, end_time, status
  )
  SELECT
    st.service_date, st.location_id, st.service_name,
    st.start_time, st.end_time, 'draft'
  FROM pg_temp.gms_weekend_replace_stage st
  ORDER BY st.service_date, st.location_id, st.service_name
  ON CONFLICT (service_date, location_id, service_name) DO NOTHING;

  UPDATE pg_temp.gms_weekend_replace_stage st
     SET schedule_id = s.id,
         old_status = s.status
  FROM public.schedules s
  WHERE s.service_date = st.service_date
    AND s.location_id = st.location_id
    AND s.service_name = st.service_name;

  IF (SELECT count(*) FROM pg_temp.gms_weekend_replace_stage WHERE schedule_id IS NOT NULL) <> v_total THEN
    RAISE EXCEPTION 'One or more generated service slots could not be resolved';
  END IF;

  -- Follow the same lock order as the existing atomic schedule editor:
  -- schedule rows, assignment rows, conflict-key locks, then availability locks.
  PERFORM s.id
  FROM public.schedules s
  JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = s.id
  ORDER BY s.id
  FOR UPDATE OF s;

  -- Re-read after acquiring row locks so metadata comparisons and publication
  -- decisions use the latest committed schedule version.
  UPDATE pg_temp.gms_weekend_replace_stage st
     SET old_status = s.status,
         metadata_changed =
           s.service_date IS DISTINCT FROM st.service_date
           OR s.location_id IS DISTINCT FROM st.location_id
           OR s.service_name IS DISTINCT FROM st.service_name
           OR s.start_time IS DISTINCT FROM st.start_time
           OR s.end_time IS DISTINCT FROM st.end_time
  FROM public.schedules s
  WHERE s.id = st.schedule_id;

  PERFORM a.id
  FROM public.assignments a
  JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = a.schedule_id
  ORDER BY a.id
  FOR UPDATE OF a;

  -- Do not invalidate an unresolved request by changing its source or target service.
  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_weekend_replace_stage st
    JOIN public.serving_requests r
      ON r.status = 'pending'
     AND (r.schedule_id = st.schedule_id OR r.target_schedule_id = st.schedule_id)
    WHERE st.metadata_changed
  ) THEN
    RAISE EXCEPTION
      'Resolve pending replacement or swap requests for the affected services before replacing their times';
  END IF;

  FOR v_lock IN
    SELECT DISTINCT scope.servant_id, scope.service_date
    FROM (
      SELECT a.servant_id, s.service_date
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = s.id
      WHERE st.metadata_changed
      UNION
      SELECT a.servant_id, st.service_date
      FROM public.assignments a
      JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = a.schedule_id
      WHERE st.metadata_changed
    ) AS scope
    ORDER BY scope.servant_id, scope.service_date
  LOOP
    PERFORM public.gms_lock_assignment_conflict_keys(
      NULL, NULL, v_lock.servant_id, v_lock.service_date
    );
  END LOOP;

  FOR v_lock IN
    SELECT DISTINCT a.servant_id
    FROM public.assignments a
    JOIN pg_temp.gms_weekend_replace_stage st ON st.schedule_id = a.schedule_id
    WHERE st.metadata_changed
    ORDER BY a.servant_id
  LOOP
    PERFORM public.gms_lock_availability_servants(NULL, v_lock.servant_id);
  END LOOP;

  -- Revalidate the complete final assignment set for each changed service.
  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_weekend_replace_stage st
    JOIN public.assignments a ON a.schedule_id = st.schedule_id
    LEFT JOIN public.servants v ON v.id = a.servant_id
    WHERE st.metadata_changed
      AND (v.id IS NULL OR v.active IS DISTINCT FROM true)
  ) THEN
    RAISE EXCEPTION 'A selected servant is inactive or no longer exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_weekend_replace_stage st
    JOIN public.assignments a ON a.schedule_id = st.schedule_id
    JOIN public.servant_availability av
      ON av.servant_id = a.servant_id
     AND av.service_date = st.service_date
     AND av.status = 'unavailable'
    WHERE st.metadata_changed
  ) THEN
    RAISE EXCEPTION 'A selected servant is marked unavailable on the replacement service date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_weekend_replace_stage st
    JOIN public.assignments a ON a.schedule_id = st.schedule_id
    JOIN public.servant_availability_rules r
      ON r.servant_id = a.servant_id
     AND r.status = 'unavailable'
     AND r.effective_from <= st.service_date
     AND (r.effective_until IS NULL OR r.effective_until >= st.service_date)
     AND public.gms_availability_rule_matches(
       r.pattern, st.service_date, r.weekday, r.ordinal
     )
    WHERE st.metadata_changed
  ) THEN
    RAISE EXCEPTION 'A selected servant is unavailable under a recurring rule';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_weekend_replace_stage st
    JOIN public.assignments a ON a.schedule_id = st.schedule_id
    WHERE st.metadata_changed
      AND NOT public.gms_servant_matches_preferences(
        a.servant_id, st.service_date, st.location_id,
        st.service_name, st.start_time, st.end_time
      )
  ) THEN
    RAISE EXCEPTION 'A selected servant does not match their serving eligibility rules';
  END IF;

  -- Compare the affected slots with the final metadata of every other affected
  -- slot, and with current metadata for schedules outside this batch. This
  -- permits valid time swaps inside the batch but rejects final-state conflicts.
  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_weekend_replace_stage st
    JOIN public.assignments a ON a.schedule_id = st.schedule_id
    JOIN public.assignments other_a
      ON other_a.servant_id = a.servant_id
     AND other_a.id <> a.id
    JOIN public.schedules other_s ON other_s.id = other_a.schedule_id
    LEFT JOIN pg_temp.gms_weekend_replace_stage other_st
      ON other_st.schedule_id = other_s.id
    WHERE st.metadata_changed
      AND st.service_date = COALESCE(other_st.service_date, other_s.service_date)
      AND st.location_id <> COALESCE(other_st.location_id, other_s.location_id)
  ) THEN
    RAISE EXCEPTION
      'A selected servant is already assigned at another church location on the same date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_weekend_replace_stage st
    JOIN public.assignments a ON a.schedule_id = st.schedule_id
    JOIN public.assignments other_a
      ON other_a.servant_id = a.servant_id
     AND other_a.id <> a.id
    JOIN public.schedules other_s ON other_s.id = other_a.schedule_id
    LEFT JOIN pg_temp.gms_weekend_replace_stage other_st
      ON other_st.schedule_id = other_s.id
    WHERE st.metadata_changed
      AND st.service_date = COALESCE(other_st.service_date, other_s.service_date)
      AND st.location_id = COALESCE(other_st.location_id, other_s.location_id)
      AND st.start_time < COALESCE(other_st.end_time, other_s.end_time)
      AND st.end_time > COALESCE(other_st.start_time, other_s.start_time)
  ) THEN
    RAISE EXCEPTION
      'A selected servant has an overlapping service at the same church';
  END IF;

  -- Collect one notification per account for all previously published services
  -- that are changing. Per-row schedule notifications are suppressed below.
  INSERT INTO pg_temp.gms_weekend_replace_recipients(user_id, service_count)
  SELECT sv.auth_user_id, count(DISTINCT st.schedule_id)::integer
  FROM pg_temp.gms_weekend_replace_stage st
  JOIN public.assignments a ON a.schedule_id = st.schedule_id
  JOIN public.servants sv ON sv.id = a.servant_id
  WHERE st.metadata_changed
    AND st.old_status = 'published'
    AND sv.auth_user_id IS NOT NULL
  GROUP BY sv.auth_user_id;

  PERFORM pg_catalog.set_config('gms.suppress_assignment_notifications', 'on', true);

  -- Published services move back to draft when their metadata changes.
  -- Assignment IDs remain intact, but every assigned servant must reconfirm.
  UPDATE public.schedules s
     SET service_date = st.service_date,
         location_id = st.location_id,
         service_name = st.service_name,
         start_time = st.start_time,
         end_time = st.end_time,
         status = CASE WHEN st.old_status = 'published' THEN 'draft' ELSE s.status END,
         updated_at = pg_catalog.now()
  FROM pg_temp.gms_weekend_replace_stage st
  WHERE s.id = st.schedule_id
    AND st.metadata_changed;

  UPDATE public.assignments a
     SET confirmation_status = 'pending'
  FROM pg_temp.gms_weekend_replace_stage st
  WHERE st.schedule_id = a.schedule_id
    AND st.metadata_changed
    AND a.confirmation_status IS DISTINCT FROM 'pending';

  FOR v_user IN
    SELECT user_id, service_count
    FROM pg_temp.gms_weekend_replace_recipients
    ORDER BY user_id
  LOOP
    PERFORM public.gms_emit_serving_notification(
      v_user.user_id,
      'Serving schedule updated',
      'Your published schedule changed and moved back to draft. '
        || v_user.service_count
        || ' service(s) need your reconfirmation. Open GMS to review the updated times.',
      'schedule_unpublished',
      'weekend-replace:' || pg_catalog.txid_current() || ':' || v_user.user_id::text,
      NULL,
      NULL
    );
  END LOOP;

  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_replace_generated_weekend_schedules(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_replace_generated_weekend_schedules(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_replace_generated_weekend_schedules(jsonb) IS
'Admin-only transactional weekend-template replacement. Stages all requested slots, locks and validates the final assignment state, preserves assignment IDs, resets confirmations and moves changed published services to draft before committing the entire batch.';
