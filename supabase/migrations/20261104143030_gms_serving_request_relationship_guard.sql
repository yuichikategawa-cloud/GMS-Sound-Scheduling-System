CREATE OR REPLACE FUNCTION public.gms_validate_serving_request_insert()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
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
  -- A new request must enter the administrator queue as pending. Approval
  -- metadata and the final replacement servant are set only by admin workflows.
  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.reviewed_by IS NOT NULL
     OR NEW.reviewed_at IS NOT NULL
     OR NEW.replacement_servant_id IS NOT NULL THEN
    RAISE EXCEPTION
      'A new serving request must be pending and cannot contain review or replacement metadata.';
  END IF;

  IF NEW.requester_servant_id IS NULL
     OR NEW.schedule_id IS NULL
     OR NEW.assignment_id IS NULL THEN
    RAISE EXCEPTION
      'A serving request must reference the requester, service and original assignment.';
  END IF;

  -- Non-admin callers may submit only for the servant profile linked to them.
  IF NOT public.is_admin() AND NOT EXISTS (
    SELECT 1
    FROM public.servants sv
    WHERE sv.id = NEW.requester_servant_id
      AND sv.auth_user_id = auth.uid()
      AND sv.active = true
  ) THEN
    RAISE EXCEPTION
      'You may submit a serving request only for your own active servant profile.';
  END IF;

  -- Lock the source and (if present) target schedules in a stable order.
  PERFORM s.id
  FROM public.schedules s
  WHERE s.id = NEW.schedule_id
     OR s.id = NEW.target_schedule_id
  ORDER BY s.id
  FOR UPDATE OF s;

  SELECT *
    INTO v_source_schedule
  FROM public.schedules
  WHERE id = NEW.schedule_id;

  IF NOT FOUND OR v_source_schedule.status <> 'published' THEN
    RAISE EXCEPTION
      'The original service must still exist and be published.';
  END IF;

  -- Lock referenced assignment rows in a stable order, then verify their
  -- actual schedule/servant relationships rather than trusting client IDs.
  PERFORM a.id
  FROM public.assignments a
  WHERE a.id = NEW.assignment_id
     OR a.id = NEW.target_assignment_id
  ORDER BY a.id
  FOR UPDATE OF a;

  SELECT *
    INTO v_source_assignment
  FROM public.assignments
  WHERE id = NEW.assignment_id
    AND schedule_id = NEW.schedule_id;

  IF NOT FOUND
     OR v_source_assignment.servant_id IS DISTINCT FROM NEW.requester_servant_id THEN
    RAISE EXCEPTION
      'The original assignment must belong to the requester and the selected service.';
  END IF;

  IF NEW.request_type = 'replacement' THEN
    IF NEW.target_schedule_id IS NOT NULL
       OR NEW.target_assignment_id IS NOT NULL
       OR NEW.target_servant_id IS NOT NULL THEN
      RAISE EXCEPTION
        'A replacement request cannot contain swap target details.';
    END IF;

  ELSIF NEW.request_type = 'swap' THEN
    IF NEW.target_schedule_id IS NULL
       OR NEW.target_assignment_id IS NULL
       OR NEW.target_servant_id IS NULL THEN
      RAISE EXCEPTION
        'A swap request must include its target service, assignment and servant.';
    END IF;

    SELECT *
      INTO v_target_schedule
    FROM public.schedules
    WHERE id = NEW.target_schedule_id;

    IF NOT FOUND OR v_target_schedule.status <> 'published' THEN
      RAISE EXCEPTION
        'The target service must still exist and be published.';
    END IF;

    IF v_target_schedule.id = v_source_schedule.id
       OR v_target_schedule.service_date = v_source_schedule.service_date THEN
      RAISE EXCEPTION
        'A swap request must target a different service date.';
    END IF;

    SELECT *
      INTO v_target_assignment
    FROM public.assignments
    WHERE id = NEW.target_assignment_id
      AND schedule_id = NEW.target_schedule_id;

    IF NOT FOUND
       OR v_target_assignment.servant_id IS NULL
       OR v_target_assignment.servant_id IS DISTINCT FROM NEW.target_servant_id THEN
      RAISE EXCEPTION
        'The target assignment and target servant must belong to the selected target service.';
    END IF;

    IF NEW.target_servant_id = NEW.requester_servant_id THEN
      RAISE EXCEPTION
        'A servant cannot submit a swap request with themselves.';
    END IF;

    SELECT *
      INTO v_target_servant
    FROM public.servants
    WHERE id = NEW.target_servant_id
      AND active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'The target servant must still be active.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported serving request type.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.gms_validate_serving_request_insert()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS gms_validate_serving_request_insert_trigger
  ON public.serving_requests;

CREATE TRIGGER gms_validate_serving_request_insert_trigger
BEFORE INSERT
ON public.serving_requests
FOR EACH ROW
EXECUTE FUNCTION public.gms_validate_serving_request_insert();
