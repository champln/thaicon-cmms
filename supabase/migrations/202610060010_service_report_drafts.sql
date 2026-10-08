-- Pending complete draft command; OFF until new React saves replace autosync.
alter table private.service_report_settings add column drafts_enabled boolean not null default false;
create function private.service_report_drafts_enabled() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select drafts_enabled from private.service_report_settings where singleton),false);
$$;
revoke all on function private.service_report_drafts_enabled() from public,anon;
grant execute on function private.service_report_drafts_enabled() to authenticated;
create function public.service_report_commands_ready() returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if private.service_report_drafts_enabled() is distinct from private.service_report_reviews_enabled() then
   raise exception 'Incomplete Service Report gate configuration' using errcode='42501';
 end if;
 return private.service_report_drafts_enabled() and private.current_user_role() is not null;
end;
$$;
revoke all on function public.service_report_commands_ready() from public,anon;
grant execute on function public.service_report_commands_ready() to authenticated;
alter table public.service_report_events drop constraint service_report_events_command_check;
alter table public.service_report_events add constraint service_report_events_command_check
 check(command in ('create','save','save_submit','submit','approve','return'));
alter table public.service_report_events drop constraint service_report_events_report_version_check;
alter table public.service_report_events add constraint service_report_events_report_version_check check(report_version>0);

create function private.guard_service_report_draft_write() returns trigger
language plpgsql set search_path='' as $$
declare owner_write boolean;
begin
 select current_user=pg_catalog.pg_get_userbyid(c.relowner) into owner_write from pg_catalog.pg_class c where c.oid=tg_relid;
 if private.service_report_drafts_enabled() and not owner_write then
   raise exception 'Use Service Report save command' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function private.guard_service_report_draft_write() from public,anon,authenticated;
create trigger service_reports_draft_guard before insert or update or delete on public.service_reports
for each row execute function private.guard_service_report_draft_write();
create trigger service_report_attachments_draft_guard before insert or update or delete on public.service_report_attachments
for each row execute function private.guard_service_report_draft_write();

-- All command submission paths (including an existing draft review command)
-- create the related repair in the same transaction, never a later browser save.
create function private.create_service_report_repair_draft() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if private.service_report_drafts_enabled() and new.status='submitted' and old.status<>'submitted'
   and new.result='repair_required' and not exists(select 1 from public.repair_requests where service_report_id=new.id) then
   if auth.uid() is null then raise exception 'Submission actor required' using errcode='42501'; end if;
   insert into public.repair_requests(id,jobsite_id,service_report_id,asset_id,asset_name,requested_date,title,description,priority,status,reported_by,created_by)
   values('RR-'||gen_random_uuid()::text,new.jobsite_id,new.id,new.asset_id,new.asset_name,new.service_date,
     'ตรวจสอบความผิดปกติ: '||new.asset_name,new.findings,'high','draft',new.technician_name,auth.uid());
 end if;
 return new;
end;
$$;
revoke all on function private.create_service_report_repair_draft() from public,anon,authenticated;
create trigger service_reports_repair_draft after update of status on public.service_reports
for each row execute function private.create_service_report_repair_draft();

create function public.save_service_report_command(
 p_report_id text,p_site_id text,p_expected_version integer,p_request_id uuid,p_data jsonb,p_submit boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; r public.service_reports%rowtype; saved public.service_reports%rowtype;
 prior public.service_report_events%rowtype; a public.assets%rowtype; attachment jsonb; payload jsonb;
 event_id bigint; creating boolean; next_status public.service_report_status; v integer; command text;
begin
 if not private.service_report_drafts_enabled() or not private.service_report_reviews_enabled() then
   raise exception 'Report commands not enabled' using errcode='42501';
 end if;
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if not found or actor.role not in ('admin','engineer') or not private.can_access_jobsite(p_site_id)
   or not exists(select 1 from public.jobsites where id=p_site_id and is_active) then
   raise exception 'Not authorized' using errcode='42501';
 end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0 or p_submit is null
   or p_report_id is null or length(p_report_id) not between 1 and 100 or jsonb_typeof(p_data) is distinct from 'object'
   or not p_data ?& array['plan_id','cycle_id','asset_id','service_date','quantity','technician_name','customer_name','work_performed','findings','action_taken','result','attachments']
   or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('plan_id','cycle_id','asset_id','service_date','quantity','technician_name','customer_name','work_performed','findings','action_taken','result','attachments','work_order_id')) then
   raise exception 'Invalid report payload' using errcode='22023';
 end if;
 if exists(select 1 from unnest(array['plan_id','cycle_id','asset_id','service_date','technician_name','customer_name','work_performed','findings','action_taken','result']) k where jsonb_typeof(p_data->k) is distinct from 'string' or length(p_data->>k)>4000)
   or jsonb_typeof(p_data->'quantity') is distinct from 'number'
   or (p_data->>'quantity')::numeric not between 1 and 2147483647
   or (p_data->>'quantity')::numeric<>trunc((p_data->>'quantity')::numeric)
   or p_data->>'result' not in ('normal','repair_required')
   or jsonb_typeof(p_data->'attachments') is distinct from 'array'
   or jsonb_array_length(p_data->'attachments')>4
   or (p_data ? 'work_order_id' and jsonb_typeof(p_data->'work_order_id') not in ('string','null')) then
   raise exception 'Invalid report values' using errcode='22023';
 end if;
 payload:=jsonb_build_object('report_id',p_report_id,'site_id',p_site_id,'expected_version',p_expected_version,'data',p_data,'submit',p_submit);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text||':'||p_request_id::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('service-report:'||p_report_id,0));
 select * into r from public.service_reports where id=p_report_id for update;
 creating:=not found;
 if not creating and (r.jobsite_id<>p_site_id or (actor.role='engineer' and r.created_by<>actor.id)) then
   raise exception 'Not authorized' using errcode='42501';
 end if;
 select * into prior from public.service_report_events where actor_id=actor.id and request_id=p_request_id;
 if found then
   if prior.request_payload<>payload then raise exception 'Request ID reused' using errcode='22023'; end if;
   return jsonb_build_object('event_no',prior.event_no,'report',prior.result_snapshot,'replayed',true);
 end if;
 if creating then
   if p_expected_version<>0 or p_report_id!~'^SR-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or p_submit or jsonb_array_length(p_data->'attachments')<>0 then
     raise exception 'Create a draft first before uploading proof' using errcode='22023';
   end if;
 else
   if r.version<>p_expected_version then raise exception 'Service report version conflict' using errcode='40001'; end if;
   if r.status not in ('draft','rejected') then raise exception 'Report evidence is locked' using errcode='42501'; end if;
 end if;
 select * into a from public.assets where id=p_data->>'asset_id' and jobsite_id=p_site_id;
 if not found or not exists(select 1 from public.maintenance_plans p join public.plan_cycles c on c.plan_id=p.id
   where p.id=p_data->>'plan_id' and p.jobsite_id=p_site_id and p.status<>'completed' and c.id=p_data->>'cycle_id')
   or (nullif(p_data->>'work_order_id','') is not null and not exists(select 1 from public.work_orders w
     where w.id=p_data->>'work_order_id' and w.jobsite_id=p_site_id and w.asset_id=a.id)) then
   raise exception 'Report asset/plan/cycle/work order scope mismatch' using errcode='22023';
 end if;
 if p_submit and (jsonb_array_length(p_data->'attachments')=0 or btrim(p_data->>'technician_name')='' or btrim(p_data->>'customer_name')='' or btrim(p_data->>'work_performed')='') then
   raise exception 'Incomplete report' using errcode='22023';
 end if;
 if not creating and exists(select 1 from public.repair_requests rr where rr.service_report_id=p_report_id and rr.asset_id<>a.id) then
   raise exception 'Linked repair uses a different asset; reconcile before correction' using errcode='22023';
 end if;
 for attachment in select value from jsonb_array_elements(p_data->'attachments') loop
   if jsonb_typeof(attachment) is distinct from 'object'
     or not attachment ?& array['id','storage_path','file_name','content_type','file_size']
     or exists(select 1 from jsonb_object_keys(attachment) k where k not in ('id','storage_path','file_name','content_type','file_size'))
     or exists(select 1 from unnest(array['id','storage_path','file_name','content_type']) k where jsonb_typeof(attachment->k) is distinct from 'string')
     or attachment->>'id' !~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or (storage.foldername(attachment->>'storage_path'))[1] is distinct from p_site_id
     or (storage.foldername(attachment->>'storage_path'))[2] is distinct from p_report_id
     or attachment->>'content_type' not in ('image/png','image/jpeg','image/webp')
     or jsonb_typeof(attachment->'file_size') is distinct from 'number'
     or (attachment->>'file_size')::numeric not between 1 and 10000000
     or (attachment->>'file_size')::numeric<>trunc((attachment->>'file_size')::numeric)
     or length(btrim(attachment->>'file_name')) not between 1 and 500
     or not exists(select 1 from storage.objects o where o.bucket_id='service-report-photos' and o.name=attachment->>'storage_path')
     or exists(select 1 from public.service_report_attachments x where (x.id=(attachment->>'id')::uuid or x.storage_path=attachment->>'storage_path') and x.service_report_id<>p_report_id) then
     raise exception 'Invalid or missing report photo metadata' using errcode='22023';
   end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_data->'attachments'))<>jsonb_array_length(p_data->'attachments')
   or (select count(distinct value->>'storage_path') from jsonb_array_elements(p_data->'attachments'))<>jsonb_array_length(p_data->'attachments') then
   raise exception 'Duplicate report photo metadata' using errcode='22023';
 end if;
 if creating then
   insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,asset_id,asset_name,service_date,quantity,
     technician_name,customer_name,work_performed,findings,action_taken,result,work_order_id,created_by)
   values(p_report_id,p_site_id,p_data->>'plan_id',p_data->>'cycle_id',a.id,a.name,(p_data->>'service_date')::date,(p_data->>'quantity')::integer,
     p_data->>'technician_name',p_data->>'customer_name',p_data->>'work_performed',p_data->>'findings',p_data->>'action_taken',(p_data->>'result')::public.service_result,nullif(p_data->>'work_order_id',''),actor.id);
 end if;
 -- Metadata replacement happens while parent is editable and locked. Removed
 -- objects remain retained in Storage for recovery; this command deletes no bytes.
 delete from public.service_report_attachments x where x.service_report_id=p_report_id
   and not exists(select 1 from jsonb_array_elements(p_data->'attachments') j where (j.value->>'id')::uuid=x.id);
 for attachment in select value from jsonb_array_elements(p_data->'attachments') loop
   insert into public.service_report_attachments(id,service_report_id,storage_path,file_name,content_type,file_size,uploaded_by)
   values((attachment->>'id')::uuid,p_report_id,attachment->>'storage_path',attachment->>'file_name',attachment->>'content_type',(attachment->>'file_size')::integer,actor.id)
   on conflict(id) do update set storage_path=excluded.storage_path,file_name=excluded.file_name,content_type=excluded.content_type,file_size=excluded.file_size;
 end loop;
 v:=case when creating then 1 else p_expected_version+1 end;
 next_status:=case when p_submit then 'submitted'::public.service_report_status else 'draft'::public.service_report_status end;
 update public.service_reports set plan_id=p_data->>'plan_id',cycle_id=p_data->>'cycle_id',asset_id=a.id,asset_name=a.name,
   service_date=(p_data->>'service_date')::date,quantity=(p_data->>'quantity')::integer,technician_name=p_data->>'technician_name',customer_name=p_data->>'customer_name',
   work_performed=p_data->>'work_performed',findings=p_data->>'findings',action_taken=p_data->>'action_taken',result=(p_data->>'result')::public.service_result,
   work_order_id=nullif(p_data->>'work_order_id',''),status=next_status,rejection_reason=null,version=v where id=p_report_id returning * into saved;
 command:=case when creating then 'create' when p_submit then 'save_submit' else 'save' end;
 insert into public.service_report_events(service_report_id,jobsite_id,actor_id,actor_name,actor_role,request_id,command,request_payload,before_status,after_status,report_version,result_snapshot)
 values(saved.id,saved.jobsite_id,actor.id,actor.display_name,actor.role,p_request_id,command,payload,coalesce(r.status,'draft'),saved.status,saved.version,to_jsonb(saved)) returning event_no into event_id;
 return jsonb_build_object('event_no',event_id,'report',to_jsonb(saved),'replayed',false);
end;
$$;
revoke all on function public.save_service_report_command(text,text,integer,uuid,jsonb,boolean) from public,anon;
grant execute on function public.save_service_report_command(text,text,integer,uuid,jsonb,boolean) to authenticated;
