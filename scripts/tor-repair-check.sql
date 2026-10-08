\set ON_ERROR_STOP on
\o /dev/null
begin;
do $$ begin if current_database()<>'thaicon_tor_check' then raise exception 'Wrong target'; end if; end $$;
create function pg_temp.expect_error(sql text,expected text) returns void language plpgsql as $$
declare actual text;
begin begin execute sql; exception when others then get stacked diagnostics actual=returned_sqlstate;
 if actual=expected then return; end if; raise exception 'Expected %, got %',expected,actual; end;
 raise exception 'Unexpected success: %',sql;
end; $$;
insert into auth.users(id,email,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','admin@example.invalid','{"username":"repair_admin"}'),
('00000000-0000-4000-8000-000000000002','engineer@example.invalid','{"username":"repair_engineer"}'),
('00000000-0000-4000-8000-000000000003','other@example.invalid','{"username":"repair_other"}'),
('00000000-0000-4000-8000-000000000004','viewer@example.invalid','{"username":"repair_viewer"}');
update public.profiles set role='admin' where username='repair_admin';
update public.profiles set role='engineer' where username in ('repair_engineer','repair_other');
insert into public.jobsites(id,name,province,site_type) values('SITE-901','A','Test','Test'),('SITE-902','B','Test','Test');
insert into public.user_jobsites(user_id,jobsite_id) values('00000000-0000-4000-8000-000000000002','SITE-901'),('00000000-0000-4000-8000-000000000003','SITE-901'),('00000000-0000-4000-8000-000000000004','SITE-901');
insert into public.assets(id,jobsite_id,name,asset_type,location) values('AS-A','SITE-901','A','AC','Test'),('AS-OTHER','SITE-901','Other','AC','Test'),('AS-B','SITE-902','B','AC','Test');
insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by) values('PLAN-A','SITE-901','Plan','PM',2026,12,1,'00000000-0000-4000-8000-000000000001');
insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,asset_id,asset_name,service_date,technician_name,customer_name,work_performed,findings,action_taken,created_by)
values('SR-A','SITE-901','PLAN-A','PLAN-A-C01','AS-A','A','2026-10-06','Tech','Customer','Clean','Noise','Inspect','00000000-0000-4000-8000-000000000002');
create function pg_temp.data() returns jsonb language sql as $$
 select '{"asset_id":"AS-A","requested_date":"2026-10-06","title":"Noise","description":"Inspect motor","priority":"high","status":"resolved","reported_by":"Tech","resolution":"Fixed","service_report_id":null}'::jsonb;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$ begin assert not public.repair_commands_ready(); end $$;
insert into public.repair_requests(id,jobsite_id,asset_id,asset_name,requested_date,title,description,reported_by,created_by) values('RR-legacy','SITE-901','AS-A','A','2026-10-06','Original','Legacy history','Tech',auth.uid());
update public.repair_requests set title='Legacy edit' where id='RR-legacy';
do $$ begin assert (select version from public.repair_requests where id='RR-legacy')=2; end $$;
select pg_temp.expect_error($q$update public.repair_requests set version=1 where id='RR-legacy'$q$,'42501');
reset role;
update private.repair_settings set enabled=true;
set local role authenticated;
select pg_temp.expect_error('select public.repair_commands_ready()','42501');
reset role;
update private.service_report_settings set drafts_enabled=true,reviews_enabled=true;
insert into public.repair_requests(id,jobsite_id,service_report_id,asset_id,asset_name,requested_date,title,description,reported_by,created_by)
values('RR-linked','SITE-901','SR-A','AS-A','A','2026-10-06','Source-linked','Original description','Tech','00000000-0000-4000-8000-000000000002');
set local role authenticated;
do $$ begin assert public.repair_commands_ready(); end $$;
select pg_temp.expect_error($q$select public.save_repair_command('RR-legacy','SITE-901',1,'10000000-0000-4000-8000-000000000001',pg_temp.data())$q$,'40001');
select pg_temp.expect_error($q$update public.repair_requests set title='Bypass' where id='RR-legacy'$q$,'42501');
select public.save_repair_command('RR-linked','SITE-901',1,'10000000-0000-4000-8000-000000000002',pg_temp.data()||'{"service_report_id":"SR-A"}');
select public.save_repair_command('RR-linked','SITE-901',1,'10000000-0000-4000-8000-000000000002',pg_temp.data()||'{"service_report_id":"SR-A"}');
do $$ begin
 assert (select count(*) from public.repair_events)=1;assert (select version from public.repair_requests where id='RR-linked')=2;
 assert (select status from public.service_reports where id='SR-A')='draft';assert (select actual from public.plan_progress)=0;
 assert (select created_by from public.repair_requests where id='RR-linked')=auth.uid();
end $$;
select pg_temp.expect_error($q$select public.save_repair_command('RR-linked','SITE-901',2,'10000000-0000-4000-8000-000000000003',pg_temp.data())$q$,'22023');
select pg_temp.expect_error($q$select public.save_repair_command('RR-linked','SITE-901',2,'10000000-0000-4000-8000-000000000003',pg_temp.data()||'{"service_report_id":"SR-A","asset_id":"AS-OTHER"}')$q$,'22023');
select pg_temp.expect_error($q$select public.save_repair_command('RR-linked','SITE-902',2,'10000000-0000-4000-8000-000000000003',pg_temp.data()||'{"service_report_id":"SR-A"}')$q$,'42501');
select pg_temp.expect_error($q$select public.save_repair_command('RR-linked','SITE-901',2,'10000000-0000-4000-8000-000000000002',pg_temp.data()||'{"service_report_id":"SR-A"}')$q$,'22023');
select pg_temp.expect_error($q$select public.save_repair_command('RR-legacy','SITE-901',2,'10000000-0000-4000-8000-000000000003',pg_temp.data()||'{"created_by":"spoof"}')$q$,'22023');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.save_repair_command('RR-linked','SITE-901',2,'10000000-0000-4000-8000-000000000003',pg_temp.data()||'{"service_report_id":"SR-A"}')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.expect_error($q$select public.save_repair_command('RR-linked','SITE-901',2,'10000000-0000-4000-8000-000000000003',pg_temp.data()||'{"service_report_id":"SR-A"}')$q$,'42501');
reset role;
create function pg_temp.fail_audit() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure';end;$$;
create trigger synthetic_repair_audit_failure before insert on public.repair_events for each row execute function pg_temp.fail_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select public.save_repair_command('RR-linked','SITE-901',2,'10000000-0000-4000-8000-000000000004',pg_temp.data()||'{"service_report_id":"SR-A","title":"Must rollback"}')$q$,'P0001');
do $$ begin assert (select version from public.repair_requests where id='RR-linked')=2;assert (select title from public.repair_requests where id='RR-linked')='Noise';assert (select count(*) from public.repair_events)=1;end $$;
reset role;
drop trigger synthetic_repair_audit_failure on public.repair_events;
set local role authenticated;
select public.save_repair_command('RR-30000000-0000-4000-8000-000000000001','SITE-901',0,'10000000-0000-4000-8000-000000000005',pg_temp.data());
reset role;
update public.profiles set is_active=false where username='repair_engineer';
set local role authenticated;
select pg_temp.expect_error($q$select public.save_repair_command('RR-linked','SITE-901',1,'10000000-0000-4000-8000-000000000002',pg_temp.data()||'{"service_report_id":"SR-A"}')$q$,'42501');
reset role;
rollback;
\o
\echo Repair command assertions passed; fixtures rolled back.
