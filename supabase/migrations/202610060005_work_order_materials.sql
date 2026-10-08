-- Actual usage, not inventory/procurement. No client edits/deletes of evidence.
alter table public.work_orders add constraint work_order_id_site_unique unique(id,jobsite_id);
alter table public.work_order_events drop constraint work_order_events_command_check;
alter table public.work_order_events add constraint work_order_events_command_check
check(command in ('create','assign','start','submit','approve','return','note','material','void_material'));
create table public.work_order_materials (
  id uuid primary key,
  work_order_id text not null,
  jobsite_id text not null,
  event_no bigint not null unique references public.work_order_events(event_no) on delete restrict,
  name text not null check(length(btrim(name)) between 1 and 200),
  quantity numeric(14,4) not null check(quantity>0),
  unit text not null check(length(btrim(unit)) between 1 and 32),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  voided_by uuid references public.profiles(id) on delete restrict,
  voided_at timestamptz,
  void_reason text,
  constraint material_void_complete check (
    (voided_by is null and voided_at is null and void_reason is null)
    or (voided_by is not null and voided_at is not null and void_reason is not null and length(btrim(void_reason)) between 1 and 4000)
  ),
  foreign key(work_order_id,jobsite_id) references public.work_orders(id,jobsite_id) on delete restrict
);
create index work_order_materials_order_idx on public.work_order_materials(work_order_id,event_no);
alter table public.work_order_materials enable row level security;
revoke all on public.work_order_materials from public,anon,authenticated;
grant select on public.work_order_materials to authenticated;
create policy work_order_material_read on public.work_order_materials for select to authenticated
using(private.can_access_jobsite(jobsite_id) and exists(select 1 from public.jobsites s where s.id=jobsite_id and s.is_active));

create function public.record_work_order_material(
  p_order_id text,p_expected_version integer,p_request_id uuid,p_action text,
  p_name text default null,p_quantity numeric default null,p_unit text default null,
  p_material_id uuid default null,p_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; w public.work_orders%rowtype; updated public.work_orders%rowtype;
  prior public.work_order_events%rowtype; material public.work_order_materials%rowtype;
  payload jsonb; event_id bigint; description text; command_name text;
begin
  if not private.work_order_commands_enabled() then raise exception 'Commands disabled' using errcode='42501'; end if;
  select * into actor from public.profiles where id=auth.uid() and is_active and role in ('admin','engineer');
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_expected_version is null or p_expected_version<1 or p_request_id is null or p_action is null or p_action not in ('add','void') then
    raise exception 'Invalid material command' using errcode='22023';
  end if;
  if p_action='add' then
    if p_name is null or length(btrim(p_name)) not between 1 and 200
      or p_unit is null or length(btrim(p_unit)) not between 1 and 32
      or p_quantity is null or p_quantity<=0 or p_quantity>9999999999.9999
      or p_quantity<>round(p_quantity,4) or p_material_id is not null or p_reason is not null then
      raise exception 'Invalid material data' using errcode='22023';
    end if;
  elsif p_material_id is null or p_reason is null or length(btrim(p_reason)) not between 1 and 4000
    or p_name is not null or p_quantity is not null or p_unit is not null then
    raise exception 'Invalid void data' using errcode='22023';
  end if;
  payload:=jsonb_build_object('order_id',p_order_id,'expected_version',p_expected_version,'action',p_action,
    'name',btrim(p_name),'quantity',p_quantity,'unit',btrim(p_unit),'material_id',p_material_id,'reason',btrim(p_reason));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text||':'||p_request_id::text,0));
  select * into w from public.work_orders where id=p_order_id for update;
  if not found or not private.can_access_jobsite(w.jobsite_id)
    or not exists(select 1 from public.jobsites where id=w.jobsite_id and is_active) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select * into prior from public.work_order_events where actor_id=actor.id and request_id=p_request_id;
  if found then
    if prior.command not in ('material','void_material') or prior.request_payload<>payload then raise exception 'Request ID reused' using errcode='22023'; end if;
    return jsonb_build_object('event_no',prior.event_no,'order',prior.result_snapshot,'replayed',true);
  end if;
  if w.version<>p_expected_version then raise exception 'Version conflict' using errcode='40001'; end if;
  if actor.role<>'admin' and actor.id is distinct from w.assignee_id then raise exception 'Assigned engineer required' using errcode='42501'; end if;
  if w.status<>'in_progress' then raise exception 'Material changes require in-progress work' using errcode='22023'; end if;
  if p_action='void' then
    select * into material from public.work_order_materials where id=p_material_id and work_order_id=w.id for update;
    if not found or material.voided_at is not null then raise exception 'Material not eligible' using errcode='22023'; end if;
    if actor.role<>'admin' and material.recorded_by<>actor.id then raise exception 'Only recorder or admin may void' using errcode='42501'; end if;
    command_name:='void_material'; description:='ยกเลิกวัสดุ: '||material.name||' — '||btrim(p_reason);
  else
    command_name:='material'; description:='ใช้วัสดุ: '||btrim(p_name)||' — '||p_quantity::text||' '||btrim(p_unit);
  end if;
  update public.work_orders set version=version+1 where id=w.id returning * into updated;
  insert into public.work_order_events(work_order_id,jobsite_id,actor_id,actor_name,actor_role,request_id,command,request_payload,
    before_status,after_status,assignee_id,note,order_version,result_snapshot)
  values(w.id,w.jobsite_id,actor.id,actor.display_name,actor.role,p_request_id,command_name,payload,w.status,w.status,w.assignee_id,description,updated.version,to_jsonb(updated))
  returning event_no into event_id;
  if p_action='add' then
    insert into public.work_order_materials(id,work_order_id,jobsite_id,event_no,name,quantity,unit,recorded_by)
    values(p_request_id,w.id,w.jobsite_id,event_id,btrim(p_name),p_quantity,btrim(p_unit),actor.id);
  else
    update public.work_order_materials set voided_by=actor.id,voided_at=clock_timestamp(),void_reason=btrim(p_reason) where id=material.id;
  end if;
  return jsonb_build_object('event_no',event_id,'order',to_jsonb(updated),'replayed',false);
end;
$$;
revoke all on function public.record_work_order_material(text,integer,uuid,text,text,numeric,text,uuid,text) from public,anon;
grant execute on function public.record_work_order_material(text,integer,uuid,text,text,numeric,text,uuid,text) to authenticated;
