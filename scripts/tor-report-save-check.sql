\set ON_ERROR_STOP on
\o /dev/null
begin;
do $$ begin if current_database()<>'thaicon_tor_check' then raise exception 'Wrong target'; end if; end $$;
create function pg_temp.expect_error(sql text,expected text) returns void language plpgsql as $$
declare actual text;
begin
 begin execute sql; exception when others then get stacked diagnostics actual=returned_sqlstate;
 if actual=expected then return; end if; raise exception 'Expected %, got %',expected,actual; end;
 raise exception 'Unexpected success: %',sql;
end;
$$;
insert into auth.users(id,email,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','admin@example.invalid','{"username":"save_admin"}'),
('00000000-0000-4000-8000-000000000002','engineer@example.invalid','{"username":"save_engineer"}'),
('00000000-0000-4000-8000-000000000004','viewer@example.invalid','{"username":"save_viewer"}');
update public.profiles set role='admin' where username='save_admin';
update public.profiles set role='engineer' where username='save_engineer';
insert into public.jobsites(id,name,province,site_type) values('SITE-901','A','Test','Test'),('SITE-902','B','Test','Test');
insert into public.user_jobsites(user_id,jobsite_id) values('00000000-0000-4000-8000-000000000002','SITE-901'),('00000000-0000-4000-8000-000000000004','SITE-901');
insert into public.assets(id,jobsite_id,name,asset_type,location) values('AS-A','SITE-901','A','AC','Test');
insert into public.assets(id,jobsite_id,name,asset_type,location) values('AS-OTHER','SITE-901','Other','AC','Test');
insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by)
values('PLAN-A','SITE-901','Plan','PM',2026,12,1,'00000000-0000-4000-8000-000000000001');
create function pg_temp.data() returns jsonb language sql as $$
select '{"plan_id":"PLAN-A","cycle_id":"PLAN-A-C01","asset_id":"AS-A","service_date":"2026-10-06","quantity":3,"technician_name":"Tech","customer_name":"Customer","work_performed":"Clean","findings":"Motor noise","action_taken":"Inspect","result":"repair_required","attachments":[]}'::jsonb;
$$;
create function pg_temp.photos() returns jsonb language sql as $$
select pg_temp.data()||'{"attachments":[{"id":"20000000-0000-4000-8000-000000000001","storage_path":"SITE-901/SR-30000000-0000-4000-8000-000000000001/proof.png","file_name":"proof.png","content_type":"image/png","file_size":100}]}'::jsonb;
$$;
create function pg_temp.save(v integer,key uuid,submit boolean default false,data jsonb default null) returns jsonb language sql as $$
select public.save_service_report_command('SR-30000000-0000-4000-8000-000000000001','SITE-901',v,key,coalesce(data,pg_temp.data()),submit);
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$ begin assert not public.service_report_commands_ready(); end $$;
select pg_temp.expect_error($q$select pg_temp.save(0,'10000000-0000-4000-8000-000000000001')$q$,'42501');
reset role;
update private.service_report_settings set drafts_enabled=true,reviews_enabled=false;
set local role authenticated;
select pg_temp.expect_error('select public.service_report_commands_ready()','42501');
reset role;
update private.service_report_settings set drafts_enabled=false,reviews_enabled=true;
set local role authenticated;
select pg_temp.expect_error('select public.service_report_commands_ready()','42501');
reset role;
update private.service_report_settings set drafts_enabled=true,reviews_enabled=true;
set local role authenticated;
do $$ begin assert public.service_report_commands_ready(); end $$;
select pg_temp.expect_error($q$select pg_temp.save(0,'10000000-0000-4000-8000-000000000001',true)$q$,'22023');
select pg_temp.save(0,'10000000-0000-4000-8000-000000000001');
do $$ declare replay jsonb; begin
 replay:=pg_temp.save(0,'10000000-0000-4000-8000-000000000001');assert (replay->>'replayed')::boolean;
 assert (select count(*) from public.service_report_events)=1;
 assert (select version from public.service_reports)=1;
 assert (select actual from public.plan_progress)=0;
end $$;
select pg_temp.expect_error($q$update public.service_reports set quantity=9$q$,'42501');
select pg_temp.expect_error($q$select pg_temp.save(0,'10000000-0000-4000-8000-000000000002')$q$,'40001');
select pg_temp.expect_error($q$select pg_temp.save(1,'10000000-0000-4000-8000-000000000002',false,pg_temp.data()||'{"created_by":"spoof"}')$q$,'22023');
select pg_temp.expect_error($q$select pg_temp.save(1,'10000000-0000-4000-8000-000000000002',true,pg_temp.photos())$q$,'22023');
reset role;
insert into storage.objects(id,bucket_id,name,owner_id) values('40000000-0000-4000-8000-000000000001','service-report-photos','SITE-901/SR-30000000-0000-4000-8000-000000000001/proof.png','00000000-0000-4000-8000-000000000002');
create function pg_temp.fail_event() returns trigger language plpgsql as $$ begin raise exception 'Synthetic save audit failure'; end $$;
create trigger synthetic_save_failure before insert on public.service_report_events for each row execute function pg_temp.fail_event();
set local role authenticated;
select pg_temp.expect_error($q$select pg_temp.save(1,'10000000-0000-4000-8000-000000000002',true,pg_temp.photos())$q$,'P0001');
do $$ begin
 assert (select version from public.service_reports)=1;assert (select status from public.service_reports)='draft';
 assert (select count(*) from public.service_report_attachments)=0;
 assert (select count(*) from public.repair_requests)=0;
 assert (select actual from public.plan_progress)=0;
end $$;
reset role;
drop trigger synthetic_save_failure on public.service_report_events;
set local role authenticated;
select pg_temp.save(1,'10000000-0000-4000-8000-000000000002',true,pg_temp.photos());
select pg_temp.save(1,'10000000-0000-4000-8000-000000000002',true,pg_temp.photos());
do $$ begin
 assert (select version from public.service_reports)=2;assert (select status from public.service_reports)='submitted';
 assert (select count(*) from public.service_report_attachments)=1;assert (select count(*) from public.repair_requests)=1;
 assert (select count(*) from public.service_report_events)=2;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.apply_service_report_review('SR-30000000-0000-4000-8000-000000000001',2,'10000000-0000-4000-8000-000000000003','return','Add details');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select pg_temp.save(3,'10000000-0000-4000-8000-000000000099',false,pg_temp.photos()||'{"asset_id":"AS-OTHER"}')$q$,'22023');
select pg_temp.save(3,'10000000-0000-4000-8000-000000000004',true,pg_temp.photos());
do $$ begin assert (select version from public.service_reports)=4;assert (select count(*) from public.repair_requests)=1; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.apply_service_report_review('SR-30000000-0000-4000-8000-000000000001',4,'10000000-0000-4000-8000-000000000005','approve');
select pg_temp.expect_error($q$select pg_temp.save(5,'10000000-0000-4000-8000-000000000006')$q$,'42501');
do $$ begin assert (select actual from public.plan_progress)=3;assert (select count(*) from public.service_report_events)=5; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.expect_error($q$select pg_temp.save(5,'10000000-0000-4000-8000-000000000006')$q$,'42501');
reset role;
update public.profiles set is_active=false where username='save_engineer';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select pg_temp.save(1,'10000000-0000-4000-8000-000000000002',true,pg_temp.photos())$q$,'42501');
reset role;
set local role anon;
select pg_temp.expect_error('select public.service_report_commands_ready()','42501');
reset role;
rollback;
\o
\echo Service Report atomic save assertions passed; fixtures rolled back.
