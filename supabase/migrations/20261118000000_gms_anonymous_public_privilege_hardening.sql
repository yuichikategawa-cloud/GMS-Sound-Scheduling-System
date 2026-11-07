BEGIN;

-- Tighten public-schema access for anonymous API sessions.
-- App users must authenticate before accessing GMS workspace data. Existing
-- RLS policies continue to authorize authenticated servants and administrators.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Prevent default ACLs from restoring anonymous table/sequence grants on
-- objects created by either migration owner used by the project environments.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;

-- Reassert the member/admin read boundaries. These match the current policies
-- already verified in both connected projects, while removing stale broad
-- policy names from environments that still have them.
DROP POLICY IF EXISTS "authenticated read availability" ON public.servant_availability;
DROP POLICY IF EXISTS "users read own availability" ON public.servant_availability;
CREATE POLICY "users read own availability"
ON public.servant_availability
FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.servants s
    WHERE s.id = servant_availability.servant_id
      AND s.auth_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "authenticated read schedules" ON public.schedules;
DROP POLICY IF EXISTS "users read published schedules" ON public.schedules;
CREATE POLICY "users read published schedules"
ON public.schedules
FOR SELECT TO authenticated
USING (public.is_admin() OR status = 'published');

DROP POLICY IF EXISTS "authenticated read assignments" ON public.assignments;
DROP POLICY IF EXISTS "users read published assignments" ON public.assignments;
CREATE POLICY "users read published assignments"
ON public.assignments
FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.schedules s
    WHERE s.id = assignments.schedule_id
      AND s.status = 'published'
  )
);

COMMIT;
