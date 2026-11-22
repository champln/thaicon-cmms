-- Unactivated feature. Only new contract tables are affected.
begin;
create table public.contract_asset_memberships (
 contract_id uuid not null,
 jobsite_id text not null,
 group_id uuid not null,
 asset_id text not null,
 primary key (contract_id, asset_id),
 foreign key (group_id,contract_id,jobsite_id)
  references public.contract_asset_groups(id,contract_id,jobsite_id),
 foreign key (jobsite_id,asset_id) references public.assets(jobsite_id,id) on delete restrict
);
create index contract_asset_memberships_group_idx on public.contract_asset_memberships(group_id,contract_id,jobsite_id);
create index contract_asset_memberships_asset_idx on public.contract_asset_memberships(jobsite_id,asset_id);
alter table public.contract_asset_memberships enable row level security;
revoke all on public.contract_asset_memberships from public,anon,authenticated;

create table private.contract_reporting_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into private.contract_reporting_settings default values;
revoke all on private.contract_reporting_settings from public,anon,authenticated;
create table private.contract_definition_receipts (
 actor_id uuid not null, request_id uuid not null,
 payload jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(actor_id,request_id)
);
revoke all on private.contract_definition_receipts from public,anon,authenticated;
alter table private.contract_reporting_settings enable row level security;
alter table private.contract_definition_receipts enable row level security;

create function public.contract_reporting_ready() returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and private.current_user_role() is not null
 and coalesce((select enabled from private.contract_reporting_settings where singleton),false);
$$;
revoke all on function public.contract_reporting_ready() from public;
grant execute on function public.contract_reporting_ready() to authenticated;

-- Whole-definition save is atomic; no legacy PM plan/cycle is updated.
-- Groups/targets are replaced only before future work evidence is introduced.
create function public.save_contract_definition(
 p_id uuid,p_site text,p_expected_version integer,p_request_id uuid,p_definition jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 current_row public.maintenance_contracts;
 prior private.contract_definition_receipts;
 payload jsonb; result jsonb; g jsonb; t jsonb;
 starts date; ends date; next_version integer;
begin
 if auth.uid() is null or private.current_user_role() is distinct from 'admin'::public.app_role
 or not private.can_access_jobsite(p_site) or not public.contract_reporting_ready() then
  raise exception 'Contract access denied' using errcode='42501';
 end if;
 if p_id is null or p_request_id is null or p_expected_version is null or p_expected_version<0
 or jsonb_typeof(p_definition) is distinct from 'object'
 or not p_definition ?& array['name','starts_on','ends_on','groups','targets']
 or exists(select 1 from jsonb_object_keys(p_definition) k where k not in ('name','starts_on','ends_on','groups','targets','members'))
 or jsonb_typeof(p_definition->'name') is distinct from 'string'
 or length(btrim(p_definition->>'name')) not between 1 and 200
 or jsonb_typeof(p_definition->'groups') is distinct from 'array'
 or jsonb_typeof(p_definition->'targets') is distinct from 'array'
 or (p_definition ? 'members' and jsonb_typeof(p_definition->'members') is distinct from 'array') then
  raise exception 'Invalid definition' using errcode='22023';
 end if;
 starts := (p_definition->>'starts_on')::date; ends := (p_definition->>'ends_on')::date;
 if starts is null or ends is null or ends<starts or ends>=starts+interval '10 years'
 or jsonb_array_length(p_definition->'groups')>500 or jsonb_array_length(p_definition->'targets')>120000
 or jsonb_array_length(p_definition->'members')>10000 then
  raise exception 'Invalid contract interval/size' using errcode='22023';
 end if;
 payload:=jsonb_build_object('id',p_id,'site',p_site,'version',p_expected_version,'definition',p_definition);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from private.contract_definition_receipts where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.payload<>payload then raise exception 'Request key reused' using errcode='22023'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
 select * into current_row from public.maintenance_contracts where id=p_id for update;
 if found then
  if current_row.jobsite_id<>p_site then raise exception 'Contract access denied' using errcode='42501'; end if;
  if current_row.version<>p_expected_version then raise exception 'Contract changed' using errcode='40001'; end if;
 else
  if p_expected_version<>0 then raise exception 'Contract missing' using errcode='40001'; end if;
 end if;
 next_version:=p_expected_version+1;
 if not p_definition ? 'members' and exists(select 1 from public.contract_asset_memberships where contract_id=p_id) then
  raise exception 'Current membership list required' using errcode='22023';
 end if;
 insert into public.maintenance_contracts(id,jobsite_id,name,starts_on,ends_on,version)
 values(p_id,p_site,btrim(p_definition->>'name'),starts,ends,next_version)
 on conflict(id) do update set name=excluded.name,starts_on=excluded.starts_on,ends_on=excluded.ends_on,version=excluded.version;
 delete from public.contract_month_targets where contract_id=p_id;
 delete from public.contract_asset_memberships where contract_id=p_id;
 delete from public.contract_asset_groups where contract_id=p_id;
 for g in select value from jsonb_array_elements(p_definition->'groups') loop
  if jsonb_typeof(g) is distinct from 'object' or not g ?& array['id','name','building','asset_type','major_frequency','minor_frequency']
  or exists(select 1 from jsonb_object_keys(g) k where k not in ('id','name','building','asset_type','major_frequency','minor_frequency'))
  or jsonb_typeof(g->'name') is distinct from 'string' or jsonb_typeof(g->'building') is distinct from 'string'
  or length(btrim(g->>'name')) not between 1 and 200 or length(btrim(g->>'building')) not between 1 and 100
  or jsonb_typeof(g->'major_frequency') is distinct from 'number' or jsonb_typeof(g->'minor_frequency') is distinct from 'number'
  or (g->>'major_frequency')::numeric<>trunc((g->>'major_frequency')::numeric)
  or (g->>'minor_frequency')::numeric<>trunc((g->>'minor_frequency')::numeric) then
   raise exception 'Invalid group' using errcode='22023';
  end if;
  insert into public.contract_asset_groups(id,contract_id,jobsite_id,name,building,asset_type,major_frequency,minor_frequency)
  values((g->>'id')::uuid,p_id,p_site,btrim(g->>'name'),btrim(g->>'building'),g->>'asset_type',(g->>'major_frequency')::integer,(g->>'minor_frequency')::integer);
 end loop;
 for t in select value from jsonb_array_elements(p_definition->'targets') loop
  if jsonb_typeof(t) is distinct from 'object' or not t ?& array['group_id','month_start','cleaning_kind','target']
  or exists(select 1 from jsonb_object_keys(t) k where k not in ('group_id','month_start','cleaning_kind','target'))
  or jsonb_typeof(t->'target') is distinct from 'number' or (t->>'target')::numeric<>trunc((t->>'target')::numeric)
  or (t->>'month_start')::date<date_trunc('month',starts)::date or (t->>'month_start')::date>ends then
   raise exception 'Invalid monthly target' using errcode='22023';
  end if;
  insert into public.contract_month_targets(contract_id,jobsite_id,group_id,month_start,cleaning_kind,target)
  values(p_id,p_site,(t->>'group_id')::uuid,(t->>'month_start')::date,t->>'cleaning_kind',(t->>'target')::integer);
 end loop;
 for t in select value from jsonb_array_elements(coalesce(p_definition->'members','[]'::jsonb)) loop
  if jsonb_typeof(t) is distinct from 'object' or not t ?& array['group_id','asset_id']
  or exists(select 1 from jsonb_object_keys(t) k where k not in ('group_id','asset_id'))
  or jsonb_typeof(t->'asset_id') is distinct from 'string' or length(btrim(t->>'asset_id'))=0 then
   raise exception 'Invalid asset membership' using errcode='22023';
  end if;
  insert into public.contract_asset_memberships(contract_id,jobsite_id,group_id,asset_id)
  values(p_id,p_site,(t->>'group_id')::uuid,t->>'asset_id');
 end loop;
 result:=jsonb_build_object('id',p_id,'site_id',p_site,'version',next_version,'replayed',false);
 insert into private.contract_definition_receipts(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,payload,result);
 return result;
end;
$$;
revoke all on function public.save_contract_definition(uuid,text,integer,uuid,jsonb) from public;
grant execute on function public.save_contract_definition(uuid,text,integer,uuid,jsonb) to authenticated;

create function public.read_contract_definition(p_id uuid,p_site text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if not public.contract_reporting_ready() or not private.can_access_jobsite(p_site) then
  raise exception 'Contract access denied' using errcode='42501';
 end if;
 select jsonb_build_object('contract',to_jsonb(c),
 'groups',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.contract_asset_groups g where g.contract_id=c.id),'[]'::jsonb),
 'targets',coalesce((select jsonb_agg(to_jsonb(t) order by t.month_start,t.group_id,t.cleaning_kind) from public.contract_month_targets t where t.contract_id=c.id),'[]'::jsonb),
 'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.asset_id) from public.contract_asset_memberships m where m.contract_id=c.id),'[]'::jsonb))
 into result from public.maintenance_contracts c where c.id=p_id and c.jobsite_id=p_site;
 if result is null then raise exception 'Contract not found' using errcode='P0002'; end if;
 return result;
end;
$$;
revoke all on function public.read_contract_definition(uuid,text) from public;
grant execute on function public.read_contract_definition(uuid,text) to authenticated;
create function public.list_contract_definitions(p_site text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if not public.contract_reporting_ready() or not private.can_access_jobsite(p_site) then
  raise exception 'Contract access denied' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',c.id,'site_id',c.jobsite_id,'name',c.name,'starts_on',c.starts_on,'ends_on',c.ends_on
 ) order by c.starts_on desc,c.id) from public.maintenance_contracts c where c.jobsite_id=p_site),'[]'::jsonb);
end;
$$;
revoke all on function public.list_contract_definitions(text) from public;
grant execute on function public.list_contract_definitions(text) to authenticated;
commit;
