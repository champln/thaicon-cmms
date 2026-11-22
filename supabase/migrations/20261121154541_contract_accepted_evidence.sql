begin;
create table private.contract_accepted_evidence (
 id uuid primary key default gen_random_uuid(),
 jobsite_id text not null,
 contract_id uuid not null,
 contract_version int not null,
 group_id uuid not null,
 building text not null,
 asset_type text not null,
 asset_id text not null,
 report_id text not null,
 report_version int not null,
 service_date date not null,
 kind text not null check(kind in ('major','minor')),
 approved_by uuid not null,
 approved_at timestamptz not null,
 accepted_by uuid not null,
 accepted_at timestamptz not null default now(),
 foreign key(contract_id,jobsite_id) references public.maintenance_contracts(id,jobsite_id),
 unique(jobsite_id,report_id),
 unique(contract_id,asset_id,service_date,kind)
);
alter table private.contract_accepted_evidence enable row level security;
revoke all on private.contract_accepted_evidence from public,anon,authenticated;

-- UAT records a simulated receipt separately from the internal approval.
create function public.record_contract_uat_acceptance(p_site text,p_contract uuid,p_report text,p_version int,p_kind text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 source public.service_reports;
 contract public.maintenance_contracts;
 asset_group public.contract_asset_groups;
 existing private.contract_accepted_evidence;
 result uuid;
begin
 if private.current_user_role() is distinct from 'admin'::public.app_role or
    not private.can_access_jobsite(p_site) or not public.contract_reporting_ready() then
  raise exception 'Contract access denied' using errcode='42501';
 end if;
 if p_kind is null or p_kind not in ('major','minor') or p_version is null then
  raise exception 'Invalid acceptance' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_contract::text,1));
 select * into contract from public.maintenance_contracts where id=p_contract and jobsite_id=p_site;
 if not found then raise exception 'Contract not found' using errcode='P0002'; end if;
 select * into source from public.service_reports where id=p_report and jobsite_id=p_site for update;
 if not found then raise exception 'Report not found' using errcode='P0002'; end if;
 if source.version<>p_version or source.status<>'approved' or source.quantity<>1
 or source.approved_by is null or source.approved_at is null
 or source.service_date not between contract.starts_on and contract.ends_on then
  raise exception 'Approved single-visit report required' using errcode='22023';
 end if;
 select * into existing from private.contract_accepted_evidence where jobsite_id=p_site and report_id=p_report;
 if found then
  if existing.contract_id=p_contract and existing.report_version=p_version and existing.kind=p_kind then return existing.id; end if;
  raise exception 'Report already recorded' using errcode='23505';
 end if;
 select g.* into asset_group from public.contract_asset_memberships m
 join public.contract_asset_groups g on (g.id,g.contract_id,g.jobsite_id)=(m.group_id,m.contract_id,m.jobsite_id)
 where m.contract_id=p_contract and m.jobsite_id=p_site and m.asset_id=source.asset_id;
 if not found then raise exception 'Asset not in contract' using errcode='22023'; end if;
 insert into private.contract_accepted_evidence(jobsite_id,contract_id,contract_version,group_id,building,asset_type,asset_id,
 report_id,report_version,service_date,kind,approved_by,approved_at,accepted_by)
 values(p_site,p_contract,contract.version,asset_group.id,asset_group.building,asset_group.asset_type,source.asset_id,
 p_report,p_version,source.service_date,p_kind,source.approved_by,source.approved_at,auth.uid()) returning id into result;
 return result;
end;
$$;
revoke all on function public.record_contract_uat_acceptance(text,uuid,text,int,text) from public,anon;
grant execute on function public.record_contract_uat_acceptance(text,uuid,text,int,text) to authenticated;

create function public.read_contract_accepted_evidence(p_site text,p_contract uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.contract_reporting_ready() or not private.can_access_jobsite(p_site) then
  raise exception 'Contract access denied' using errcode='42501';
 end if;
 if not exists(select 1 from public.maintenance_contracts where id=p_contract and jobsite_id=p_site) then
  raise exception 'Contract not found' using errcode='P0002';
 end if;
 return coalesce((select jsonb_agg(to_jsonb(e) order by e.service_date,e.id)
 from private.contract_accepted_evidence e where e.jobsite_id=p_site and e.contract_id=p_contract),'[]'::jsonb);
end;
$$;
revoke all on function public.read_contract_accepted_evidence(text,uuid) from public,anon;
grant execute on function public.read_contract_accepted_evidence(text,uuid) to authenticated;
commit;
