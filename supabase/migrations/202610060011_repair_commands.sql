-- Forward-only repair command foundation. OFF until matching client rollout.
create table private.repair_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private.repair_settings values(true,false);
revoke all on private.repair_settings from public,anon,authenticated;
create function private.repair_commands_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from private.repair_settings where singleton),false);
$$;
revoke all on function private.repair_commands_enabled() from public,anon;
grant execute on function private.repair_commands_enabled() to authenticated;
create function public.repair_commands_ready() returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if private.repair_commands_enabled() and not (private.service_report_drafts_enabled() and private.service_report_reviews_enabled()) then
   raise exception 'Repair commands require server report submission' using errcode='42501';
 end if;
 return private.repair_commands_enabled() and private.current_user_role() is not null;
end;
$$;
revoke all on function public.repair_commands_ready() from public,anon;
grant execute on function public.repair_commands_ready() to authenticated;
-- Baseline version only; no invented historical events or historical edits.
alter table public.repair_requests add column version integer not null default 1 check(version>0);
create table public.repair_events(
 event_no bigint generated always as identity primary key,
 repair_id text not null references public.repair_requests(id) on delete restrict,
 jobsite_id text not null references public.jobsites(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 actor_name text not null,actor_role public.app_role not null,request_id uuid not null,
 command text not null check(command in ('create','save')),request_payload jsonb not null,
 before_status public.repair_status,after_status public.repair_status not null,
 repair_version integer not null check(repair_version>0),result_snapshot jsonb not null,
 created_at timestamptz not null default now(),unique(actor_id,request_id)
);
alter table public.repair_events enable row level security;
create policy "scoped repair events read" on public.repair_events for select to authenticated using(private.can_access_jobsite(jobsite_id));
revoke all on public.repair_events from public,anon,authenticated;
grant select on public.repair_events to authenticated;
create function private.immutable_repair_event() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Repair audit is immutable' using errcode='42501'; end;
$$;
revoke all on function private.immutable_repair_event() from public,anon,authenticated;
create trigger repair_events_immutable before update or delete on public.repair_events for each row execute function private.immutable_repair_event();
create function private.guard_repair_command_write() returns trigger language plpgsql set search_path='' as $$
declare owner_write boolean;
begin
 select current_user=pg_catalog.pg_get_userbyid(c.relowner) into owner_write from pg_catalog.pg_class c where c.oid=tg_relid;
 if private.repair_commands_enabled() and not owner_write then raise exception 'Use repair save command' using errcode='42501'; end if;
 if not owner_write and tg_op='INSERT' then
   if new.version<>1 then raise exception 'Server version required' using errcode='42501'; end if;
   new.version:=1;
 elsif not owner_write and tg_op='UPDATE' then
   if new.version is distinct from old.version then raise exception 'Server version required' using errcode='42501'; end if;
   new.version:=old.version+1;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function private.guard_repair_command_write() from public,anon,authenticated;
create trigger repair_requests_command_guard before insert or update or delete on public.repair_requests for each row execute function private.guard_repair_command_write();

create function public.save_repair_command(p_repair_id text,p_site_id text,p_expected_version integer,p_request_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;r public.repair_requests%rowtype;saved public.repair_requests%rowtype;
 source public.service_reports%rowtype;a public.assets%rowtype;prior public.repair_events%rowtype;
 payload jsonb;creating boolean;event_id bigint;source_id text;
begin
 if not public.repair_commands_ready() then raise exception 'Repair commands disabled' using errcode='42501'; end if;
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if not found or actor.role not in ('admin','engineer') or not private.can_access_jobsite(p_site_id)
   or not exists(select 1 from public.jobsites where id=p_site_id and is_active) then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0 or p_repair_id is null or length(p_repair_id) not between 1 and 100
   or jsonb_typeof(p_data) is distinct from 'object'
   or not p_data ?& array['asset_id','requested_date','title','description','priority','status','reported_by','resolution','service_report_id']
   or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('asset_id','requested_date','title','description','priority','status','reported_by','resolution','service_report_id'))
   or exists(select 1 from unnest(array['asset_id','requested_date','title','description','priority','status','reported_by','resolution']) k where jsonb_typeof(p_data->k) is distinct from 'string' or length(p_data->>k)>4000)
   or jsonb_typeof(p_data->'service_report_id') not in ('string','null')
   or length(btrim(p_data->>'title'))=0 or length(btrim(p_data->>'description'))=0 or length(btrim(p_data->>'reported_by'))=0
   or p_data->>'status' not in ('draft','open','in_progress','resolved','cancelled') or p_data->>'priority' not in ('low','normal','high','critical')
   or p_data->>'requested_date' !~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid repair payload' using errcode='22023'; end if;
 payload:=jsonb_build_object('repair_id',p_repair_id,'site_id',p_site_id,'expected_version',p_expected_version,'data',p_data);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text||':repair:'||p_request_id::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('repair:'||p_repair_id,0));
 -- Lock source before repair, matching report-save's parent-before-child order.
 select service_report_id into source_id from public.repair_requests where id=p_repair_id;
 if source_id is not null then select * into source from public.service_reports where id=source_id for share; end if;
 select * into r from public.repair_requests where id=p_repair_id for update;creating:=not found;
 if not creating and (r.jobsite_id<>p_site_id or (actor.role='engineer' and r.created_by<>actor.id)) then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into prior from public.repair_events where actor_id=actor.id and request_id=p_request_id;
 if found then
   if prior.request_payload<>payload then raise exception 'Request ID reused' using errcode='22023'; end if;
   return jsonb_build_object('repair',prior.result_snapshot,'event_no',prior.event_no,'replayed',true);
 end if;
 if creating then
   if p_expected_version<>0 or p_repair_id!~'^RR-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or p_data->>'service_report_id' is not null then
     raise exception 'Create standalone request; linked drafts come from report submission' using errcode='22023'; end if;
 else
   if r.version<>p_expected_version then raise exception 'Repair version conflict' using errcode='40001'; end if;
   if r.service_report_id is distinct from source_id or r.service_report_id is distinct from p_data->>'service_report_id'
     or (r.service_report_id is not null and (r.asset_id<>p_data->>'asset_id' or source.id is null or source.jobsite_id<>r.jobsite_id or source.asset_id<>r.asset_id)) then
     raise exception 'Preserve report/asset/site linkage' using errcode='22023'; end if;
 end if;
 select * into a from public.assets where id=p_data->>'asset_id' and jobsite_id=p_site_id;
 if not found then raise exception 'Repair asset/site mismatch' using errcode='22023'; end if;
 -- Existing enum/status semantics are preserved; no SR or Actual writes here.
 if creating then
   insert into public.repair_requests(id,jobsite_id,asset_id,asset_name,requested_date,title,description,priority,status,reported_by,resolution,created_by)
   values(p_repair_id,p_site_id,a.id,a.name,(p_data->>'requested_date')::date,p_data->>'title',p_data->>'description',
    (p_data->>'priority')::public.repair_priority,(p_data->>'status')::public.repair_status,p_data->>'reported_by',p_data->>'resolution',actor.id) returning * into saved;
 else
   update public.repair_requests set asset_id=a.id,asset_name=a.name,requested_date=(p_data->>'requested_date')::date,
    title=p_data->>'title',description=p_data->>'description',priority=(p_data->>'priority')::public.repair_priority,
    status=(p_data->>'status')::public.repair_status,reported_by=p_data->>'reported_by',resolution=p_data->>'resolution',version=r.version+1
   where id=r.id returning * into saved;
 end if;
 insert into public.repair_events(repair_id,jobsite_id,actor_id,actor_name,actor_role,request_id,command,request_payload,before_status,after_status,repair_version,result_snapshot)
 values(saved.id,saved.jobsite_id,actor.id,actor.display_name,actor.role,p_request_id,case when creating then 'create' else 'save' end,payload,r.status,saved.status,saved.version,to_jsonb(saved)) returning event_no into event_id;
 return jsonb_build_object('repair',to_jsonb(saved),'event_no',event_id,'replayed',false);
end;
$$;
revoke all on function public.save_repair_command(text,text,integer,uuid,jsonb) from public,anon;
grant execute on function public.save_repair_command(text,text,integer,uuid,jsonb) to authenticated;
