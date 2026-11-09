-- Keep assignment-confirmation notifications idempotent per confirmation cycle.
-- This aligns production with the already-verified staging implementation.
--
-- Authorization is enforced inside the SECURITY DEFINER function. EXECUTE is
-- intentionally limited to authenticated users; the function verifies that
-- the caller owns the confirmed assignment before notifying administrators.

CREATE OR REPLACE FUNCTION public.notify_admin_assignment_confirmation(
  p_assignment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_assignment public.assignments%rowtype;
  v_servant_user_id uuid;
  v_servant_name text;
  v_service_name text;
  v_service_date date;
  v_confirmation_event_at timestamptz;
  v_confirmation_transition_count bigint;
  v_event_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
    INTO v_assignment
  FROM public.assignments
  WHERE id = p_assignment_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  SELECT v.auth_user_id, v.full_name, s.service_name, s.service_date
    INTO v_servant_user_id, v_servant_name, v_service_name, v_service_date
  FROM public.servants v
  JOIN public.schedules s ON s.id = v_assignment.schedule_id
  WHERE v.id = v_assignment.servant_id;

  IF NOT FOUND OR v_servant_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only notify administrators about your own assignment';
  END IF;

  IF v_assignment.confirmation_status IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'Assignment is not confirmed';
  END IF;

  -- The assignments audit trigger records each status transition in the same
  -- transaction as the UPDATE. Concurrent/repeated RPC calls therefore derive
  -- the same event token for one confirmation cycle, while a later
  -- pending/declined -> confirmed cycle gets a new audit timestamp/count.
  SELECT max(l.created_at), count(*)
    INTO v_confirmation_event_at, v_confirmation_transition_count
  FROM public.audit_logs l
  WHERE l.table_name = 'assignments'
    AND l.record_id = v_assignment.id::text
    AND l.action = 'UPDATE'
    AND l.old_data->>'confirmation_status' IS DISTINCT FROM 'confirmed'
    AND l.new_data->>'confirmation_status' = 'confirmed';

  IF v_confirmation_event_at IS NULL THEN
    -- Safe fallback for a pre-existing assignment confirmed before audit
    -- transition rows were available. It remains stable for repeated calls.
    v_confirmation_event_at := v_assignment.created_at;
    v_confirmation_transition_count := 1;
  END IF;

  v_event_token :=
    pg_catalog.to_char(
      v_confirmation_event_at AT TIME ZONE 'UTC',
      'YYYYMMDDHH24MISSUS'
    )
    || ':' || GREATEST(v_confirmation_transition_count, 1)::text;

  INSERT INTO public.serving_notifications (
    recipient_user_id,
    title,
    body,
    notification_type,
    schedule_id,
    event_key
  )
  SELECT
    p.id,
    'Servant confirmed assignment',
    v_servant_name || ' confirmed ' || v_service_name || ' at ' || v_service_date || '.',
    'assignment_confirmed',
    v_assignment.schedule_id,
    'assignment-confirmation:' || v_assignment.id::text
      || ':' || v_event_token || ':' || p.id::text
  FROM public.profiles p
  WHERE p.role = 'admin'
  ON CONFLICT DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_admin_assignment_confirmation(uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.notify_admin_assignment_confirmation(uuid)
  TO authenticated;
