-- Reconstructed current handle_new_user behavior from the live production catalog.
-- Registration with a supplied NIJ activates/links the servant profile and creates
-- the corresponding member profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  m jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  INSERT INTO public.profiles (id, display_name, role, username)
  VALUES (
    NEW.id,
    coalesce(m->>'full_name', split_part(NEW.email, '@', 1)),
    'servant',
    lower(m->>'username')
  )
  ON CONFLICT (id) DO UPDATE SET username = excluded.username;

  IF m ? 'nij' THEN
    INSERT INTO public.servants(full_name, active, auth_user_id)
    VALUES (m->>'full_name', true, NEW.id)
    ON CONFLICT (auth_user_id)
    DO UPDATE SET full_name = excluded.full_name, active = true;

    INSERT INTO public.member_profiles (
      user_id, full_name, email, gender, date_of_birth, nij, phone_number,
      domicile_area, domicile_other, cg_category, cg_status, cg_number,
      cg_days, cg_time, team_leader_name, coach_name, cg_leader_name,
      leader_phone_numbers
    )
    VALUES (
      NEW.id, m->>'full_name', coalesce(NEW.email, m->>'email'),
      m->>'gender', (m->>'date_of_birth')::date, m->>'nij',
      m->>'phone_number', m->>'domicile_area', nullif(m->>'domicile_other',''),
      m->>'cg_category', m->>'cg_status', m->>'cg_number',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(m->'cg_days','[]'::jsonb))),
      m->>'cg_time', nullif(m->>'team_leader_name',''),
      nullif(m->>'coach_name',''), nullif(m->>'cg_leader_name',''),
      ARRAY(SELECT jsonb_array_elements_text(coalesce(m->'leader_phone_numbers','[]'::jsonb)))
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
