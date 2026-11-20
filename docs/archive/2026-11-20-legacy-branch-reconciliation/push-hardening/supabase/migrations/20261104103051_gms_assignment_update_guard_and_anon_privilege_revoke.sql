-- Reconstructed from production's assignment trigger and relation ACL.
-- Protect structural assignment fields while allowing a servant's own
-- confirmation_status update. RLS policies continue to enforce row ownership.
CREATE OR REPLACE FUNCTION public.guard_servant_assignment_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_servant_assignment_update_trigger ON public.assignments;
CREATE TRIGGER guard_servant_assignment_update_trigger
  BEFORE UPDATE ON public.assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_servant_assignment_update();

-- The production ACL grants no table-level privileges to anon on assignments.
REVOKE ALL ON TABLE public.assignments FROM anon;
