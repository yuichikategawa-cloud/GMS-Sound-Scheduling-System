-- Atomic administrator schedule save:
--  * preserves unchanged assignment rows and confirmation states;
--  * makes schedule metadata + assignment changes one transaction;
--  * validates the final assignment state against the same production guards;
--  * moves a published service back to draft before applying edits, as the UI did.
CREATE OR REPLACE FUNCTION public.admin_save_schedule_with_assignments(
  p_schedule_id uuid,
  p_service jsonb,
  p_assignments jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_schedule_id uuid;
  v_existing public.schedules%rowtype;
  v_service_date date;
  v_location_id uuid;
  v_service_name text;
  v_start_time time;
  v_end_time time;
  v_lock record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can save schedules';
  END IF;

  IF p_service IS NULL OR jsonb_typeof(p_service) <> 'object' THEN
    RAISE EXCEPTION 'Schedule details must be supplied as an object';
  END IF;

  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Schedule assignments must be supplied as an array';
  END IF;

  IF jsonb_array_length(p_assignments) > 3 THEN
    RAISE EXCEPTION 'A schedule supports at most three role assignments';
  END IF;

  v_service_date := NULLIF(p_service->>'service_date', '')::date;
  v_location_id := NULLIF(p_service->>'location_id', '')::uuid;
  v_service_name := NULLIF(pg_catalog.btrim(p_service->>'service_name'), '');
  v_start_time := NULLIF(p_service->>'start_time', '')::time;
  v_end_time := NULLIF(p_service->>'end_time', '')::time;

  IF v_service_date IS NULL
     OR v_location_id IS NULL
     OR v_service_name IS NULL
     OR v_start_time IS NULL
     OR v_end_time IS NULL THEN
    RAISE EXCEPTION 'Date, location, service name, start time and end time are required';
  END IF;

  IF v_start_time >= v_end_time THEN
    RAISE EXCEPTION 'The service end time must be later than its start time';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_assignments) AS x(entry)
    WHERE NULLIF(x.entry->>'role', '') IS NULL
       OR x.entry->>'role' NOT IN ('FOH', 'Monitor', 'Assistant')
       OR NULLIF(x.entry->>'servant_id', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Each assignment must contain a valid role and servant';
  END IF;

  IF EXISTS (
    SELECT x.entry->>'role'
    FROM jsonb_array_elements(p_assignments) AS x(entry)
    GROUP BY x.entry->>'role'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A role can be assigned only once in a service';
  END IF;

  IF EXISTS (
    SELECT x.entry->>'servant_id'
    FROM jsonb_array_elements(p_assignments) AS x(entry)
    GROUP BY x.entry->>'servant_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The same servant cannot fill more than one role in a service';
  END IF;

  CREATE TEMPORARY TABLE IF NOT EXISTS gms_schedule_assignment_stage (
    role text PRIMARY KEY,
    servant_id uuid NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMPORARY TABLE IF NOT EXISTS gms_schedule_removed_assignment_ids (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  TRUNCATE TABLE pg_temp.gms_schedule_assignment_stage;
  TRUNCATE TABLE pg_temp.gms_schedule_removed_assignment_ids;

  INSERT INTO pg_temp.gms_schedule_assignment_stage(role, servant_id)
  SELECT x.entry->>'role', (x.entry->>'servant_id')::uuid
  FROM jsonb_array_elements(p_assignments) AS x(entry);

  IF p_schedule_id IS NOT NULL THEN
    SELECT *
      INTO v_existing
    FROM public.schedules
    WHERE id = p_schedule_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected service no longer exists. Refresh and try again';
    END IF;

    -- Lock assignment rows while building the final diff.
    PERFORM a.id
    FROM public.assignments a
    WHERE a.schedule_id = p_schedule_id
    ORDER BY a.id
    FOR UPDATE;

    -- Do not silently orphan an unresolved request when its service or
    -- assignment is being edited.
    IF EXISTS (
      SELECT 1
      FROM public.serving_requests r
      WHERE r.status = 'pending'
        AND (r.schedule_id = p_schedule_id OR r.target_schedule_id = p_schedule_id)
    ) THEN
      RAISE EXCEPTION
        'Resolve pending replacement or swap requests for this service before editing it.';
    END IF;

    -- Serialize old and new servant/date scopes in deterministic order.
    FOR v_lock IN
      SELECT DISTINCT scope.servant_id, scope.service_date
      FROM (
        SELECT a.servant_id, v_existing.service_date AS service_date
        FROM public.assignments a
        WHERE a.schedule_id = p_schedule_id
        UNION
        SELECT st.servant_id, v_service_date
        FROM pg_temp.gms_schedule_assignment_stage st
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
        SELECT a.servant_id
        FROM public.assignments a
        WHERE a.schedule_id = p_schedule_id
        UNION
        SELECT st.servant_id
        FROM pg_temp.gms_schedule_assignment_stage st
      ) AS scope
      ORDER BY scope.servant_id
    LOOP
      PERFORM public.gms_lock_availability_servants(NULL, v_lock.servant_id);
    END LOOP;

    -- Preserve the existing UI policy: editing a published service first
    -- makes it a draft; an existing draft remains a draft.
    UPDATE public.schedules
       SET service_date = v_service_date,
           location_id = v_location_id,
           service_name = v_service_name,
           start_time = v_start_time,
           end_time = v_end_time,
           status = CASE WHEN status = 'published' THEN 'draft' ELSE status END,
           updated_at = now()
     WHERE id = p_schedule_id
     RETURNING id INTO v_schedule_id;
  ELSE
    INSERT INTO public.schedules(
      service_date, location_id, service_name, start_time, end_time, status
    )
    VALUES (
      v_service_date, v_location_id, v_service_name, v_start_time, v_end_time, 'draft'
    )
    RETURNING id INTO v_schedule_id;

    FOR v_lock IN
      SELECT DISTINCT st.servant_id
      FROM pg_temp.gms_schedule_assignment_stage st
      ORDER BY st.servant_id
    LOOP
      PERFORM public.gms_lock_availability_servants(NULL, v_lock.servant_id);
      PERFORM public.gms_lock_assignment_conflict_keys(
        NULL, NULL, v_lock.servant_id, v_service_date
      );
    END LOOP;
  END IF;

  -- Validate every selected servant, including unchanged roles whose service
  -- date/time/location may have changed. The assignment triggers below provide
  -- a second check for newly inserted rows.
  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_schedule_assignment_stage st
    LEFT JOIN public.servants sv ON sv.id = st.servant_id
    WHERE sv.id IS NULL OR sv.active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'A selected servant is inactive or no longer exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_schedule_assignment_stage st
    JOIN public.servant_availability av
      ON av.servant_id = st.servant_id
     AND av.service_date = v_service_date
     AND av.status = 'unavailable'
  ) THEN
    RAISE EXCEPTION 'A selected servant is marked unavailable on the service date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_schedule_assignment_stage st
    JOIN public.servant_availability_rules r
      ON r.servant_id = st.servant_id
     AND r.status = 'unavailable'
     AND r.effective_from <= v_service_date
     AND (r.effective_until IS NULL OR r.effective_until >= v_service_date)
     AND public.gms_availability_rule_matches(
       r.pattern, v_service_date, r.weekday, r.ordinal
     )
  ) THEN
    RAISE EXCEPTION 'A selected servant is unavailable under a recurring rule';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_schedule_assignment_stage st
    WHERE NOT public.gms_servant_matches_preferences(
      st.servant_id, v_service_date, v_location_id,
      v_service_name, v_start_time, v_end_time
    )
  ) THEN
    RAISE EXCEPTION 'A selected servant does not match their serving eligibility rules';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_schedule_assignment_stage st
    JOIN public.assignments a ON a.servant_id = st.servant_id
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE s.id <> v_schedule_id
      AND s.service_date = v_service_date
      AND s.location_id <> v_location_id
  ) THEN
    RAISE EXCEPTION
      'A selected servant is already assigned at another church location on the same date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.gms_schedule_assignment_stage st
    JOIN public.assignments a ON a.servant_id = st.servant_id
    JOIN public.schedules s ON s.id = a.schedule_id
    WHERE s.id <> v_schedule_id
      AND s.service_date = v_service_date
      AND s.location_id = v_location_id
      AND v_start_time < s.end_time
      AND v_end_time > s.start_time
  ) THEN
    RAISE EXCEPTION 'A selected servant has an overlapping service at this church';
  END IF;

  -- Identify changed/removed assignment rows. Unchanged role+servant pairs
  -- are deliberately retained, preserving their IDs and confirmation state.
  INSERT INTO pg_temp.gms_schedule_removed_assignment_ids(id)
  SELECT a.id
  FROM public.assignments a
  WHERE a.schedule_id = v_schedule_id
    AND NOT EXISTS (
      SELECT 1
      FROM pg_temp.gms_schedule_assignment_stage st
      WHERE st.role = a.role
        AND st.servant_id = a.servant_id
    );

  -- A closed request can retain its historical details, but a removed target
  -- assignment must be detached before DELETE because that FK cascades.
  UPDATE public.serving_requests r
     SET target_assignment_id = NULL
   WHERE r.target_assignment_id IN (
     SELECT id FROM pg_temp.gms_schedule_removed_assignment_ids
   )
     AND r.status <> 'pending';

  DELETE FROM public.assignments a
  WHERE a.id IN (
    SELECT id FROM pg_temp.gms_schedule_removed_assignment_ids
  );

  -- Insert only genuinely new/changed role assignments. Trigger-level
  -- eligibility and conflict guards remain active for every inserted row.
  INSERT INTO public.assignments(
    schedule_id, servant_id, role, confirmation_status
  )
  SELECT v_schedule_id, st.servant_id, st.role, 'pending'
  FROM pg_temp.gms_schedule_assignment_stage st
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.assignments existing
    WHERE existing.schedule_id = v_schedule_id
      AND existing.role = st.role
      AND existing.servant_id = st.servant_id
  )
  ORDER BY st.role;

  RETURN v_schedule_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_save_schedule_with_assignments(uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_schedule_with_assignments(uuid, jsonb, jsonb)
  TO authenticated, service_role;

-- Secure administrator-led account linking. Registration currently creates a
-- temporary servant row for each new user; this function consolidates that
-- row into an existing roster row after an administrator verifies the user's
-- NIJ against their completed member profile.
CREATE OR REPLACE FUNCTION public.admin_link_servant_account(
  p_servant_id uuid,
  p_user_id uuid,
  p_verified_nij text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_target public.servants%rowtype;
  v_source public.servants%rowtype;
  v_member public.member_profiles%rowtype;
  v_role text;
  v_lock record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can link servant accounts';
  END IF;

  IF p_servant_id IS NULL OR p_user_id IS NULL
     OR NULLIF(pg_catalog.btrim(p_verified_nij), '') IS NULL THEN
    RAISE EXCEPTION 'Select a servant and account, then enter the verified NIJ';
  END IF;

  SELECT *
    INTO v_member
  FROM public.member_profiles
  WHERE user_id = p_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected account has no completed member profile';
  END IF;

  IF pg_catalog.upper(pg_catalog.btrim(p_verified_nij))
       IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(v_member.nij)) THEN
    RAISE EXCEPTION 'NIJ verification failed. Check the member identity before linking';
  END IF;

  SELECT role
    INTO v_role
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_role IS DISTINCT FROM 'servant' THEN
    RAISE EXCEPTION 'Only a servant account can be linked to a servant roster record';
  END IF;

  -- Lock both the roster target and any auto-created servant row for this
  -- account, in a stable order to avoid deadlocks.
  PERFORM s.id
  FROM public.servants s
  WHERE s.id = p_servant_id OR s.auth_user_id = p_user_id
  ORDER BY s.id
  FOR UPDATE OF s;

  SELECT *
    INTO v_target
  FROM public.servants
  WHERE id = p_servant_id;

  IF NOT FOUND OR v_target.active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'The selected roster servant must exist and be active';
  END IF;

  IF v_target.auth_user_id = p_user_id THEN
    RETURN;
  END IF;

  IF v_target.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'The selected roster servant is already linked to another account';
  END IF;

  SELECT *
    INTO v_source
  FROM public.servants
  WHERE auth_user_id = p_user_id;

  IF FOUND AND v_source.id <> p_servant_id THEN
    IF EXISTS (
      SELECT 1 FROM public.assignments a WHERE a.servant_id = v_source.id
    ) THEN
      RAISE EXCEPTION
        'This account already has assignment history on its current servant row. Resolve that history before relinking';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.serving_requests r
      WHERE r.requester_servant_id = v_source.id
         OR r.target_servant_id = v_source.id
         OR r.replacement_servant_id = v_source.id
    ) THEN
      RAISE EXCEPTION
        'This account has serving-request history on its current servant row. Resolve that history before relinking';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.servant_availability source_av
      JOIN public.servant_availability target_av
        ON target_av.servant_id = p_servant_id
       AND target_av.service_date = source_av.service_date
      WHERE source_av.servant_id = v_source.id
    ) THEN
      RAISE EXCEPTION
        'The two servant records have availability entries on the same date. Resolve those duplicates before relinking';
    END IF;

    -- Merge only non-conflicting self-service data from the temporary account
    -- row. Availability triggers and serving-rule guards remain active.
    UPDATE public.servant_availability
       SET servant_id = p_servant_id
     WHERE servant_id = v_source.id;

    UPDATE public.servant_availability_rules
       SET servant_id = p_servant_id
     WHERE servant_id = v_source.id;

    UPDATE public.servant_serving_preferences
       SET servant_id = p_servant_id
     WHERE servant_id = v_source.id;

    -- The transferred preferences must still permit every existing assignment
    -- on the target roster record.
    IF EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.schedules s ON s.id = a.schedule_id
      WHERE a.servant_id = p_servant_id
        AND NOT public.gms_servant_matches_preferences(
          p_servant_id, s.service_date, s.location_id,
          s.service_name, s.start_time, s.end_time
        )
    ) THEN
      RAISE EXCEPTION
        'The transferred serving preferences conflict with an existing assignment. Resolve them before linking';
    END IF;

    UPDATE public.servants
       SET auth_user_id = NULL,
           active = false
     WHERE id = v_source.id;
  END IF;

  UPDATE public.servants
     SET auth_user_id = p_user_id
   WHERE id = p_servant_id;

  -- Record the human identity-verification action in the existing audit trail.
  INSERT INTO public.audit_logs(
    actor_id, table_name, record_id, action, old_data, new_data
  )
  VALUES (
    auth.uid(),
    'servants',
    p_servant_id::text,
    'LINK_ACCOUNT',
    to_jsonb(v_target),
    to_jsonb((SELECT s FROM public.servants s WHERE s.id = p_servant_id))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_link_servant_account(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_servant_account(uuid, uuid, text)
  TO authenticated, service_role;
