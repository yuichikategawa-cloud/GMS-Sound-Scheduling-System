-- GMS: allow administrators to publish/unpublish all church locations in one action.
-- The UI uses p_location_id = NULL and p_schedule_ids = NULL for the explicit All churches option.
-- Grouped notification delivery remains one Inbox/push event per affected account per operation.

create or replace function public.admin_publish_schedules_grouped(
  p_location_id uuid default null,
  p_schedule_ids uuid[] default null,
  p_status text default 'published'
) returns integer
language plpgsql security definer set search_path=public as $$
declare v_changed integer; v_user record; v_count integer; v_title text; v_body text; v_type text;
begin
  if not public.is_admin() then raise exception 'Only administrators can publish schedules'; end if;
  if p_status not in ('published','draft') then raise exception 'Invalid schedule status'; end if;
  -- NULL location + NULL schedule IDs intentionally means all church locations.

  create temporary table if not exists gms_publish_changed(schedule_id uuid primary key) on commit drop;
  truncate table pg_temp.gms_publish_changed;
  perform set_config('gms.suppress_assignment_notifications','on',true);
  with changed as (
    update public.schedules s set status=p_status
    where s.status is distinct from p_status
      and (p_location_id is null or s.location_id=p_location_id)
      and (p_schedule_ids is null or s.id=any(p_schedule_ids))
    returning s.id
  ) insert into pg_temp.gms_publish_changed(schedule_id) select id from changed;
  select count(*) into v_changed from pg_temp.gms_publish_changed;

  if v_changed=0 then return 0; end if;
  v_title:=case when p_status='published' then 'Serving schedule published' else 'Serving schedule unpublished' end;
  v_type:=case when p_status='published' then 'new_assignment' else 'schedule_unpublished' end;
  for v_user in
    select v.auth_user_id,count(distinct s.id)::integer as service_count
    from public.schedules s
    join public.assignments a on a.schedule_id=s.id
    join public.servants v on v.id=a.servant_id
    where v.auth_user_id is not null
      and s.id in (select schedule_id from pg_temp.gms_publish_changed)
    group by v.auth_user_id
  loop
    v_body:=case when p_status='published'
      then 'Your serving schedule has been published with '||v_user.service_count||' service assignment(s). Open GMS to review all dates, locations and roles.'
      else 'Your published schedule has been updated. '||v_user.service_count||' service assignment(s) are now drafts. Open GMS to review.'
    end;
    perform public.gms_emit_serving_notification(v_user.auth_user_id,v_title,v_body,v_type,
      'grouped-publish:'||txid_current()||':'||v_user.auth_user_id::text,null,null);
  end loop;
  return v_changed;
end;
$$;
revoke all on function public.admin_publish_schedules_grouped(uuid,uuid[],text) from public;
grant execute on function public.admin_publish_schedules_grouped(uuid,uuid[],text) to authenticated;


comment on function public.admin_publish_schedules_grouped(uuid,uuid[],text) is
  'Admin-only publish/unpublish for one church, selected services, or all church locations when both filters are NULL. Sends one grouped notification per affected account.';
