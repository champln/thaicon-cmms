begin;

create table private.contract_reviewer_events (
 actor_id uuid not null,
 request_id uuid not null,
 jobsite_id text not null,
 user_id uuid not null,
 granted boolean not null,
 changed boolean not null,
 occurred_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
alter table private.contract_reviewer_events enable row level security;
revoke all on private.contract_reviewer_events from public,anon,authenticated;

create function public.list_contract_reviewers(p_site text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_user_role() is distinct from 'admin'::public.app_role
    or not public.contract_reporting_ready() or not private.can_access_jobsite(p_site) then
  raise exception 'Reviewer management denied' using errcode='42501';
 end if;
 if not exists(select 1 from public.jobsites where id=p_site and is_active) then
  raise exception 'Active site not found' using errcode='P0002';
 end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'user_id',p.id,'username',p.username,'display_name',p.display_name,
   'assigned',r.user_id is not null,'eligible',p.is_active and p.role='user' and a.user_id is not null
  ) order by r.user_id is not null desc,p.display_name,p.id)
  from public.profiles p
  left join public.user_jobsites a on a.user_id=p.id and a.jobsite_id=p_site
  left join private.contract_customer_reviewers r on r.user_id=p.id and r.jobsite_id=p_site
  where r.user_id is not null or (p.is_active and p.role='user' and a.user_id is not null)
 ),'[]'::jsonb);
end;
$$;
revoke all on function public.list_contract_reviewers(text) from public,anon;
grant execute on function public.list_contract_reviewers(text) to authenticated;

create function public.set_contract_reviewer(p_site text,p_user uuid,p_grant boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 prior private.contract_reviewer_events;
 affected integer;
begin
 if private.current_user_role() is distinct from 'admin'::public.app_role
    or not public.contract_reporting_ready() or not private.can_access_jobsite(p_site) then
  raise exception 'Reviewer management denied' using errcode='42501';
 end if;
 if p_user is null or p_grant is null or p_request_id is null then
  raise exception 'Invalid reviewer request' using errcode='22023';
 end if;
 if not exists(select 1 from public.jobsites where id=p_site and is_active) then
  raise exception 'Active site not found' using errcode='P0002';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_id::text,22));
 select * into prior from private.contract_reviewer_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if (prior.jobsite_id,prior.user_id,prior.granted) is distinct from (p_site,p_user,p_grant) then
   raise exception 'Reviewer request key reused' using errcode='22023';
  end if;
  return jsonb_build_object('changed',prior.changed,'replayed',true);
 end if;
 -- The same lock is acquired before the customer's acceptance permission check.
 perform pg_advisory_xact_lock(hashtextextended(p_site||':'||p_user::text,23));
 if p_grant then
  if not exists(select 1 from public.profiles p join public.user_jobsites a on a.user_id=p.id
   where p.id=p_user and p.role='user' and p.is_active and a.jobsite_id=p_site) then
   raise exception 'Reviewer must be an active User assigned to this site' using errcode='22023';
  end if;
  insert into private.contract_customer_reviewers(jobsite_id,user_id) values(p_site,p_user) on conflict do nothing;
 else
  delete from private.contract_customer_reviewers where jobsite_id=p_site and user_id=p_user;
 end if;
 get diagnostics affected = row_count;
 insert into private.contract_reviewer_events(actor_id,request_id,jobsite_id,user_id,granted,changed)
 values(auth.uid(),p_request_id,p_site,p_user,p_grant,affected>0);
 return jsonb_build_object('changed',affected>0,'replayed',false);
end;
$$;
revoke all on function public.set_contract_reviewer(text,uuid,boolean,uuid) from public,anon;
grant execute on function public.set_contract_reviewer(text,uuid,boolean,uuid) to authenticated;

create or replace function public.can_review_contract_customer(p_site text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.contract_reporting_ready() and private.can_access_jobsite(p_site)
 and private.current_user_role()='user'::public.app_role
 and exists(select 1 from public.jobsites where id=p_site and is_active)
 and exists(select 1 from private.contract_customer_reviewers where jobsite_id=p_site and user_id=auth.uid()),false);
$$;

create or replace function public.accept_contract_customer(p_site text,p_contract uuid,p_report text,p_version int,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 sr public.service_reports;
 c public.maintenance_contracts;
 g public.contract_asset_groups;
 receipt private.contract_accepted_evidence;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_site||chr(58)||auth.uid()::text,23));
 if public.can_review_contract_customer(p_site) is not true then
  raise exception 'Customer review denied' using errcode='42501';
 end if;
 if p_kind is null or p_kind not in ('major','minor') or p_version is null then
  raise exception 'Invalid acceptance' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_contract::text,1));
 select * into c from public.maintenance_contracts where id=p_contract and jobsite_id=p_site;
 if not found then raise exception 'Contract not found' using errcode='P0002'; end if;
 select * into sr from public.service_reports where id=p_report and jobsite_id=p_site for update;
 if not found then raise exception 'Report not found' using errcode='P0002'; end if;
 if sr.version<>p_version or sr.status<>'approved' or sr.quantity<>1 or sr.approved_by is null
  or sr.approved_at is null or sr.service_date not between c.starts_on and c.ends_on then
  raise exception 'Approved single-visit report required' using errcode='22023';
 end if;
 select * into receipt from private.contract_accepted_evidence where jobsite_id=p_site and report_id=p_report;
 if found then
  if receipt.contract_id=p_contract and receipt.report_version=p_version and receipt.kind=p_kind
    and receipt.receipt_type='customer' and receipt.accepted_by=auth.uid() then
   return jsonb_build_object('id',receipt.id,'accepted_at',receipt.accepted_at);
  end if;
  raise exception 'Report already recorded' using errcode='23505';
 end if;
 select groups.* into g from public.contract_asset_memberships m
 join public.contract_asset_groups groups on (groups.id,groups.contract_id,groups.jobsite_id)=(m.group_id,m.contract_id,m.jobsite_id)
 where m.contract_id=p_contract and m.jobsite_id=p_site and m.asset_id=sr.asset_id;
 if not found then raise exception 'Asset not in contract' using errcode='22023'; end if;
 insert into private.contract_accepted_evidence(jobsite_id,contract_id,contract_version,group_id,building,asset_type,
  asset_id,report_id,report_version,service_date,kind,approved_by,approved_at,accepted_by,receipt_type)
 values(p_site,p_contract,c.version,g.id,g.building,g.asset_type,sr.asset_id,p_report,p_version,sr.service_date,p_kind,
  sr.approved_by,sr.approved_at,auth.uid(),'customer') returning * into receipt;
 return jsonb_build_object('id',receipt.id,'accepted_at',receipt.accepted_at);
end;
$$;
commit;
