\set ON_ERROR_STOP on
\o /dev/null
begin;
do $$ begin if current_database()<>'thaicon_tor_check' then raise exception 'Wrong target'; end if; end $$;
create function pg_temp.expect_error(sql text,expected text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute sql;
  exception when others then
    get stacked diagnostics actual=returned_sqlstate;
    if actual=expected then return; end if;
    raise exception 'Expected %, got %: %',expected,actual,sql;
  end;
  raise exception 'Unexpected success: %',sql;
end;
$$;
insert into auth.users(id,email,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','admin@example.invalid','{"username":"sr_admin"}'),
('00000000-0000-4000-8000-000000000002','engineer@example.invalid','{"username":"sr_engineer"}'),
('00000000-0000-4000-8000-000000000003','peer@example.invalid','{"username":"sr_peer"}'),
('00000000-0000-4000-8000-000000000004','viewer@example.invalid','{"username":"sr_viewer"}');
update public.profiles set role='admin' where username='sr_admin';
update public.profiles set role='engineer' where username in ('sr_engineer','sr_peer');
insert into public.jobsites(id,name,province,site_type) values('SITE-901','A','Test','Test'),('SITE-902','B','Test','Test');
insert into public.user_jobsites(user_id,jobsite_id) values
('00000000-0000-4000-8000-000000000002','SITE-901'),
('00000000-0000-4000-8000-000000000003','SITE-902'),
('00000000-0000-4000-8000-000000000004','SITE-901');
insert into public.assets(id,jobsite_id,name,asset_type,location) values('AS-A','SITE-901','A','AC','Test');
insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by)
values('PLAN-A','SITE-901','Plan','PM',2026,12,1,'00000000-0000-4000-8000-000000000001');
insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,asset_id,asset_name,service_date,
 quantity,technician_name,customer_name,work_performed,findings,action_taken,created_by)
values('SR-A','SITE-901','PLAN-A','PLAN-A-C01','AS-A','A','2026-10-06',2,'Tech','Customer','Clean','','','00000000-0000-4000-8000-000000000002');
insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,asset_id,asset_name,service_date,
 quantity,technician_name,customer_name,work_performed,findings,action_taken,created_by)
values('SR-EMPTY','SITE-901','PLAN-A','PLAN-A-C01','AS-A','A','2026-10-06',1,'Tech','Customer','Clean','','','00000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin assert not public.service_report_reviews_ready(); end $$;
update public.service_reports set findings='Legacy' where id='SR-A';
do $$ begin assert (select version from public.service_reports where id='SR-A')=2; end $$;
select pg_temp.expect_error($q$update public.service_reports set version=99 where id='SR-A'$q$,'42501');
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',2,'10000000-0000-4000-8000-000000000001','submit')$q$,'42501');
reset role;
insert into storage.objects(id,bucket_id,name,owner_id) values('30000000-0000-4000-8000-000000000009','service-report-photos','SITE-901/SR-A/initial.png','00000000-0000-4000-8000-000000000002');
insert into public.service_report_attachments(id,service_report_id,storage_path,file_name,content_type,file_size,uploaded_by)
values('20000000-0000-4000-8000-000000000009','SR-A','SITE-901/SR-A/initial.png','initial.png','image/png',100,'00000000-0000-4000-8000-000000000002');
update private.service_report_settings set reviews_enabled=true;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$ begin assert public.service_report_reviews_ready(); end $$;
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-EMPTY',1,'10000000-0000-4000-8000-000000000099','submit')$q$,'22023');
select pg_temp.expect_error($q$update public.service_reports set status='submitted' where id='SR-A'$q$,'42501');
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',1,'10000000-0000-4000-8000-000000000001','submit')$q$,'40001');
select public.apply_service_report_review('SR-A',2,'10000000-0000-4000-8000-000000000001','submit');
do $$ declare r jsonb; begin
  r:=public.apply_service_report_review('SR-A',2,'10000000-0000-4000-8000-000000000001','submit');
  assert (r->>'replayed')::boolean;
  assert (select count(*) from public.service_report_events)=1;
  assert (select actual from public.plan_progress where plan_id='PLAN-A')=0;
end $$;
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',3,'10000000-0000-4000-8000-000000000002','approve')$q$,'42501');
select pg_temp.expect_error($q$insert into public.service_report_attachments(id,service_report_id,storage_path,file_name,content_type,file_size,uploaded_by) values('20000000-0000-4000-8000-000000000001','SR-A','SITE-901/SR-A/photo.png','photo.png','image/png',100,'00000000-0000-4000-8000-000000000002')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',3,'10000000-0000-4000-8000-000000000002','approve')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
do $$ begin assert (select count(*) from public.service_report_events)=0; end $$;
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',3,'10000000-0000-4000-8000-000000000002','submit')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$update public.service_reports set quantity=9 where id='SR-A'$q$,'42501');
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',3,'10000000-0000-4000-8000-000000000002','return',' ')$q$,'22023');
select public.apply_service_report_review('SR-A',3,'10000000-0000-4000-8000-000000000002','return','เพิ่มรายละเอียด');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
update public.service_reports set findings='Corrected' where id='SR-A';
insert into public.service_report_attachments(id,service_report_id,storage_path,file_name,content_type,file_size,uploaded_by)
values('20000000-0000-4000-8000-000000000001','SR-A','SITE-901/SR-A/photo.png','photo.png','image/png',100,'00000000-0000-4000-8000-000000000002');
do $$ begin assert (select version from public.service_reports where id='SR-A')=6; end $$;
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',5,'10000000-0000-4000-8000-000000000003','submit')$q$,'40001');
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',6,'10000000-0000-4000-8000-000000000003','submit')$q$,'22023');
reset role;
insert into storage.objects(id,bucket_id,name,owner_id) values('30000000-0000-4000-8000-000000000001','service-report-photos','SITE-901/SR-A/photo.png','00000000-0000-4000-8000-000000000002');
set local role authenticated;
select public.apply_service_report_review('SR-A',6,'10000000-0000-4000-8000-000000000003','submit');
reset role;
create function pg_temp.fail_event() returns trigger language plpgsql as $$ begin raise exception 'Synthetic failure'; end $$;
create trigger synthetic_report_failure before insert on public.service_report_events for each row execute function pg_temp.fail_event();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',7,'10000000-0000-4000-8000-000000000004','approve')$q$,'P0001');
do $$ begin
 assert (select version from public.service_reports where id='SR-A')=7;
 assert (select status from public.service_reports where id='SR-A')='submitted';
 assert (select actual from public.plan_progress where plan_id='PLAN-A')=0;
end $$;
reset role;
drop trigger synthetic_report_failure on public.service_report_events;
set local role authenticated;
select public.apply_service_report_review('SR-A',7,'10000000-0000-4000-8000-000000000004','approve');
select public.apply_service_report_review('SR-A',7,'10000000-0000-4000-8000-000000000004','approve');
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',7,'10000000-0000-4000-8000-000000000005','approve')$q$,'40001');
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',8,'10000000-0000-4000-8000-000000000005','approve')$q$,'22023');
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',8,'10000000-0000-4000-8000-000000000004','return','changed')$q$,'22023');
select pg_temp.expect_error($q$update public.service_reports set findings='Tampered' where id='SR-A'$q$,'42501');
select pg_temp.expect_error($q$delete from public.service_reports where id='SR-A'$q$,'42501');
select pg_temp.expect_error($q$delete from public.service_report_attachments where service_report_id='SR-A'$q$,'42501');
select pg_temp.expect_error($q$update public.service_report_events set note='spoof'$q$,'42501');
do $$ begin
 assert (select actual from public.plan_progress where plan_id='PLAN-A')=2;
 assert (select count(*) from public.service_report_events)=4;
 assert (select approved_by from public.service_reports where id='SR-A')='00000000-0000-4000-8000-000000000001'::uuid;
end $$;
reset role;
update public.profiles set is_active=false where username='sr_admin';
set local role authenticated;
select pg_temp.expect_error($q$select public.apply_service_report_review('SR-A',7,'10000000-0000-4000-8000-000000000004','approve')$q$,'42501');
reset role;
set local role anon;
select pg_temp.expect_error('select * from public.service_report_events','42501');
select pg_temp.expect_error('select public.service_report_reviews_ready()','42501');
reset role;
rollback;
\o
\echo Service Report review assertions passed; fixtures rolled back.
