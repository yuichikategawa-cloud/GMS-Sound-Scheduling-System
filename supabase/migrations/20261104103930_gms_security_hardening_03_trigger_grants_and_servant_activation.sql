-- Reconstructed trigger-function grants from the production function ACL.
GRANT EXECUTE ON FUNCTION public.guard_servant_assignment_update() TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_member_profile_name() TO service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log() TO service_role;
GRANT EXECUTE ON FUNCTION public.gms_notify_assignment_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.gms_notify_schedule_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.gms_notify_serving_request_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.gms_queue_push_for_notification() TO service_role;
