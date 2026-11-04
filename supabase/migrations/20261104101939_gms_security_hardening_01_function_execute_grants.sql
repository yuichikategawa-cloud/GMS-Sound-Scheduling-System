-- Reconstructed from the live production SECURITY DEFINER function ACLs.
-- Preserve ordinary SECURITY INVOKER helper-function access; restrict only
-- SECURITY DEFINER routines, then restore the observed RPC allowlists.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      f.signature
    );

    IF f.proname = ANY (ARRAY[
      'admin_bulk_assignments_grouped',
      'admin_execute_servant_swap',
      'admin_publish_schedules_grouped',
      'admin_resolve_replacement',
      'is_admin',
      'notify_admin_assignment_confirmation',
      'register_serving_push_subscription'
    ]) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.signature);
    END IF;

    IF f.proname = ANY (ARRAY[
      'admin_bulk_assignments_grouped',
      'admin_execute_servant_swap',
      'admin_publish_schedules_grouped',
      'admin_resolve_replacement',
      'auto_confirm_d1_assignments',
      'cleanup_expired_servant_availability',
      'cleanup_gms_notification_audit_retention',
      'gms_emit_serving_notification',
      'gms_generate_daily_serving_reminders',
      'gms_notify_assignment_change',
      'gms_notify_schedule_change',
      'gms_notify_serving_request_change',
      'gms_queue_push_for_notification',
      'gms_servant_matches_preferences',
      'guard_servant_assignment_update',
      'handle_new_user',
      'is_admin',
      'notify_admin_assignment_confirmation',
      'register_serving_push_subscription',
      'sync_member_profile_name',
      'write_audit_log'
    ]) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
    END IF;
  END LOOP;
END
$$;
