CREATE OR REPLACE FUNCTION public.admin_link_servant_account(p_servant_id uuid, p_user_id uuid, p_verified_nij text)
 RETURNS void
 LANGUAGE plpgsql
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

    -- Preserve the same opposite-status date-range rule used by the app's
    -- recurring availability editor. The UI conservatively blocks overlapping
    -- effective ranges even when two recurrence patterns differ.
    IF EXISTS (
      SELECT 1
      FROM public.servant_availability_rules source_rule
      JOIN public.servant_availability_rules target_rule
        ON target_rule.servant_id = p_servant_id
       AND source_rule.status <> target_rule.status
       AND (source_rule.effective_until IS NULL
         OR source_rule.effective_until >= target_rule.effective_from)
       AND (target_rule.effective_until IS NULL
         OR target_rule.effective_until >= source_rule.effective_from)
      WHERE source_rule.servant_id = v_source.id
    ) THEN
      RAISE EXCEPTION
        'The account and roster have recurring availability rules with conflicting statuses over overlapping dates. Resolve the rules before linking';
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
$function$
