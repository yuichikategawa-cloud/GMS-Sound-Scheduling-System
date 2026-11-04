CREATE OR REPLACE FUNCTION public.admin_publish_schedules_grouped(
  p_location_id uuid DEFAULT NULL::uuid,
  p_schedule_ids uuid[] DEFAULT NULL::uuid[],
  p_status text DEFAULT 'published'::text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_changed integer;
  v_user record;
  v_count integer;
  v_title text;
  v_body text;
  v_type text;
  v_lock record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can publish schedules';
  END IF;

  IF p_status NOT IN ('published','draft') THEN
    RAISE EXCEPTION 'Invalid schedule status';
  END IF;

  CREATE TEMPORARY TABLE IF NOT EXISTS gms_publish_candidates (
    schedule_id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  CREATE TEMPORARY TABLE IF NOT EXISTS gms_publish_changed (
    schedule_id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  TRUNCATE TABLE pg_temp.gms_publish_candidates;
  TRUNCATE TABLE pg_temp.gms_publish_changed;

  -- Lock the exact schedules whose status will change.
  INSERT INTO pg_temp.gms_publish_candidates(schedule_id)
  SELECT s.id
  FROM public.schedules s
  WHERE s.status IS DISTINCT FROM p_status
    AND (p_location_id IS NULL OR s.location_id = p_location_id)
    AND (p_schedule_ids IS NULL OR s.id = ANY(p_schedule_ids))
  ORDER BY s.id
  FOR UPDATE OF s;

  -- NULL location + NULL schedule IDs intentionally means all church locations,
  -- matching the existing bulk-publish UI.
  IF p_status = 'published' THEN
    -- Acquire conflict locks for every affected servant/date in a stable order,
    -- then availability locks, matching the assignment-trigger lock order.
    FOR v_lock IN
      SELECT DISTINCT a.servant_id, s.service_date
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      WHERE s.id IN (SELECT schedule_id FROM pg_temp.gms_publish_candidates)
      ORDER BY a.servant_id, s.service_date
    LOOP
      PERFORM public.gms_lock_assignment_conflict_keys(
        NULL, NULL, v_lock.servant_id, v_lock.service_date
      );
    END LOOP;

    FOR v_lock IN
      SELECT DISTINCT a.servant_id
      FROM public.assignments a
      WHERE a.schedule_id IN (SELECT schedule_id FROM pg_temp.gms_publish_candidates)
      ORDER BY a.servant_id
    LOOP
      PERFORM public.gms_lock_availability_servants(NULL, v_lock.servant_id);
    END LOOP;

    -- A published service cannot contain an inactive servant.
    IF EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      JOIN public.servants v ON v.id = a.servant_id
      WHERE s.id IN (SELECT schedule_id FROM pg_temp.gms_publish_candidates)
        AND v.active IS DISTINCT FROM true
    ) THEN
      RAISE EXCEPTION
        'Cannot publish: one or more assigned servants are inactive. Review the assignments first.';
    END IF;

    -- Recheck dated and recurring hard-unavailability at publish time.
    IF EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      JOIN public.servant_availability av
        ON av.servant_id = a.servant_id
       AND av.service_date = s.service_date
       AND av.status = 'unavailable'
      WHERE s.id IN (SELECT schedule_id FROM pg_temp.gms_publish_candidates)
    ) THEN
      RAISE EXCEPTION
        'Cannot publish: one or more assigned servants are marked unavailable on the service date.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      JOIN public.servant_availability_rules r
        ON r.servant_id = a.servant_id
       AND r.status = 'unavailable'
       AND r.effective_from <= s.service_date
       AND (r.effective_until IS NULL OR r.effective_until >= s.service_date)
       AND public.gms_availability_rule_matches(
         r.pattern, s.service_date, r.weekday, r.ordinal
       )
      WHERE s.id IN (SELECT schedule_id FROM pg_temp.gms_publish_candidates)
    ) THEN
      RAISE EXCEPTION
        'Cannot publish: one or more assigned servants are unavailable under a recurring rule.';
    END IF;

    -- Recheck active serving preferences at the final publication boundary.
    IF EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      WHERE s.id IN (SELECT schedule_id FROM pg_temp.gms_publish_candidates)
        AND NOT public.gms_servant_matches_preferences(
          a.servant_id,
          s.service_date,
          s.location_id,
          s.service_name,
          s.start_time,
          s.end_time
        )
    ) THEN
      RAISE EXCEPTION
        'Cannot publish: one or more assigned servants do not match their serving eligibility rules.';
    END IF;

    -- Enforce the one-church-per-day rule against all other assignments,
    -- including other schedules in the same publishing batch.
    IF EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      JOIN public.assignments other_a
        ON other_a.servant_id = a.servant_id
       AND other_a.id <> a.id
      JOIN public.schedules other_s ON other_s.id = other_a.schedule_id
      WHERE s.id IN (SELECT schedule_id FROM pg_temp.gms_publish_candidates)
        AND s.service_date = other_s.service_date
        AND s.location_id <> other_s.location_id
    ) THEN
      RAISE EXCEPTION
        'Cannot publish: one or more servants are assigned at another church location on the same date.';
    END IF;

    -- Enforce non-overlapping services at the same church.
    IF EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      JOIN public.assignments other_a
        ON other_a.servant_id = a.servant_id
       AND other_a.id <> a.id
      JOIN public.schedules other_s ON other_s.id = other_a.schedule_id
      WHERE s.id IN (SELECT schedule_id FROM pg_temp.gms_publish_candidates)
        AND s.service_date = other_s.service_date
        AND s.location_id = other_s.location_id
        AND s.start_time < other_s.end_time
        AND s.end_time > other_s.start_time
    ) THEN
      RAISE EXCEPTION
        'Cannot publish: one or more servants have overlapping services at the same church.';
    END IF;
  END IF;

  PERFORM set_config('gms.suppress_assignment_notifications', 'on', true);

  WITH changed AS (
    UPDATE public.schedules s
       SET status = p_status
     WHERE s.id IN (SELECT schedule_id FROM pg_temp.gms_publish_candidates)
       AND s.status IS DISTINCT FROM p_status
    RETURNING s.id
  )
  INSERT INTO pg_temp.gms_publish_changed(schedule_id)
  SELECT id FROM changed;

  SELECT count(*) INTO v_changed
  FROM pg_temp.gms_publish_changed;

  IF v_changed = 0 THEN
    RETURN 0;
  END IF;

  v_title := CASE
    WHEN p_status = 'published' THEN 'Serving schedule published'
    ELSE 'Serving schedule unpublished'
  END;
  v_type := CASE
    WHEN p_status = 'published' THEN 'new_assignment'
    ELSE 'schedule_unpublished'
  END;

  FOR v_user IN
    SELECT v.auth_user_id, count(DISTINCT s.id)::integer AS service_count
    FROM public.schedules s
    JOIN public.assignments a ON a.schedule_id = s.id
    JOIN public.servants v ON v.id = a.servant_id
    WHERE v.auth_user_id IS NOT NULL
      AND s.id IN (SELECT schedule_id FROM pg_temp.gms_publish_changed)
    GROUP BY v.auth_user_id
  LOOP
    v_body := CASE
      WHEN p_status = 'published'
        THEN 'Your serving schedule has been published with '
          || v_user.service_count
          || ' service assignment(s). Open GMS to review all dates, locations and roles.'
      ELSE 'Your published schedule has been updated. '
        || v_user.service_count
        || ' service assignment(s) are now drafts. Open GMS to review.'
    END;

    PERFORM public.gms_emit_serving_notification(
      v_user.auth_user_id,
      v_title,
      v_body,
      v_type,
      'grouped-publish:' || txid_current() || ':' || v_user.auth_user_id::text,
      NULL,
      NULL
    );
  END LOOP;

  RETURN v_changed;
END;
$function$;
