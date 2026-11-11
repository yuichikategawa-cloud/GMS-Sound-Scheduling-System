-- Apply an administrator-reviewed monthly assignment plan additively.
-- This function creates missing service rows as drafts and inserts only vacant
-- role assignments. It never updates or deletes an existing schedule/assignment.
--
-- The browser supplies an exact snapshot of each target draft service and its
-- existing assignment IDs/confirmation states. The RPC locks and compares that
-- snapshot before writing, then revalidates the complete final assignment set
-- against current availability, recurring rules, preferences and conflicts.
--
-- The RPC is intentionally separate from admin_bulk_assignments_grouped:
-- monthly generation must never replace a manually assigned role.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_apply_monthly_schedule_plan(
  p_month_start date,
  p_expected_state jsonb,
  p_plan jsonb,
  p_acknowledged_prefer_not boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_month_end date;
  v_expected_count integer;
  v_new_count integer;
  v_created_count integer := 0;
  v_plan_count integer := 0;
  v_inserted_count integer := 0;
  v_lock record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can apply a monthly schedule plan';
  END IF;

  IF p_month_start IS NULL
     OR p_month_start <> pg_catalog.date_trunc('month', p_month_start)::date THEN
    RAISE EXCEPTION 'The monthly plan must start on the first day of a month';
  END IF;

  IF p_expected_state IS NULL OR pg_catalog.jsonb_typeof(p_expected_state) <> 'array' THEN
    RAISE EXCEPTION 'The expected monthly schedule snapshot must be an array';
  END IF;

  IF p_plan IS NULL OR pg_catalog.jsonb_typeof(p_plan) <> 'array' THEN
    RAISE EXCEPTION 'The proposed assignments must be an array';
  END IF;

  v_expected_count := pg_catalog.jsonb_array_length(p_expected_state);
  v_plan_count := pg_catalog.jsonb_array_length(p_plan);
  v_month_end := (p_month_start + INTERVAL '1 month')::date;

  IF v_expected_count < 1 OR v_expected_count > 500 THEN
    RAISE EXCEPTION 'A monthly plan must contain between 1 and 500 service slots';
  END IF;

  IF v_plan_count > 500 THEN
    RAISE EXCEPTION 'A monthly plan is limited to 500 role assignments';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_expected_state) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value->'assignments') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'Every expected service snapshot must include its assignment array';
  END IF;

  CREATE TEMPORARY TABLE gms_monthly_expected_slots (
    template_id uuid NOT NULL,
    schedule_id uuid,
    service_date date NOT NULL,
    location_id uuid NOT NULL,
    service_name text NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    expected_status text NOT NULL,
    assignments jsonb NOT NULL,
    PRIMARY KEY (service_date, location_id, service_name)
  ) ON COMMIT DROP;

  CREATE TEMPORARY TABLE gms_monthly_expected_assignments (
    service_date date NOT NULL,
    location_id uuid NOT NULL,
    service_name text NOT NULL,
    assignment_id uuid PRIMARY KEY,
    role text NOT NULL,
    servant_id uuid NOT NULL,
    confirmation_status text NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMPORARY TABLE gms_monthly_plan (
    service_date date NOT NULL,
    location_id uuid NOT NULL,
    service_name text NOT NULL,
    role text NOT NULL,
    servant_id uuid NOT NULL,
    PRIMARY KEY (service_date, location_id, service_name, role)
  ) ON COMMIT DROP;

  CREATE TEMPORARY TABLE gms_monthly_created_slots (
    service_date date NOT NULL,
    location_id uuid NOT NULL,
    service_name text NOT NULL,
    schedule_id uuid NOT NULL,
    PRIMARY KEY (service_date, location_id, service_name),
    UNIQUE (schedule_id)
  ) ON COMMIT DROP;

  CREATE TEMPORARY TABLE gms_monthly_final_assignments (
    schedule_id uuid NOT NULL,
    service_date date NOT NULL,
    location_id uuid NOT NULL,
    service_name text NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    role text NOT NULL,
    servant_id uuid NOT NULL,
    source text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.gms_monthly_expected_slots(
    template_id, schedule_id, service_date, location_id, service_name,
    start_time, end_time, expected_status, assignments
  )
  SELECT
    item.template_id,
    item.schedule_id,
    item.service_date,
    item.location_id,
    pg_catalog.btrim(item.service_name),
    item.start_time,
    item.end_time,
    item.expected_status,
    COALESCE(item.assignments, '[]'::jsonb)
  FROM pg_catalog.jsonb_to_recordset(p_expected_state) AS item(
    template_id uuid,
    schedule_id uuid,
    service_date date,
    location_id uuid,
    service_name text,
    start_time time,
    end_time time,
    expected_status text,
    assignments jsonb
  );

  IF (SELECT count(*) FROM pg_temp.gms_monthly_expected_slots) <> v_expected_count THEN
    RAISE EXCEPTION 'The expected monthly service snapshot contains duplicate or invalid slots';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_expected_slots e
    WHERE e.template_id IS NULL
       OR e.service_date < p_month_start
       OR e.service_date >= v_month_end
       OR pg_catalog.extract(dow FROM e.service_date) NOT IN (0, 6)
       OR e.service_name IS NULL
       OR e.service_name = ''
       OR e.start_time >= e.end_time
       OR e.expected_status NOT IN ('new', 'draft')
       OR (e.expected_status = 'new' AND e.schedule_id IS NOT NULL)
       OR (e.expected_status = 'draft' AND e.schedule_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'The monthly service snapshot contains an invalid date, template, status or time range';
  END IF;

  INSERT INTO pg_temp.gms_monthly_expected_assignments(
    service_date, location_id, service_name, assignment_id,
    role, servant_id, confirmation_status
  )
  SELECT
    e.service_date,
    e.location_id,
    e.service_name,
    NULLIF(a.value->>'id', '')::uuid,
    a.value->>'role',
    NULLIF(a.value->>'servant_id', '')::uuid,
    a.value->>'confirmation_status'
  FROM pg_temp.gms_monthly_expected_slots e
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(e.assignments) AS a(value);

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_expected_assignments a
    WHERE a.assignment_id IS NULL
       OR a.role NOT IN ('FOH', 'Monitor', 'Assistant')
       OR a.servant_id IS NULL
       OR a.confirmation_status NOT IN ('pending', 'confirmed', 'declined')
       OR NOT EXISTS (
         SELECT 1
         FROM pg_temp.gms_monthly_expected_slots e
         WHERE e.service_date = a.service_date
           AND e.location_id = a.location_id
           AND e.service_name = a.service_name
           AND e.schedule_id IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION 'The expected assignment snapshot contains an invalid or unpersisted assignment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_expected_assignments a
    GROUP BY a.service_date, a.location_id, a.service_name, a.role
    HAVING pg_catalog.count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_expected_assignments a
    GROUP BY a.service_date, a.location_id, a.service_name, a.servant_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The expected service snapshot contains duplicate roles or servants';
  END IF;

  INSERT INTO pg_temp.gms_monthly_plan(
    service_date, location_id, service_name, role, servant_id
  )
  SELECT
    item.service_date,
    item.location_id,
    pg_catalog.btrim(item.service_name),
    item.role,
    item.servant_id
  FROM pg_catalog.jsonb_to_recordset(p_plan) AS item(
    service_date date,
    location_id uuid,
    service_name text,
    role text,
    servant_id uuid
  );

  IF (SELECT count(*) FROM pg_temp.gms_monthly_plan) <> v_plan_count THEN
    RAISE EXCEPTION 'The proposed assignment list contains duplicate or invalid rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_plan p
    WHERE p.service_date < p_month_start
       OR p.service_date >= v_month_end
       OR p.role NOT IN ('FOH', 'Monitor', 'Assistant')
       OR p.servant_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_temp.gms_monthly_expected_slots e
         WHERE e.service_date = p.service_date
           AND e.location_id = p.location_id
           AND e.service_name = p.service_name
       )
  ) THEN
    RAISE EXCEPTION 'A proposed assignment does not belong to the reviewed monthly service snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_plan p
    JOIN pg_temp.gms_monthly_expected_slots e
      ON e.service_date = p.service_date
     AND e.location_id = p.location_id
     AND e.service_name = p.service_name
    WHERE e.expected_status <> 'new'
      AND e.schedule_id IS NULL
  ) THEN
    RAISE EXCEPTION 'The monthly plan contains an invalid draft service reference';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_plan p
    JOIN pg_temp.gms_monthly_expected_assignments a
      ON a.service_date = p.service_date
     AND a.location_id = p.location_id
     AND a.service_name = p.service_name
     AND a.role = p.role
  ) THEN
    RAISE EXCEPTION 'A proposed role is no longer vacant in the reviewed snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_plan p
    GROUP BY p.service_date, p.location_id, p.service_name, p.servant_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The same servant cannot fill multiple roles in one service';
  END IF;

  -- Lock existing schedule rows first, matching the established GMS mutation order.
  PERFORM s.id
  FROM public.schedules s
  JOIN pg_temp.gms_monthly_expected_slots e ON e.schedule_id = s.id
  ORDER BY s.id
  FOR UPDATE OF s;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.schedules s
    JOIN pg_temp.gms_monthly_expected_slots e ON e.schedule_id = s.id
  ) <> (
    SELECT pg_catalog.count(*)
    FROM pg_temp.gms_monthly_expected_slots
    WHERE schedule_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The monthly schedule preview is stale: a selected service no longer exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_expected_slots e
    JOIN public.schedules s ON s.id = e.schedule_id
    WHERE s.service_date IS DISTINCT FROM e.service_date
       OR s.location_id IS DISTINCT FROM e.location_id
       OR s.service_name IS DISTINCT FROM e.service_name
       OR s.start_time IS DISTINCT FROM e.start_time
       OR s.end_time IS DISTINCT FROM e.end_time
       OR s.status IS DISTINCT FROM 'draft'
  ) THEN
    RAISE EXCEPTION 'The monthly schedule preview is stale: service details or publication state changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_expected_slots e
    JOIN public.schedules s
      ON s.service_date = e.service_date
     AND s.location_id = e.location_id
     AND s.service_name = e.service_name
    WHERE e.schedule_id IS NULL
  ) THEN
    RAISE EXCEPTION 'The monthly schedule preview is stale: a new service was created after preview';
  END IF;

  -- Lock every assignment row belonging to the selected draft services.
  PERFORM a.id
  FROM public.assignments a
  JOIN pg_temp.gms_monthly_expected_slots e ON e.schedule_id = a.schedule_id
  ORDER BY a.id
  FOR UPDATE OF a;

  -- Compare both directions so new, removed, reassigned or reconfirmed rows
  -- invalidate the preview. Existing IDs and confirmation states are immutable.
  IF EXISTS (
    (
      SELECT
        s.service_date, s.location_id, s.service_name,
        a.id, a.role, a.servant_id, a.confirmation_status
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      JOIN pg_temp.gms_monthly_expected_slots e ON e.schedule_id = s.id
    )
    EXCEPT
    (
      SELECT
        x.service_date, x.location_id, x.service_name,
        x.assignment_id, x.role, x.servant_id, x.confirmation_status
      FROM pg_temp.gms_monthly_expected_assignments x
    )
  ) OR EXISTS (
    (
      SELECT
        x.service_date, x.location_id, x.service_name,
        x.assignment_id, x.role, x.servant_id, x.confirmation_status
      FROM pg_temp.gms_monthly_expected_assignments x
    )
    EXCEPT
    (
      SELECT
        s.service_date, s.location_id, s.service_name,
        a.id, a.role, a.servant_id, a.confirmation_status
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      JOIN pg_temp.gms_monthly_expected_slots e ON e.schedule_id = s.id
    )
  ) THEN
    RAISE EXCEPTION 'The monthly schedule preview is stale: existing assignments or confirmations changed';
  END IF;

  -- Freeze any service that acquired a pending swap or replacement after preview.
  IF EXISTS (
    SELECT 1
    FROM public.serving_requests r
    JOIN pg_temp.gms_monthly_expected_slots e
      ON e.schedule_id = r.schedule_id OR e.schedule_id = r.target_schedule_id
    WHERE r.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Resolve pending replacement or swap requests before applying this monthly plan';
  END IF;

  -- Template rows are also locked and rechecked. New schedules must still match
  -- the currently active weekend template; existing schedules may retain a
  -- manually customized time range.
  PERFORM t.id
  FROM public.service_templates t
  JOIN pg_temp.gms_monthly_expected_slots e ON e.template_id = t.id
  ORDER BY t.id
  FOR SHARE OF t;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_expected_slots e
    LEFT JOIN public.service_templates t ON t.id = e.template_id
    WHERE t.id IS NULL
       OR t.active IS DISTINCT FROM true
       OR t.location_id IS DISTINCT FROM e.location_id
       OR t.service_name IS DISTINCT FROM e.service_name
       OR t.day_of_week IS DISTINCT FROM pg_catalog.extract(dow FROM e.service_date)::smallint
       OR (
         e.expected_status = 'new'
         AND (
           t.start_time IS DISTINCT FROM e.start_time
           OR t.end_time IS DISTINCT FROM e.end_time
         )
       )
  ) THEN
    RAISE EXCEPTION 'The monthly schedule preview is stale: one or more service templates changed';
  END IF;

  -- Insert missing service rows as drafts. ON CONFLICT is only a race guard:
  -- if another administrator created one after preview, the count mismatch
  -- below rejects the entire transaction instead of adopting or modifying it.
  WITH inserted AS (
    INSERT INTO public.schedules(
      service_date, location_id, service_name, start_time, end_time, status
    )
    SELECT
      e.service_date, e.location_id, e.service_name,
      e.start_time, e.end_time, 'draft'
    FROM pg_temp.gms_monthly_expected_slots e
    WHERE e.expected_status = 'new'
    ORDER BY e.service_date, e.location_id, e.service_name
    ON CONFLICT (service_date, location_id, service_name) DO NOTHING
    RETURNING id, service_date, location_id, service_name
  )
  INSERT INTO pg_temp.gms_monthly_created_slots(
    service_date, location_id, service_name, schedule_id
  )
  SELECT service_date, location_id, service_name, id
  FROM inserted;

  GET DIAGNOSTICS v_created_count = ROW_COUNT;

  SELECT pg_catalog.count(*)
    INTO v_new_count
  FROM pg_temp.gms_monthly_expected_slots
  WHERE expected_status = 'new';

  IF v_created_count <> v_new_count THEN
    RAISE EXCEPTION 'The monthly schedule preview is stale: a new draft service was created concurrently';
  END IF;

  UPDATE pg_temp.gms_monthly_expected_slots e
     SET schedule_id = c.schedule_id
  FROM pg_temp.gms_monthly_created_slots c
  WHERE c.service_date = e.service_date
    AND c.location_id = e.location_id
    AND c.service_name = e.service_name;

  -- Reacquire the complete schedule lock set in deterministic order.
  PERFORM s.id
  FROM public.schedules s
  JOIN pg_temp.gms_monthly_expected_slots e ON e.schedule_id = s.id
  ORDER BY s.id
  FOR UPDATE OF s;

  IF EXISTS (
    SELECT 1
    FROM public.serving_requests r
    JOIN pg_temp.gms_monthly_expected_slots e
      ON e.schedule_id = r.schedule_id OR e.schedule_id = r.target_schedule_id
    WHERE r.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Resolve pending replacement or swap requests before applying this monthly plan';
  END IF;

  -- Serialize conflict and availability writes using the same advisory-lock
  -- namespaces as existing GMS assignment and availability triggers.
  FOR v_lock IN
    SELECT DISTINCT scope.servant_id, scope.service_date
    FROM (
      SELECT a.servant_id, a.service_date
      FROM pg_temp.gms_monthly_expected_assignments a
      UNION
      SELECT p.servant_id, p.service_date
      FROM pg_temp.gms_monthly_plan p
    ) AS scope
    ORDER BY scope.servant_id, scope.service_date
  LOOP
    PERFORM public.gms_lock_assignment_conflict_keys(
      NULL, NULL, v_lock.servant_id, v_lock.service_date
    );
  END LOOP;

  FOR v_lock IN
    SELECT DISTINCT scope.servant_id
    FROM (
      SELECT a.servant_id FROM pg_temp.gms_monthly_expected_assignments a
      UNION
      SELECT p.servant_id FROM pg_temp.gms_monthly_plan p
    ) AS scope
    ORDER BY scope.servant_id
  LOOP
    PERFORM public.gms_lock_availability_servants(NULL, v_lock.servant_id);
  END LOOP;

  -- Share-lock servant rows so a concurrent deactivation cannot pass the
  -- final eligibility check while this transaction is applying the plan.
  PERFORM s.id
  FROM public.servants s
  WHERE s.id IN (
    SELECT a.servant_id FROM pg_temp.gms_monthly_expected_assignments a
    UNION
    SELECT p.servant_id FROM pg_temp.gms_monthly_plan p
  )
  ORDER BY s.id
  FOR SHARE OF s;

  -- Build the complete final assignment set for every reviewed service.
  INSERT INTO pg_temp.gms_monthly_final_assignments(
    schedule_id, service_date, location_id, service_name,
    start_time, end_time, role, servant_id, source
  )
  SELECT
    e.schedule_id, e.service_date, e.location_id, e.service_name,
    e.start_time, e.end_time, a.role, a.servant_id, 'existing'
  FROM pg_temp.gms_monthly_expected_assignments a
  JOIN pg_temp.gms_monthly_expected_slots e
    ON e.service_date = a.service_date
   AND e.location_id = a.location_id
   AND e.service_name = a.service_name;

  INSERT INTO pg_temp.gms_monthly_final_assignments(
    schedule_id, service_date, location_id, service_name,
    start_time, end_time, role, servant_id, source
  )
  SELECT
    e.schedule_id, e.service_date, e.location_id, e.service_name,
    e.start_time, e.end_time, p.role, p.servant_id, 'proposed'
  FROM pg_temp.gms_monthly_plan p
  JOIN pg_temp.gms_monthly_expected_slots e
    ON e.service_date = p.service_date
   AND e.location_id = p.location_id
   AND e.service_name = p.service_name;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments f
    LEFT JOIN public.servants s ON s.id = f.servant_id
    WHERE s.id IS NULL OR s.active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'A selected servant is inactive or no longer exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments f
    JOIN public.servant_availability av
      ON av.servant_id = f.servant_id
     AND av.service_date = f.service_date
     AND av.status = 'unavailable'
  ) THEN
    RAISE EXCEPTION 'A selected servant is marked unavailable on a service date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments f
    JOIN public.servant_availability_rules r
      ON r.servant_id = f.servant_id
     AND r.status = 'unavailable'
     AND r.effective_from <= f.service_date
     AND (r.effective_until IS NULL OR r.effective_until >= f.service_date)
     AND public.gms_availability_rule_matches(
       r.pattern, f.service_date, r.weekday, r.ordinal
     )
  ) THEN
    RAISE EXCEPTION 'A selected servant is unavailable under a recurring rule';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments f
    WHERE NOT public.gms_servant_matches_preferences(
      f.servant_id, f.service_date, f.location_id,
      f.service_name, f.start_time, f.end_time
    )
  ) THEN
    RAISE EXCEPTION 'A selected servant does not match their serving eligibility rules';
  END IF;

  IF NOT COALESCE(p_acknowledged_prefer_not, false) AND EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments f
    WHERE f.source = 'proposed'
      AND (
        EXISTS (
          SELECT 1
          FROM public.servant_availability av
          WHERE av.servant_id = f.servant_id
            AND av.service_date = f.service_date
            AND av.status = 'prefer_not'
        )
        OR EXISTS (
          SELECT 1
          FROM public.servant_availability_rules r
          WHERE r.servant_id = f.servant_id
            AND r.status = 'prefer_not'
            AND r.effective_from <= f.service_date
            AND (r.effective_until IS NULL OR r.effective_until >= f.service_date)
            AND public.gms_availability_rule_matches(
              r.pattern, f.service_date, r.weekday, r.ordinal
            )
        )
      )
  ) THEN
    RAISE EXCEPTION 'A prefer-not assignment requires administrator acknowledgement';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments f
    GROUP BY f.schedule_id, f.role
    HAVING pg_catalog.count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments f
    GROUP BY f.schedule_id, f.servant_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The final monthly plan contains a duplicate role or servant within a service';
  END IF;

  -- One church per day, including conflicts between two services in this batch.
  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments a
    JOIN pg_temp.gms_monthly_final_assignments b
      ON b.servant_id = a.servant_id
     AND b.service_date = a.service_date
     AND b.schedule_id <> a.schedule_id
     AND b.location_id <> a.location_id
  ) OR EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments f
    JOIN public.assignments a ON a.servant_id = f.servant_id
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE s.service_date = f.service_date
      AND s.location_id <> f.location_id
      AND NOT EXISTS (
        SELECT 1
        FROM pg_temp.gms_monthly_expected_slots e
        WHERE e.schedule_id = s.id
      )
  ) THEN
    RAISE EXCEPTION 'A selected servant is already assigned at another church location on the same date';
  END IF;

  -- Non-overlapping services at the same church remain permitted.
  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments a
    JOIN pg_temp.gms_monthly_final_assignments b
      ON b.servant_id = a.servant_id
     AND b.service_date = a.service_date
     AND b.location_id = a.location_id
     AND b.schedule_id <> a.schedule_id
     AND a.start_time < b.end_time
     AND a.end_time > b.start_time
  ) OR EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_final_assignments f
    JOIN public.assignments a ON a.servant_id = f.servant_id
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE s.service_date = f.service_date
      AND s.location_id = f.location_id
      AND f.start_time < s.end_time
      AND f.end_time > s.start_time
      AND NOT EXISTS (
        SELECT 1
        FROM pg_temp.gms_monthly_expected_slots e
        WHERE e.schedule_id = s.id
      )
  ) THEN
    RAISE EXCEPTION 'A selected servant has an overlapping service at the same church';
  END IF;

  -- Every proposed role is still vacant after the exact snapshot check.
  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_monthly_plan p
    JOIN pg_temp.gms_monthly_expected_slots e
      ON e.service_date = p.service_date
     AND e.location_id = p.location_id
     AND e.service_name = p.service_name
    JOIN public.assignments a
      ON a.schedule_id = e.schedule_id
     AND a.role = p.role
  ) THEN
    RAISE EXCEPTION 'A proposed role is no longer vacant. Refresh and generate a new preview';
  END IF;

  -- Only INSERT. Assignment triggers remain enabled and independently recheck
  -- active servant, availability, preferences and cross-service conflicts.
  INSERT INTO public.assignments(
    schedule_id, servant_id, role, confirmation_status
  )
  SELECT
    e.schedule_id, p.servant_id, p.role, 'pending'
  FROM pg_temp.gms_monthly_plan p
  JOIN pg_temp.gms_monthly_expected_slots e
    ON e.service_date = p.service_date
   AND e.location_id = p.location_id
   AND e.service_name = p.service_name
  ORDER BY p.service_date, p.location_id, e.schedule_id, p.role;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'created_schedules', v_created_count,
    'inserted_assignments', v_inserted_count,
    'schedule_ids', COALESCE((
      SELECT pg_catalog.jsonb_agg(e.schedule_id ORDER BY e.service_date, e.location_id, e.service_name)
      FROM pg_temp.gms_monthly_expected_slots e
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_apply_monthly_schedule_plan(date, jsonb, jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_monthly_schedule_plan(date, jsonb, jsonb, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_apply_monthly_schedule_plan(date, jsonb, jsonb, boolean) IS
'Admin-only additive monthly schedule application. Locks and compares the expected schedule/assignment snapshot; creates missing service rows as drafts; inserts only vacant roles with pending confirmation; revalidates availability, recurring rules, preferences, prefer-not acknowledgement, cross-location and overlapping-service constraints; never updates or deletes existing schedules or assignments.';

COMMIT;
