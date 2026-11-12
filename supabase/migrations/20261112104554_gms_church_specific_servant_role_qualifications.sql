-- Church-specific sound role qualifications.
-- Preserve the existing global role list as a compatibility union for older
-- callers, while making servant_location_roles authoritative per church.

BEGIN;

CREATE TABLE IF NOT EXISTS public.servant_location_roles (
  servant_id uuid NOT NULL REFERENCES public.servants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('FOH', 'Monitor', 'Assistant')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (servant_id, location_id, role)
);

CREATE INDEX IF NOT EXISTS servant_location_roles_location_idx
  ON public.servant_location_roles (location_id, role, servant_id);

ALTER TABLE public.servant_location_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS servant_location_roles_authenticated_read
  ON public.servant_location_roles;
CREATE POLICY servant_location_roles_authenticated_read
  ON public.servant_location_roles
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.servant_location_roles FROM anon, authenticated;
GRANT SELECT ON public.servant_location_roles TO authenticated;

-- Existing global qualifications are copied to every current church, preserving
-- the current scheduling behavior until an administrator edits a church matrix.
INSERT INTO public.servant_location_roles (servant_id, location_id, role)
SELECT s.id, l.id, r.role
FROM public.servants s
CROSS JOIN public.locations l
CROSS JOIN LATERAL unnest(s.qualified_roles) AS r(role)
ON CONFLICT (servant_id, location_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_set_servant_location_roles(
  p_servant_id uuid,
  p_roles_by_location jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_compatibility_roles text[];
  v_location_count integer;
  v_inserted_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can update church-specific servant qualifications';
  END IF;

  IF p_servant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.servants s WHERE s.id = p_servant_id
  ) THEN
    RAISE EXCEPTION 'The selected servant does not exist';
  END IF;

  IF p_roles_by_location IS NULL
     OR pg_catalog.jsonb_typeof(p_roles_by_location) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Church-specific role qualifications must be a location-to-role object';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each(p_roles_by_location) AS item(location_key, roles)
    WHERE item.location_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR pg_catalog.jsonb_typeof(item.roles) IS DISTINCT FROM 'array'
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_array_elements_text(
           CASE WHEN pg_catalog.jsonb_typeof(item.roles) = 'array'
             THEN item.roles ELSE '[]'::jsonb END
         ) AS selected(role)
         WHERE selected.role NOT IN ('FOH', 'Monitor', 'Assistant')
       )
       OR (
         SELECT pg_catalog.count(*)
         FROM pg_catalog.jsonb_array_elements_text(
           CASE WHEN pg_catalog.jsonb_typeof(item.roles) = 'array'
             THEN item.roles ELSE '[]'::jsonb END
         )
       ) <> (
         SELECT pg_catalog.count(DISTINCT selected.role)
         FROM pg_catalog.jsonb_array_elements_text(
           CASE WHEN pg_catalog.jsonb_typeof(item.roles) = 'array'
             THEN item.roles ELSE '[]'::jsonb END
         ) AS selected(role)
       )
  ) THEN
    RAISE EXCEPTION 'The role matrix contains an invalid church, role or duplicate value';
  END IF;

  SELECT pg_catalog.count(*)
    INTO v_location_count
  FROM pg_catalog.jsonb_each(p_roles_by_location);

  IF v_location_count <> (
    SELECT pg_catalog.count(*)
    FROM public.locations
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each(p_roles_by_location) AS item(location_key, roles)
    LEFT JOIN public.locations l ON l.id = item.location_key::uuid
    WHERE l.id IS NULL
  ) THEN
    RAISE EXCEPTION 'The role matrix must contain exactly the currently available church locations';
  END IF;

  DELETE FROM public.servant_location_roles
  WHERE servant_id = p_servant_id;

  INSERT INTO public.servant_location_roles (servant_id, location_id, role)
  SELECT
    p_servant_id,
    item.location_key::uuid,
    selected.role
  FROM pg_catalog.jsonb_each(p_roles_by_location) AS item(location_key, roles)
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(item.roles) AS selected(role);

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  -- Keep the old global role array as the union of all church qualifications.
  -- Existing code paths that still consult qualified_roles remain compatible,
  -- while the assignment trigger below enforces the selected church.
  SELECT COALESCE(
    pg_catalog.array_agg(DISTINCT selected.role ORDER BY selected.role),
    ARRAY[]::text[]
  )
    INTO v_compatibility_roles
  FROM public.servant_location_roles selected
  WHERE selected.servant_id = p_servant_id;

  UPDATE public.servants
     SET qualified_roles = v_compatibility_roles
   WHERE id = p_servant_id;

  RETURN pg_catalog.jsonb_build_object(
    'servant_id', p_servant_id,
    'location_count', v_location_count,
    'qualified_location_roles', v_inserted_count,
    'compatibility_roles', v_compatibility_roles
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_servant_location_roles(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_servant_location_roles(uuid, jsonb)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.gms_enforce_servant_location_role()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_location_id uuid;
BEGIN
  SELECT s.location_id
    INTO v_location_id
  FROM public.schedules s
  WHERE s.id = NEW.schedule_id;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'The assignment service location could not be resolved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.servant_location_roles r
    WHERE r.servant_id = NEW.servant_id
      AND r.location_id = v_location_id
      AND r.role = NEW.role
  ) THEN
    RAISE EXCEPTION 'Servant is not qualified for % at this church', NEW.role;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS gms_enforce_servant_location_role
  ON public.assignments;
CREATE TRIGGER gms_enforce_servant_location_role
  BEFORE INSERT OR UPDATE OF schedule_id, servant_id, role
  ON public.assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.gms_enforce_servant_location_role();

-- The trigger invokes this SECURITY DEFINER function automatically; callers
-- must not be able to invoke the helper directly.
REVOKE ALL ON FUNCTION public.gms_enforce_servant_location_role()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.servant_location_roles IS
  'Administrator-managed sound role qualifications for each servant at each church location.';
COMMENT ON FUNCTION public.gms_enforce_servant_location_role() IS
  'Prevents an assignment from being inserted or changed to a role the servant is not qualified to fill at that service location.';

COMMIT;
