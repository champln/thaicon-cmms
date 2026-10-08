\set ON_ERROR_STOP on
\o /dev/null
begin;
do $$begin if current_database()<>'thaicon_tor_check' then raise exception 'Wrong target';end if;end;$$;
create function pg_temp.expect_error(sql text,expected text) returns void language plpgsql as $$
declare actual text;begin begin execute sql;exception when others then get stacked diagnostics actual=returned_sqlstate;if actual=expected then return;end if;raise exception 'Expected %, got %',expected,actual;end;raise exception 'Unexpected success';end;$$;
insert into auth.users(id,email,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','admin@example.invalid','{"username":"live_admin"}'),
('00000000-0000-4000-8000-000000000002','engineer@example.invalid','{"username":"live_engineer"}'),
('00000000-0000-4000-8000-000000000003','viewer@example.invalid','{"username":"live_viewer"}');
update public.profiles set role='admin' where username='live_admin';
update public.profiles set role='engineer' where username='live_engineer';
insert into public.jobsites(id,name,province,site_type) values('SITE-901','Same name','Test','Test'),('SITE-902','Same name','Test','Test');
insert into public.user_jobsites values('00000000-0000-4000-8000-000000000002','SITE-901'),('00000000-0000-4000-8000-000000000003','SITE-901');
insert into public.assets(id,jobsite_id,name,asset_type,location) values('AS-A','SITE-901','A','AC','Test'),('AS-B','SITE-902','B','AC','Test');
insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by) values
('PLAN-A','SITE-901','Actual','PM',2026,1,1,'00000000-0000-4000-8000-000000000001'),
('PLAN-B','SITE-902','Other','PM',2026,12,1,'00000000-0000-4000-8000-000000000001');
insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,asset_id,asset_name,service_date,technician_name,customer_name,work_performed,findings,action_taken,created_by)
 select 'SR-'||n,'SITE-901','PLAN-A','PLAN-A-C01','AS-A','A','2026-10-06','Tech','Customer','Clean','','','00000000-0000-4000-8000-000000000002'::uuid from generate_series(1,1001) n;
insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,asset_id,asset_name,service_date,technician_name,customer_name,work_performed,findings,action_taken,created_by)
 values('SR-OTHER','SITE-902','PLAN-B','PLAN-B-C01','AS-B','B','2026-10-06','Tech','Customer','Other','','','00000000-0000-4000-8000-000000000001');
insert into public.service_report_attachments(id,service_report_id,storage_path,file_name,content_type,file_size,uploaded_by) values
('40000000-0000-4000-8000-000000000001','SR-1','SITE-901/SR-1/a.png','Actual.png','image/png',100,'00000000-0000-4000-8000-000000000002'),
('40000000-0000-4000-8000-000000000002','SR-OTHER','SITE-902/SR-OTHER/b.png','Other.png','image/png',100,'00000000-0000-4000-8000-000000000001');
insert into public.alarms(id,jobsite_id,asset_id,level,title,detail,measured_value) values
('AL-A','SITE-901','AS-A','warning','A','Current','31'),('AL-B','SITE-902','AS-B','warning','B','Other','32');
set local role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
do $$begin assert not public.live_snapshot_access('SITE-901','maintenance');assert not public.live_snapshot_access('SITE-901','alarms');end;$$;
select pg_temp.expect_error($q$select public.read_live_snapshot('SITE-901','maintenance')$q$,'42501');
select pg_temp.expect_error($q$select public.live_snapshot_access('SITE-902','maintenance')$q$,'42501');
select pg_temp.expect_error($q$select public.live_snapshot_access('SITE-901','invalid')$q$,'22023');
reset role;update private.plan_settings set enabled=true;update private.service_report_settings set drafts_enabled=true,reviews_enabled=true;update private.repair_settings set enabled=true;update private.alarm_settings set enabled=true;
set local role authenticated;
do $$declare s jsonb;begin
 s:=public.read_live_snapshot('SITE-901','maintenance');
 assert s->>'actor_id'=auth.uid()::text and s->>'site_id'='SITE-901' and s->>'kind'='maintenance' and s->>'protocol'='1';
 assert s->>'actor_role'='user' and (s->>'enabled')::boolean;
 assert jsonb_array_length(s->'plans')=1 and jsonb_array_length(s->'cycles')=12;
 assert jsonb_array_length(s->'reports')=1001 and jsonb_array_length(s->'attachments')=1;
 assert s->'attachments'->0->>'id'='40000000-0000-4000-8000-000000000001';
 assert (select count(*) from jsonb_array_elements(s->'cycles') c where c->>'target'='0')=11;
 assert not exists(select 1 from jsonb_array_elements(s->'reports') r where r->>'jobsite_id'<>'SITE-901');
 s:=public.read_live_snapshot('SITE-901','alarms');assert jsonb_array_length(s->'alarms')=1;assert s->'alarms'->0->>'measured_value'='31';
end;$$;
select pg_temp.expect_error($q$select public.read_live_snapshot('SITE-902','alarms')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000001','SITE-901',0,'10000000-0000-4000-8000-000000000001','{"name":"Delete","service_type":"PM","plan_year":2026,"annual_target":1,"cycle_months":1,"start_month":1,"status":"active"}');
select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000001','SITE-901',1,'10000000-0000-4000-8000-000000000002','{}',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
do $$declare s jsonb;begin
 s:=public.read_live_snapshot('SITE-901','maintenance');
 assert jsonb_array_length(s->'plan_tombstones')=1;
 assert s->'plan_tombstones'->0->>'version'='2';
 assert s->'plan_tombstones'->0->>'site_id'='SITE-901';
 assert not exists(select 1 from jsonb_array_elements(s->'plans') p where p->>'id'='PLAN-30000000-0000-4000-8000-000000000001');
 assert (select count(*) from public.plan_events)=2;assert (select count(*) from public.service_report_events)=0;
 assert (select version from public.maintenance_plans where id='PLAN-A')=1;
end;$$;
reset role;
update public.service_reports set findings=repeat('x',9000000) where id='SR-1';
set local role authenticated;
select pg_temp.expect_error($q$select public.read_live_snapshot('SITE-901','maintenance')$q$,'54000');
reset role;update public.service_reports set findings='' where id='SR-1';
delete from public.user_jobsites where user_id='00000000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.expect_error($q$select public.live_snapshot_access('SITE-901','maintenance')$q$,'42501');
select pg_temp.expect_error($q$select public.read_live_snapshot('SITE-901','alarms')$q$,'42501');
reset role;insert into public.user_jobsites values('00000000-0000-4000-8000-000000000003','SITE-901');
update public.profiles set is_active=false where username='live_viewer';
set local role authenticated;
select pg_temp.expect_error($q$select public.live_snapshot_access('SITE-901','alarms')$q$,'42501');
reset role;update public.profiles set is_active=true where username='live_viewer';update public.jobsites set is_active=false where id='SITE-901';
set local role authenticated;
select pg_temp.expect_error($q$select public.read_live_snapshot('SITE-901','maintenance')$q$,'42501');
reset role;
do $$begin
 assert not has_function_privilege('anon','public.read_live_snapshot(text,text)','EXECUTE');
 assert not has_function_privilege('anon','public.live_snapshot_access(text,text)','EXECUTE');
 assert not has_function_privilege('anon','public.live_snapshot_context(text,text)','EXECUTE');
 assert (select count(*) from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('work_orders','work_order_events','maintenance_plans','plan_events','service_reports','service_report_events','repair_requests','repair_events','alarms','alarm_events'))=10;
 assert not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and tablename in ('plan_cycles','service_report_attachments'));
end;$$;
rollback;
\o
\echo Scoped live snapshot assertions passed; fixtures rolled back.
