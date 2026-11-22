begin;

-- Site deletion will use a dedicated command after durable backup and
-- dependency checks are available. Browser roles cannot delete directly.
revoke delete on public.jobsites from public,anon,authenticated;

create table private.site_audit_log (
 event_id bigint generated always as identity primary key,
 jobsite_id text,
 actor_id uuid,
 actor_name text,
 action text not null,
 entity text not null,
 record_id text,
 changed_fields text[] not null default '{}',
 occurred_at timestamptz not null default clock_timestamp()
);
create index site_audit_scope_idx on private.site_audit_log(jobsite_id,event_id desc);
alter table private.site_audit_log enable row level security;
revoke all on private.site_audit_log from public,anon,authenticated;

create function private.capture_site_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 before_row jsonb := case when tg_op<>'INSERT' then to_jsonb(old) end;
 after_row jsonb := case when tg_op<>'DELETE' then to_jsonb(new) end;
 subject jsonb := coalesce(after_row,before_row);
 fields text[] := '{}';
 site text;
 previous_site text;
 subject_id text;
begin
 if tg_op='UPDATE' then
  select coalesce(array_agg(k order by k),'{}') into fields from jsonb_object_keys(after_row) k
   where k not in ('updated_at','encrypted_password') and after_row->k is distinct from before_row->k;
  if cardinality(fields)=0 then return new; end if;
 end if;
 site := case tg_argv[0]
  when 'attachment' then (select jobsite_id from public.service_reports where id=subject->>'service_report_id')
  when 'cycle' then (select jobsite_id from public.maintenance_plans where id=subject->>'plan_id')
  when 'observation' then (select jobsite_id from public.uat_runs where id::text=subject->>'run_id')
  when 'storage' then split_part(subject->>'name','/',1)
  when '' then null else subject->>tg_argv[0] end;
 if tg_argv[0]='storage' and (subject->>'bucket_id' is distinct from 'service-report-photos' or site !~ '^SITE-[0-9]{3,}$') then
  return coalesce(new,old);
 end if;
 subject_id := coalesce(subject->>'id',subject->>'user_id',subject->>'request_id',subject->>'event_no');
 insert into private.site_audit_log(jobsite_id,actor_id,actor_name,action,entity,record_id,changed_fields)
 values(site,auth.uid(),(select display_name from public.profiles where id=auth.uid()),
  lower(tg_op),tg_table_name,subject_id,fields);
 if tg_op='UPDATE' and tg_argv[0]='jobsite_id' then
  previous_site:=before_row->>'jobsite_id';
  if previous_site is distinct from site then
   insert into private.site_audit_log(jobsite_id,actor_id,actor_name,action,entity,record_id,changed_fields)
   values(previous_site,auth.uid(),(select display_name from public.profiles where id=auth.uid()),
    'move_out',tg_table_name,subject_id,fields);
  end if;
 end if;
 return coalesce(new,old);
end;
$$;
revoke all on function private.capture_site_audit() from public,anon,authenticated;

do $$
declare entry record;
begin
 for entry in select * from (values
  ('public.jobsites','id'),('public.profiles',''),('public.user_jobsites','jobsite_id'),
  ('public.assets','jobsite_id'),('public.asset_locations','jobsite_id'),('public.work_orders','jobsite_id'),
  ('public.alarms','jobsite_id'),('public.maintenance_plans','jobsite_id'),('public.plan_cycles','cycle'),
  ('public.service_reports','jobsite_id'),('public.service_report_attachments','attachment'),
  ('public.repair_requests','jobsite_id'),('public.work_order_materials','jobsite_id'),
  ('public.maintenance_contracts','jobsite_id'),('public.contract_asset_groups','jobsite_id'),
  ('public.contract_asset_memberships','jobsite_id'),('public.contract_month_targets','jobsite_id'),
  ('private.contract_accepted_evidence','jobsite_id'),('private.contract_customer_reviewers','jobsite_id'),
  ('private.contract_deliveries','jobsite_id'),('public.uat_runs','jobsite_id'),('public.uat_observations','observation'),
  ('storage.objects','storage')
 ) as entries(relation,scope_key)
 loop
  execute format('create trigger thaicon_site_audit after insert or update or delete on %s for each row execute function private.capture_site_audit(%L)',
   entry.relation::regclass,entry.scope_key);
 end loop;
end;
$$;

create function private.require_site_backup_admin(p_site text)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or private.current_user_role() is distinct from 'admin'::public.app_role
  or (p_site is not null and not private.can_access_jobsite(p_site)) then
  raise exception 'Audit or backup access denied' using errcode='42501';
 end if;
end;
$$;
revoke all on function private.require_site_backup_admin(text) from public,anon,authenticated;

create function public.list_site_audit(p_site text,p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_site_backup_admin(p_site);
 return coalesce((select jsonb_agg(to_jsonb(e) order by e.event_id desc)
  from (select * from private.site_audit_log where jobsite_id is not distinct from p_site
    and (p_before is null or event_id<p_before) order by event_id desc limit 100)e),'[]'::jsonb);
end;
$$;
revoke all on function public.list_site_audit(text,bigint) from public,anon;
grant execute on function public.list_site_audit(text,bigint) to authenticated;

create table private.site_backup_runs (
 id uuid primary key default gen_random_uuid(),
 jobsite_id text not null,
 actor_id uuid not null,
 started_at timestamptz not null default clock_timestamp(),
 attachments jsonb not null,
 finished_at timestamptz,
 sha256 text,
 bytes integer
);
alter table private.site_backup_runs enable row level security;
revoke all on private.site_backup_runs from public,anon,authenticated;

create function private.site_backup_attachments(p_site text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'path',o.name,'updated_at',o.updated_at,
  'size',o.metadata->'size') order by o.name),'[]'::jsonb)
 from storage.objects o where o.bucket_id='service-report-photos' and split_part(o.name,'/',1)=p_site;
$$;
revoke all on function private.site_backup_attachments(text) from public,anon,authenticated;

create function private.site_backup_data(p_site text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 spec record;
 rows jsonb;
 data jsonb := '{}'::jsonb;
begin
 for spec in select * from (values
  ('jobsites','public.jobsites','id=$1'),
  ('user_jobsites','public.user_jobsites','jobsite_id=$1'),
  ('assets','public.assets','jobsite_id=$1'),('asset_locations','public.asset_locations','jobsite_id=$1'),
  ('work_orders','public.work_orders','jobsite_id=$1'),('alarms','public.alarms','jobsite_id=$1'),
  ('work_order_materials','public.work_order_materials','jobsite_id=$1'),
  ('work_order_events','public.work_order_events','jobsite_id=$1'),('alarm_events','public.alarm_events','jobsite_id=$1'),
  ('maintenance_plans','public.maintenance_plans','jobsite_id=$1'),
  ('plan_cycles','public.plan_cycles','plan_id in (select id from public.maintenance_plans where jobsite_id=$1)'),
  ('plan_events','public.plan_events','jobsite_id=$1'),
  ('service_reports','public.service_reports','jobsite_id=$1'),
  ('service_report_attachments','public.service_report_attachments','service_report_id in (select id from public.service_reports where jobsite_id=$1)'),
  ('service_report_events','public.service_report_events','jobsite_id=$1'),
  ('repair_requests','public.repair_requests','jobsite_id=$1'),('repair_events','public.repair_events','jobsite_id=$1'),
  ('uat_runs','public.uat_runs','jobsite_id=$1'),
  ('uat_observations','public.uat_observations','run_id in (select id from public.uat_runs where jobsite_id=$1)'),
  ('maintenance_contracts','public.maintenance_contracts','jobsite_id=$1'),
  ('contract_asset_groups','public.contract_asset_groups','jobsite_id=$1'),
  ('contract_asset_memberships','public.contract_asset_memberships','jobsite_id=$1'),
  ('contract_month_targets','public.contract_month_targets','jobsite_id=$1'),
  ('contract_accepted_evidence','private.contract_accepted_evidence','jobsite_id=$1'),
  ('contract_customer_reviewers','private.contract_customer_reviewers','jobsite_id=$1'),
  ('contract_reviewer_events','private.contract_reviewer_events','jobsite_id=$1'),
  ('contract_deliveries','private.contract_deliveries','jobsite_id=$1'),
  ('contract_definition_receipts','private.contract_definition_receipts','payload->>''site''=$1'),
  ('work_notification_reads','private.work_notification_reads','jobsite_id=$1'),
  ('site_audit_log','private.site_audit_log','jobsite_id=$1')
 ) as specs(label,relation,condition)
 loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from %s r where %s',
   spec.relation::regclass,spec.condition) into rows using p_site;
  data:=data||jsonb_build_object(spec.label,rows);
  if octet_length(data::text)>10000000 then raise exception 'Site backup exceeds UAT limit' using errcode='22023'; end if;
 end loop;
 return data;
end;
$$;
revoke all on function private.site_backup_data(text) from public,anon,authenticated;

create function public.begin_site_backup(p_site text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 data jsonb;
 files jsonb;
 run private.site_backup_runs;
begin
 perform private.require_site_backup_admin(p_site);
 if p_site is null or not exists(select 1 from public.jobsites where id=p_site) then
  raise exception 'Backup site not found' using errcode='P0002';
 end if;
 -- A single SQL statement provides a common database snapshot for both reads.
 select private.site_backup_data(p_site),private.site_backup_attachments(p_site) into data,files;
 if exists(select 1 from jsonb_array_elements(data->'service_report_attachments') a
    where not exists(select 1 from jsonb_array_elements(files) f where f->>'path'=a->>'storage_path')) then
  raise exception 'A linked attachment is missing' using errcode='22023';
 end if;
 insert into private.site_backup_runs(jobsite_id,actor_id,attachments) values(p_site,auth.uid(),files) returning * into run;
 insert into private.site_audit_log(jobsite_id,actor_id,actor_name,action,entity,record_id)
 values(p_site,auth.uid(),(select display_name from public.profiles where id=auth.uid()),'backup_started','site_backup',run.id::text);
 return jsonb_build_object('id',run.id,'site',p_site,'captured_at',run.started_at,'tables',data,'attachments',files);
end;
$$;
revoke all on function public.begin_site_backup(text) from public,anon;
grant execute on function public.begin_site_backup(text) to authenticated;

create function public.finish_site_backup(p_site text,p_id uuid,p_sha text,p_bytes int)
returns boolean language plpgsql security definer set search_path='' as $$
declare run private.site_backup_runs;
begin
 perform private.require_site_backup_admin(p_site);
 select * into run from private.site_backup_runs where id=p_id and jobsite_id=p_site and actor_id=auth.uid() for update;
 if not found then raise exception 'Backup not found' using errcode='P0002'; end if;
 if p_sha is null or p_sha !~ '^[a-f0-9]{64}$' or p_bytes is null or p_bytes not between 1 and 35000000 then
  raise exception 'Invalid backup receipt' using errcode='22023';
 end if;
 if run.finished_at is not null then
  if run.sha256=p_sha and run.bytes=p_bytes then return true; end if;
  raise exception 'Backup already completed' using errcode='22023';
 end if;
 if run.attachments is distinct from private.site_backup_attachments(p_site) then
  raise exception 'Attachments changed during backup' using errcode='40001';
 end if;
 update private.site_backup_runs set finished_at=clock_timestamp(),sha256=p_sha,bytes=p_bytes where id=p_id;
 insert into private.site_audit_log(jobsite_id,actor_id,actor_name,action,entity,record_id)
 values(p_site,auth.uid(),(select display_name from public.profiles where id=auth.uid()),'backup_prepared','site_backup',p_id::text);
 return true;
end;
$$;
revoke all on function public.finish_site_backup(text,uuid,text,int) from public,anon;
grant execute on function public.finish_site_backup(text,uuid,text,int) to authenticated;
commit;
