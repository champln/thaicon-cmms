begin;
create table private.contract_customer_reviewers (
 jobsite_id text references public.jobsites(id) on delete restrict,
 user_id uuid references public.profiles(id) on delete restrict,
 primary key(jobsite_id,user_id)
);
alter table private.contract_customer_reviewers enable row level security;
revoke all on private.contract_customer_reviewers from public,anon,authenticated;
alter table private.contract_accepted_evidence add column receipt_type text not null default 'uat_simulation'
 check(receipt_type in ('uat_simulation','customer'));

create function public.can_review_contract_customer(p_site text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.contract_reporting_ready() and private.can_access_jobsite(p_site)
 and private.current_user_role()='user'::public.app_role
 and exists(select 1 from private.contract_customer_reviewers where jobsite_id=p_site and user_id=auth.uid());
$$;
revoke all on function public.can_review_contract_customer(text) from public,anon;
grant execute on function public.can_review_contract_customer(text) to authenticated;

create function public.accept_contract_customer(p_site text,p_contract uuid,p_report text,p_version int,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 sr public.service_reports;
 c public.maintenance_contracts;
 g public.contract_asset_groups;
 receipt private.contract_accepted_evidence;
begin
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
revoke all on function public.accept_contract_customer(text,uuid,text,int,text) from public,anon;
grant execute on function public.accept_contract_customer(text,uuid,text,int,text) to authenticated;

create table private.contract_deliveries (
 id uuid primary key,
 jobsite_id text not null,
 contract_id uuid not null,
 contract_name text not null,
 period text not null,
 revision integer not null check(revision>0),
 issued_at timestamptz not null default now(),
 issued_by uuid not null,
 pdf bytea not null,
 xlsx bytea not null,
 foreign key(contract_id,jobsite_id) references public.maintenance_contracts(id,jobsite_id),
 unique(contract_id,revision)
);
create index contract_deliveries_site_idx on private.contract_deliveries(jobsite_id,issued_at);
alter table private.contract_deliveries enable row level security;
revoke all on private.contract_deliveries from public,anon,authenticated;

create function public.issue_contract_delivery(p_site text,p_contract uuid,p_contract_version int,p_id uuid,
 p_revision int,p_period text,p_pdf text,p_xlsx text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c public.maintenance_contracts;
 issue private.contract_deliveries;
 pdf_bytes bytea;
 xlsx_bytes bytea;
begin
 if private.current_user_role() is distinct from 'admin'::public.app_role or
  not public.contract_reporting_ready() or not private.can_access_jobsite(p_site) then
  raise exception 'Delivery issue denied' using errcode='42501';
 end if;
 if p_id is null or p_revision is null or p_revision<1 or p_period is null or length(btrim(p_period)) not between 1 and 80
  or p_pdf is null or p_xlsx is null or length(p_pdf)+length(p_xlsx)>12000000 then
  raise exception 'Invalid delivery payload' using errcode='22023';
 end if;
 pdf_bytes:=decode(p_pdf,'base64');
 xlsx_bytes:=decode(p_xlsx,'base64');
 if substring(pdf_bytes from 1 for 5)<>decode('255044462d','hex') or
    substring(xlsx_bytes from 1 for 4)<>decode('504b0304','hex') then
  raise exception 'Invalid delivery file formats' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_contract::text,1));
 select * into c from public.maintenance_contracts where id=p_contract and jobsite_id=p_site;
 if not found then raise exception 'Contract not found' using errcode='P0002'; end if;
 select * into issue from private.contract_deliveries where id=p_id;
 if found then
  if issue.jobsite_id<>p_site or issue.contract_id<>p_contract or issue.issued_by<>auth.uid()
    or issue.revision<>p_revision or issue.period<>btrim(p_period) or issue.pdf<>pdf_bytes or issue.xlsx<>xlsx_bytes then
   raise exception 'Delivery key reused' using errcode='22023';
  end if;
 else
  if c.version is distinct from p_contract_version or p_revision<>(select coalesce(max(revision),0)+1
      from private.contract_deliveries where contract_id=p_contract) then
   raise exception 'Contract or revision changed' using errcode='40001';
  end if;
  insert into private.contract_deliveries(id,jobsite_id,contract_id,contract_name,period,revision,issued_by,pdf,xlsx)
  values(p_id,p_site,p_contract,c.name,btrim(p_period),p_revision,auth.uid(),pdf_bytes,xlsx_bytes) returning * into issue;
 end if;
 return to_jsonb(issue)-'pdf'-'xlsx';
end;
$$;
revoke all on function public.issue_contract_delivery(text,uuid,int,uuid,int,text,text,text) from public,anon;
grant execute on function public.issue_contract_delivery(text,uuid,int,uuid,int,text,text,text) to authenticated;

create function public.list_contract_deliveries(p_site text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.contract_reporting_ready() or not private.can_access_jobsite(p_site) then
  raise exception 'Delivery access denied' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'jobsite_id',d.jobsite_id,'contract_id',d.contract_id,
  'contract_name',d.contract_name,'period',d.period,'revision',d.revision,'issued_at',d.issued_at)
  order by d.issued_at desc,d.id) from private.contract_deliveries d where d.jobsite_id=p_site),'[]'::jsonb);
end;
$$;
revoke all on function public.list_contract_deliveries(text) from public,anon;
grant execute on function public.list_contract_deliveries(text) to authenticated;

create function public.read_contract_delivery_file(p_site text,p_id uuid,p_format text)
returns text language plpgsql stable security definer set search_path='' as $$
declare
 file_bytes bytea;
begin
 if not public.contract_reporting_ready() or not private.can_access_jobsite(p_site) then
  raise exception 'Delivery access denied' using errcode='42501';
 end if;
 if p_format is null or p_format not in ('pdf','xlsx') then
  raise exception 'Invalid format' using errcode='22023';
 end if;
 select case when p_format='pdf' then d.pdf else d.xlsx end into file_bytes
 from private.contract_deliveries d where d.id=p_id and d.jobsite_id=p_site;
 if not found then raise exception 'Delivery not found' using errcode='P0002'; end if;
 return encode(file_bytes,'base64');
end;
$$;
revoke all on function public.read_contract_delivery_file(text,uuid,text) from public,anon;
grant execute on function public.read_contract_delivery_file(text,uuid,text) to authenticated;
commit;
