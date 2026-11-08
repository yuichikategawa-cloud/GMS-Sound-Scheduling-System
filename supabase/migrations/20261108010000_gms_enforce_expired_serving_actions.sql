-- Enforce service-time expiry and configured availability deadline at the database boundary.
-- All service clocks are interpreted in Asia/Jakarta, matching the application locale.
-- This migration replaces existing trigger/RPC bodies without changing grants or RLS.

CREATE OR REPLACE FUNCTION public.gms_validate_serving_request_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_schedule public.schedules%rowtype;
  v_target_schedule public.schedules%rowtype;
  v_source_assignment public.assignments%rowtype;
  v_target_assignment public.assignments%rowtype;
  v_target_servant public.servants%rowtype;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.reviewed_by IS NOT NULL
     OR NEW.reviewed_at IS NOT NULL
     OR NEW.replacement_servant_id IS NOT NULL THEN
    RAISE EXCEPTION 'A new serving request must be pending and cannot contain review or replacement metadata.';
  END IF;

  IF NEW.requester_servant_id IS NULL OR NEW.schedule_id IS NULL OR NEW.assignment_id IS NULL THEN
    RAISE EXCEPTION 'A serving request must reference the requester, service and original assignment.';
  END IF;

  IF NOT public.is_admin() AND NOT EXISTS (
    SELECT 1 FROM public.servants sv
    WHERE sv.id = NEW.requester_servant_id
      AND sv.auth_user_id = auth.uid()
      AND sv.active = true
  ) THEN
    RAISE EXCEPTION 'You may submit a serving request only for your own active servant profile.';
  END IF;

  PERFORM s.id
  FROM public.schedules s
  WHERE s.id = NEW.schedule_id OR s.id = NEW.target_schedule_id
  ORDER BY s.id
  FOR UPDATE OF s;

  SELECT * INTO v_source_schedule
  FROM public.schedules WHERE id = NEW.schedule_id;

  IF NOT FOUND OR v_source_schedule.status <> 'published' THEN
    RAISE EXCEPTION 'The original service must still exist and be published.';
  END IF;

  IF (v_source_schedule.service_date + v_source_schedule.start_time)
       AT TIME ZONE 'Asia/Jakarta' <= pg_catalog.now() THEN
    RAISE EXCEPTION 'The original service has already started; serving requests are closed.';
  END IF;

  PERFORM a.id
  FROM public.assignments a
  WHERE a.id = NEW.assignment_id OR a.id = NEW.target_assignment_id
  ORDER BY a.id
  FOR UPDATE OF a;

  SELECT * INTO v_source_assignment
  FROM public.assignments
  WHERE id = NEW.assignment_id AND schedule_id = NEW.schedule_id;

  IF NOT FOUND OR v_source_assignment.servant_id IS DISTINCT FROM NEW.requester_servant_id THEN
    RAISE EXCEPTION 'The original assignment must belong to the requester and the selected service.';
  END IF;

  IF NEW.request_type = 'replacement' THEN
    IF NEW.target_schedule_id IS NOT NULL OR NEW.target_assignment_id IS NOT NULL OR NEW.target_servant_id IS NOT NULL THEN
      RAISE EXCEPTION 'A replacement request cannot contain swap target details.';
    END IF;
  ELSIF NEW.request_type = 'swap' THEN
    IF NEW.target_schedule_id IS NULL OR NEW.target_assignment_id IS NULL OR NEW.target_servant_id IS NULL THEN
      RAISE EXCEPTION 'A swap request must include its target service, assignment and servant.';
    END IF;

    SELECT * INTO v_target_schedule
    FROM public.schedules WHERE id = NEW.target_schedule_id;

    IF NOT FOUND OR v_target_schedule.status <> 'published' THEN
      RAISE EXCEPTION 'The target service must still exist and be published.';
    END IF;

    IF (v_target_schedule.service_date + v_target_schedule.start_time)
         AT TIME ZONE 'Asia/Jakarta' <= pg_catalog.now() THEN
      RAISE EXCEPTION 'The target service has already started; serving requests are closed.';
    END IF;

    IF v_target_schedule.id = v_source_schedule.id OR v_target_schedule.service_date = v_source_schedule.service_date THEN
      RAISE EXCEPTION 'A swap request must target a different service date.';
    END IF;

    SELECT * INTO v_target_assignment
    FROM public.assignments
    WHERE id = NEW.target_assignment_id AND schedule_id = NEW.target_schedule_id;

    IF NOT FOUND OR v_target_assignment.servant_id IS NULL
       OR v_target_assignment.servant_id IS DISTINCT FROM NEW.target_servant_id THEN
      RAISE EXCEPTION 'The target assignment and target servant must belong to the selected target service.';
    END IF;

    IF NEW.target_servant_id = NEW.requester_servant_id THEN
      RAISE EXCEPTION 'A servant cannot submit a swap request with themselves.';
    END IF;

    SELECT * INTO v_target_servant
    FROM public.servants WHERE id = NEW.target_servant_id AND active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The target servant must still be active.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported serving request type.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_servant_assignment_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_service_date date;
  v_start_time time;
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id
       OR NEW.servant_id IS DISTINCT FROM OLD.servant_id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Servants may only update their own confirmation status.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.confirmation_status IS DISTINCT FROM OLD.confirmation_status THEN
      SELECT s.service_date, s.start_time
        INTO v_service_date, v_start_time
      FROM public.schedules s
      WHERE s.id = OLD.schedule_id;

      IF NOT FOUND OR (v_service_date + v_start_time) AT TIME ZONE 'Asia/Jakarta' <= pg_catalog.now() THEN
        RAISE EXCEPTION 'This service has started; confirmation changes are closed.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_execute_servant_swap(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  req public.serving_requests%rowtype;
  src public.schedules%rowtype;
  dst public.schedules%rowtype;
  src_assignment public.assignments%rowtype;
  dst_assignment public.assignments%rowtype;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can approve and execute swaps';
  END IF;

  SELECT * INTO req FROM public.serving_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR req.status <> 'pending' OR req.request_type <> 'swap' THEN
    RAISE EXCEPTION 'Swap request is unavailable or no longer pending';
  END IF;
  IF req.target_schedule_id IS NULL OR req.target_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Swap request is missing its target assignment';
  END IF;

  PERFORM s.id
  FROM public.schedules s
  WHERE s.id IN (req.schedule_id, req.target_schedule_id)
  ORDER BY s.id
  FOR UPDATE OF s;

  SELECT * INTO src FROM public.schedules WHERE id = req.schedule_id;
  SELECT * INTO dst FROM public.schedules WHERE id = req.target_schedule_id;
  SELECT * INTO src_assignment FROM public.assignments WHERE id = req.assignment_id FOR UPDATE;
  SELECT * INTO dst_assignment FROM public.assignments WHERE id = req.target_assignment_id FOR UPDATE;

  IF src.id IS NULL OR dst.id IS NULL OR src_assignment.id IS NULL OR dst_assignment.id IS NULL THEN
    RAISE EXCEPTION 'One of the selected services or assignments no longer exists';
  END IF;
  IF src.status <> 'published' OR dst.status <> 'published' THEN
    RAISE EXCEPTION 'Both services must still be published';
  END IF;
  IF (src.service_date + src.start_time) AT TIME ZONE 'Asia/Jakarta' <= pg_catalog.now()
     OR (dst.service_date + dst.start_time) AT TIME ZONE 'Asia/Jakarta' <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Both services must still be in the future to execute a swap.';
  END IF;
  IF src.service_date = dst.service_date THEN
    RAISE EXCEPTION 'Choose a different service date for a cross-date swap';
  END IF;
  IF src_assignment.servant_id <> req.requester_servant_id THEN
    RAISE EXCEPTION 'The requester is no longer assigned to the original service';
  END IF;
  IF dst_assignment.servant_id IS NULL OR dst_assignment.servant_id = req.requester_servant_id THEN
    RAISE EXCEPTION 'The target assignment is no longer valid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.assignments a JOIN public.schedules s ON s.id = a.schedule_id
    WHERE a.servant_id = dst_assignment.servant_id
      AND s.service_date = src.service_date AND s.location_id <> src.location_id
      AND s.id NOT IN (src.id, dst.id)
  ) THEN
    RAISE EXCEPTION 'Target servant already has an assignment at another church on the first date';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.assignments a JOIN public.schedules s ON s.id = a.schedule_id
    WHERE a.servant_id = src_assignment.servant_id
      AND s.service_date = dst.service_date AND s.location_id <> dst.location_id
      AND s.id NOT IN (src.id, dst.id)
  ) THEN
    RAISE EXCEPTION 'Requester already has an assignment at another church on the second date';
  END IF;

  UPDATE public.assignments SET servant_id = dst_assignment.servant_id, confirmation_status = 'pending' WHERE id = src_assignment.id;
  UPDATE public.assignments SET servant_id = src_assignment.servant_id, confirmation_status = 'pending' WHERE id = dst_assignment.id;
  UPDATE public.serving_requests SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = pg_catalog.now() WHERE id = req.id;
END;
$function$;

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
  IF TG_OP = 'UPDATE' THEN
    v_old_servant_id := OLD.servant_id;
  END IF;

  PERFORM public.gms_lock_availability_servants(v_old_servant_id, NEW.servant_id);

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
