-- Forward-only, default-OFF plan/cycle commands. No historical field rewrite.
create table private.plan_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private.plan_settings values(true,false);
revoke all on private.plan_settings from public,anon,authenticated;
create function private.plan_commands_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from private.plan_settings where singleton),false);
$$;
revoke all on function private.plan_commands_enabled() from public,anon;
grant execute on function private.plan_commands_enabled() to authenticated;
create function public.plan_commands_ready() returns boolean language sql stable security definer set search_path='' as $$
 select private.plan_commands_enabled() and private.current_user_role() is not null;
$$;
revoke all on function public.plan_commands_ready() from public,anon;
grant execute on function public.plan_commands_ready() to authenticated;
alter table public.maintenance_plans add column version integer not null default 1 check(version>0);
-- No FK to the plan row: a permitted hard delete must retain its audit.
create table public.plan_events(
 event_no bigint generated always as identity primary key,plan_id text not null,
 jobsite_id text not null references public.jobsites(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,actor_name text not null,actor_role public.app_role not null,
 request_id uuid not null,command text not null check(command in ('create','save','delete')),
 request_payload jsonb not null,plan_version integer not null check(plan_version>0),
 before_snapshot jsonb,result_snapshot jsonb not null,created_at timestamptz not null default now(),unique(actor_id,request_id)
);
alter table public.plan_events enable row level security;
create policy "scoped plan events read" on public.plan_events for select to authenticated using(private.can_access_jobsite(jobsite_id));
revoke all on public.plan_events from public,anon,authenticated;
grant select on public.plan_events to authenticated;
create function private.immutable_plan_event() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Plan audit immutable' using errcode='42501'; end;
$$;
revoke all on function private.immutable_plan_event() from public,anon,authenticated;
create trigger plan_events_immutable before update or delete on public.plan_events for each row execute function private.immutable_plan_event();
create function private.plan_id_used(p_id text) returns boolean language sql stable security definer set search_path='' as $$
 select private.current_user_role()='admin' and exists(select 1 from public.plan_events where plan_id=p_id);
$$;
revoke all on function private.plan_id_used(text) from public,anon;
grant execute on function private.plan_id_used(text) to authenticated;
create function private.guard_plan_command_write() returns trigger language plpgsql set search_path='' as $$
declare owner_write boolean;
begin
 select current_user=pg_catalog.pg_get_userbyid(c.relowner) into owner_write from pg_catalog.pg_class c where c.oid=tg_relid;
 if private.plan_commands_enabled() and not owner_write then raise exception 'Use plan command' using errcode='42501'; end if;
 if tg_table_name='maintenance_plans' and not owner_write then
   if tg_op='INSERT' then
     if new.version<>1 then raise exception 'Server version required' using errcode='42501'; end if;
     if private.plan_id_used(new.id) and not exists(select 1 from public.maintenance_plans where id=new.id) then raise exception 'Historical command ID cannot be reused' using errcode='22023'; end if;
   elsif tg_op='UPDATE' then
     if new.version is distinct from old.version then raise exception 'Server version required' using errcode='42501'; end if;
     new.version:=old.version+1;
   end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function private.guard_plan_command_write() from public,anon,authenticated;
create trigger maintenance_plans_command_guard before insert or update or delete on public.maintenance_plans for each row execute function private.guard_plan_command_write();
create trigger plan_cycles_command_guard before insert or update or delete on public.plan_cycles for each row execute function private.guard_plan_command_write();

-- Serializes first report creation with a command schedule edit/delete. Lock
-- the parent before checking current cycles so a waited read rechecks scope.
-- A scoped definer is needed: Engineer may read a plan but its Admin-only
-- UPDATE RLS otherwise filters SELECT FOR SHARE out in an invoker trigger.
create function private.lock_report_plan(p_plan_id text,p_site_id text) returns void language plpgsql security definer set search_path='' as $$
begin
 if private.current_user_role() not in ('admin','engineer') or private.current_user_role() is null or not private.can_access_jobsite(p_site_id) then raise exception 'Report plan scope denied' using errcode='42501'; end if;
 perform 1 from public.maintenance_plans where id=p_plan_id and jobsite_id=p_site_id for share;
 if not found then raise exception 'Report plan missing' using errcode='22023'; end if;
end;
$$;
revoke all on function private.lock_report_plan(text,text) from public,anon;
grant execute on function private.lock_report_plan(text,text) to authenticated;
create or replace function public.validate_report_scope() returns trigger language plpgsql set search_path='' as $$
begin
 if private.plan_commands_enabled() then
   perform private.lock_report_plan(new.plan_id,new.jobsite_id);
 end if;
 if not exists(select 1 from public.maintenance_plans p join public.plan_cycles c on c.plan_id=p.id
   where p.id=new.plan_id and p.jobsite_id=new.jobsite_id and c.id=new.cycle_id) then
   if private.plan_commands_enabled() then raise exception 'Service Report plan, cycle, and Jobsite do not match' using errcode='22023';
   else raise exception 'Service Report plan, cycle, and Jobsite do not match'; end if;
 end if;
 if private.plan_commands_enabled() and private.service_report_drafts_enabled() and exists(select 1 from public.maintenance_plans where id=new.plan_id and status='completed') then
   raise exception 'Report plan is closed' using errcode='22023';
 end if;
 return new;
end;
$$;

create function public.apply_plan_command(p_plan_id text,p_site_id text,p_expected_version integer,p_request_id uuid,p_data jsonb,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;p public.maintenance_plans%rowtype;saved public.maintenance_plans%rowtype;
 prior public.plan_events%rowtype;payload jsonb;before_data jsonb;result jsonb;creating boolean;event_id bigint;v integer;
begin
 if not private.plan_commands_enabled() then raise exception 'Plan commands disabled' using errcode='42501'; end if;
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if not found or actor.role<>'admin' or not private.can_access_jobsite(p_site_id) or not exists(select 1 from public.jobsites where id=p_site_id and is_active) then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0 or p_delete is null or p_plan_id is null or length(p_plan_id) not between 1 and 100 or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid plan request' using errcode='22023'; end if;
 if p_delete then
   if p_data<>'{}'::jsonb then raise exception 'Delete payload must be empty' using errcode='22023'; end if;
 else
   if not p_data ?& array['name','service_type','plan_year','annual_target','cycle_months','start_month','status']
     or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('name','service_type','plan_year','annual_target','cycle_months','start_month','status'))
     or exists(select 1 from unnest(array['name','service_type','status']) k where jsonb_typeof(p_data->k) is distinct from 'string' or length(btrim(p_data->>k)) not between 1 and 4000)
     or exists(select 1 from unnest(array['plan_year','annual_target','cycle_months','start_month']) k where jsonb_typeof(p_data->k) is distinct from 'number' or (p_data->>k)::numeric<>trunc((p_data->>k)::numeric))
     or (p_data->>'plan_year')::numeric not between 2020 and 2200 or (p_data->>'annual_target')::numeric not between 1 and 2147483647
     or (p_data->>'cycle_months')::numeric not in (1,2,3) or (p_data->>'start_month')::numeric not between 1 and 12
     or p_data->>'status' not in ('draft','active','completed') then raise exception 'Invalid plan values' using errcode='22023'; end if;
 end if;
 payload:=jsonb_build_object('plan_id',p_plan_id,'site_id',p_site_id,'expected_version',p_expected_version,'data',p_data,'delete',p_delete);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text||':plan:'||p_request_id::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plan:'||p_plan_id,0));
 select * into p from public.maintenance_plans where id=p_plan_id for update;creating:=not found;
 if not creating and p.jobsite_id<>p_site_id then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into prior from public.plan_events where actor_id=actor.id and request_id=p_request_id;
 if found then
   if prior.request_payload<>payload then raise exception 'Request ID reused' using errcode='22023'; end if;
   return prior.result_snapshot||jsonb_build_object('event_no',prior.event_no,'replayed',true);
 end if;
 if creating then
   if p_delete or p_expected_version<>0 or p_plan_id!~'^PLAN-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or exists(select 1 from public.plan_events where plan_id=p_plan_id) then raise exception 'Missing or previously used plan' using errcode='22023'; end if;
 else
   if p.version<>p_expected_version then raise exception 'Plan version conflict' using errcode='40001'; end if;
   before_data:=jsonb_build_object('plan',to_jsonb(p),'cycles',coalesce((select jsonb_agg(to_jsonb(c) order by sequence) from public.plan_cycles c where plan_id=p.id),'[]'::jsonb));
   if exists(select 1 from public.service_reports where plan_id=p.id) and (p_delete or (p_data->>'cycle_months')::integer is distinct from p.cycle_months or (p_data->>'start_month')::integer is distinct from p.start_month) then
     raise exception 'Referenced plan/cycle schedule is locked' using errcode='22023'; end if;
 end if;
 v:=case when creating then 1 else p.version+1 end;
 if p_delete then
   delete from public.maintenance_plans where id=p.id;
   result:=jsonb_build_object('id',p.id,'site_id',p.jobsite_id,'version',v,'deleted',true,'plan',null,'cycles','[]'::jsonb);
 else
   if creating then
     insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,start_month,status,created_by)
     values(p_plan_id,p_site_id,p_data->>'name',p_data->>'service_type',(p_data->>'plan_year')::integer,(p_data->>'annual_target')::integer,(p_data->>'cycle_months')::integer,(p_data->>'start_month')::integer,(p_data->>'status')::public.plan_status,actor.id) returning * into saved;
   elsif (p_data->>'annual_target')::integer is distinct from p.annual_target or (p_data->>'cycle_months')::integer is distinct from p.cycle_months or (p_data->>'start_month')::integer is distinct from p.start_month then
     update public.maintenance_plans set name=p_data->>'name',service_type=p_data->>'service_type',plan_year=(p_data->>'plan_year')::integer,
       annual_target=(p_data->>'annual_target')::integer,cycle_months=(p_data->>'cycle_months')::integer,start_month=(p_data->>'start_month')::integer,status=(p_data->>'status')::public.plan_status,version=v where id=p.id returning * into saved;
   else
     -- Name/status-only edits never rebuild or rewrite historical cycle targets.
     update public.maintenance_plans set name=p_data->>'name',service_type=p_data->>'service_type',plan_year=(p_data->>'plan_year')::integer,status=(p_data->>'status')::public.plan_status,version=v where id=p.id returning * into saved;
   end if;
   result:=jsonb_build_object('id',saved.id,'site_id',saved.jobsite_id,'version',saved.version,'deleted',false,'plan',to_jsonb(saved),'cycles',coalesce((select jsonb_agg(to_jsonb(c) order by sequence) from public.plan_cycles c where plan_id=saved.id),'[]'::jsonb));
 end if;
 insert into public.plan_events(plan_id,jobsite_id,actor_id,actor_name,actor_role,request_id,command,request_payload,plan_version,before_snapshot,result_snapshot)
 values(p_plan_id,p_site_id,actor.id,actor.display_name,actor.role,p_request_id,case when p_delete then 'delete' when creating then 'create' else 'save' end,payload,v,before_data,result) returning event_no into event_id;
 return result||jsonb_build_object('event_no',event_id,'replayed',false);
end;
$$;
revoke all on function public.apply_plan_command(text,text,integer,uuid,jsonb,boolean) from public,anon;
grant execute on function public.apply_plan_command(text,text,integer,uuid,jsonb,boolean) to authenticated;

-- Positive scoped evidence for reads/deletes, not an unqualified empty REST
-- result that could equally mean lost permissions. Keeps deleted audit intact.
create function public.read_plan_command_state(p_plan_id text,p_site_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.maintenance_plans%rowtype;tombstone public.plan_events%rowtype;
begin
 if private.current_user_role() is null or not private.can_access_jobsite(p_site_id) or not exists(select 1 from public.jobsites where id=p_site_id and is_active) then raise exception 'Plan read scope denied' using errcode='42501'; end if;
 select * into p from public.maintenance_plans where id=p_plan_id;
 if found then
   if p.jobsite_id<>p_site_id then raise exception 'Plan read scope denied' using errcode='42501'; end if;
   return jsonb_build_object('id',p.id,'site_id',p.jobsite_id,'version',p.version,'deleted',false,'plan',to_jsonb(p),'cycles',coalesce((select jsonb_agg(to_jsonb(c) order by sequence) from public.plan_cycles c where plan_id=p.id),'[]'::jsonb));
 end if;
 select * into tombstone from public.plan_events where plan_id=p_plan_id and jobsite_id=p_site_id and command='delete' order by plan_version desc limit 1;
 if not found then raise exception 'No confirmed plan or deletion' using errcode='22023'; end if;
 return tombstone.result_snapshot;
end;
$$;
revoke all on function public.read_plan_command_state(text,text) from public,anon;
grant execute on function public.read_plan_command_state(text,text) to authenticated;
