-- Pending command-based creation; same operator gate as work-order commands.
alter table public.work_orders add column description text not null default '' check(length(description)<=4000);
alter table public.work_order_events drop constraint work_order_events_command_check;
alter table public.work_order_events add constraint work_order_events_command_check
check(command in ('create','assign','start','submit','approve','return','note'));
alter table public.work_order_events drop constraint work_order_events_order_version_check;
alter table public.work_order_events add constraint work_order_events_order_version_check check(order_version>=1);

create function public.work_order_assignees(p_site_id text)
returns table(id uuid,display_name text,role public.app_role)
language plpgsql security definer set search_path='' as $$
begin
  if private.current_user_role() is distinct from 'admin'::public.app_role
    or not exists(select 1 from public.jobsites where jobsites.id=p_site_id and is_active) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return query select p.id,p.display_name,p.role from public.profiles p
  where p.is_active and (p.role='admin' or (p.role='engineer' and exists(
    select 1 from public.user_jobsites u where u.user_id=p.id and u.jobsite_id=p_site_id
  ))) order by p.display_name,p.id;
end;
$$;
revoke all on function public.work_order_assignees(text) from public,anon;
grant execute on function public.work_order_assignees(text) to authenticated;

create function public.create_work_order_command(
  p_order_id text,p_request_id uuid,p_site_id text,p_asset_id text,
  p_title text,p_work_type public.work_order_type,p_priority public.work_order_priority,
  p_due_label text,p_description text default '',p_due_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; prior public.work_order_events%rowtype;
  w public.work_orders%rowtype; payload jsonb; event_id bigint;
begin
  if not private.work_order_commands_enabled() then raise exception 'Work order commands not enabled' using errcode='42501'; end if;
  select * into actor from public.profiles where profiles.id=auth.uid() and is_active and role='admin';
  if not found or not exists(select 1 from public.jobsites where id=p_site_id and is_active) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_order_id is null or p_order_id !~ '^WO-[0-9a-fA-F-]{36}$' or p_request_id is null
    or p_title is null or length(btrim(p_title)) not between 1 and 300
    or p_due_label is null or length(btrim(p_due_label)) not between 1 and 200
    or p_description is null or length(p_description)>4000 or p_work_type is null or p_priority is null then
    raise exception 'Invalid creation data' using errcode='22023';
  end if;
  if not exists(select 1 from public.assets where id=p_asset_id and jobsite_id=p_site_id and is_active) then
    raise exception 'Asset not eligible' using errcode='22023';
  end if;
  payload:=jsonb_build_object('order_id',p_order_id,'site_id',p_site_id,'asset_id',p_asset_id,
    'title',btrim(p_title),'work_type',p_work_type,'priority',p_priority,'due_label',btrim(p_due_label),
    'description',p_description,'due_at',p_due_at);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text||':'||p_request_id::text,0));
  select * into prior from public.work_order_events where actor_id=actor.id and request_id=p_request_id;
  if found then
    if prior.command<>'create' or prior.request_payload<>payload then raise exception 'Request ID reused' using errcode='22023'; end if;
    return jsonb_build_object('event_no',prior.event_no,'order',prior.result_snapshot,'replayed',true);
  end if;
  insert into public.work_orders(id,jobsite_id,asset_id,title,work_type,priority,due_label,due_at,description,created_by)
  values(p_order_id,p_site_id,p_asset_id,btrim(p_title),p_work_type,p_priority,btrim(p_due_label),p_due_at,p_description,actor.id)
  returning * into w;
  insert into public.work_order_events(work_order_id,jobsite_id,actor_id,actor_name,actor_role,request_id,command,
    request_payload,before_status,after_status,order_version,result_snapshot)
  values(w.id,w.jobsite_id,actor.id,actor.display_name,actor.role,p_request_id,'create',payload,'waiting','waiting',1,to_jsonb(w))
  returning event_no into event_id;
  return jsonb_build_object('event_no',event_id,'order',to_jsonb(w),'replayed',false);
end;
$$;
revoke all on function public.create_work_order_command(text,uuid,text,text,text,public.work_order_type,public.work_order_priority,text,text,timestamptz) from public,anon;
grant execute on function public.create_work_order_command(text,uuid,text,text,text,public.work_order_type,public.work_order_priority,text,text,timestamptz) to authenticated;
