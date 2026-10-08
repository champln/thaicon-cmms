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
('00000000-0000-4000-8000-000000000001','admin@example.invalid','{"username":"plan_admin"}'),
('00000000-0000-4000-8000-000000000002','engineer@example.invalid','{"username":"plan_engineer"}'),
('00000000-0000-4000-8000-000000000003','viewer@example.invalid','{"username":"plan_viewer"}');
update public.profiles set role='admin' where username='plan_admin';
update public.profiles set role='engineer' where username='plan_engineer';
insert into public.jobsites(id,name,province,site_type) values('SITE-901','A','Test','Test'),('SITE-902','B','Test','Test');
insert into public.user_jobsites(user_id,jobsite_id) values('00000000-0000-4000-8000-000000000002','SITE-901'),('00000000-0000-4000-8000-000000000003','SITE-901');
insert into public.assets(id,jobsite_id,name,asset_type,location) values('AS-A','SITE-901','A','AC','Test');
create function pg_temp.data() returns jsonb language sql as $$
 select '{"name":"Test","service_type":"PM","plan_year":2026,"annual_target":1,"cycle_months":1,"start_month":1,"status":"active"}'::jsonb;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin assert not public.plan_commands_ready(); end $$;
insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by)
 values('PLAN-legacy','SITE-901','Legacy','PM',2026,12,1,auth.uid());
update public.maintenance_plans set name='Legacy edit' where id='PLAN-legacy';
do $$ begin assert (select version from public.maintenance_plans where id='PLAN-legacy')=2; end $$;
select pg_temp.expect_error($q$update public.maintenance_plans set version=99 where id='PLAN-legacy'$q$,'42501');
reset role;
-- A real historical custom cycle target must survive a name-only edit.
update public.plan_cycles set target=7 where id='PLAN-legacy-C01';
update private.plan_settings set enabled=true;
set local role authenticated;
do $$ begin assert public.plan_commands_ready(); end $$;
select public.apply_plan_command('PLAN-legacy','SITE-901',2,'10000000-0000-4000-8000-000000000001',pg_temp.data()||'{"annual_target":12,"name":"Renamed"}');
do $$ begin assert (select target from public.plan_cycles where id='PLAN-legacy-C01')=7; end $$;
select pg_temp.expect_error($q$update public.maintenance_plans set name='Bypass' where id='PLAN-legacy'$q$,'42501');
select pg_temp.expect_error($q$update public.plan_cycles set target=9 where id='PLAN-legacy-C01'$q$,'42501');
select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000001','SITE-901',0,'10000000-0000-4000-8000-000000000002',pg_temp.data());
select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000001','SITE-901',0,'10000000-0000-4000-8000-000000000002',pg_temp.data());
do $$ begin
 assert (select count(*) from public.plan_cycles where plan_id='PLAN-30000000-0000-4000-8000-000000000001' and target=0)=11;
 assert (select sum(target) from public.plan_cycles where plan_id='PLAN-30000000-0000-4000-8000-000000000001')=1;
 assert (select count(*) from public.plan_events)=2;
end $$;
select pg_temp.expect_error($q$select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000001','SITE-901',0,'10000000-0000-4000-8000-000000000002',pg_temp.data()||'{"name":"Different"}')$q$,'22023');
select pg_temp.expect_error($q$select public.apply_plan_command('PLAN-legacy','SITE-901',2,'10000000-0000-4000-8000-000000000003',pg_temp.data())$q$,'40001');
-- Plan-only gate must not break legacy Engineer report creation (Admin-only plan UPDATE RLS).
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,asset_id,asset_name,service_date,technician_name,customer_name,work_performed,findings,action_taken,created_by)
 values('SR-A','SITE-901','PLAN-legacy','PLAN-legacy-C01','AS-A','A','2026-10-06','Tech','Customer','Clean','','',auth.uid());
select pg_temp.expect_error($q$select public.apply_plan_command('PLAN-legacy','SITE-901',3,'10000000-0000-4000-8000-000000000003',pg_temp.data())$q$,'42501');
select pg_temp.expect_error($q$select public.read_plan_command_state('PLAN-legacy','SITE-902')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select public.apply_plan_command('PLAN-legacy','SITE-901',3,'10000000-0000-4000-8000-000000000003','{}',true)$q$,'22023');
select pg_temp.expect_error($q$select public.apply_plan_command('PLAN-legacy','SITE-901',3,'10000000-0000-4000-8000-000000000003',pg_temp.data()||'{"annual_target":12,"cycle_months":3}')$q$,'22023');
select public.apply_plan_command('PLAN-legacy','SITE-901',3,'10000000-0000-4000-8000-000000000003',pg_temp.data()||'{"annual_target":101,"cycle_months":1}');
do $$ begin assert (select cycle_id from public.service_reports where id='SR-A')='PLAN-legacy-C01';assert (select actual from public.plan_progress where plan_id='PLAN-legacy')=0;end $$;
reset role;
create function pg_temp.fail_audit() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure';end;$$;
create trigger synthetic_plan_audit_failure before insert on public.plan_events for each row execute function pg_temp.fail_audit();
set local role authenticated;
select pg_temp.expect_error($q$select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000001','SITE-901',1,'10000000-0000-4000-8000-000000000004',pg_temp.data()||'{"annual_target":101,"cycle_months":3}')$q$,'P0001');
select pg_temp.expect_error($q$select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000001','SITE-901',1,'10000000-0000-4000-8000-000000000004','{}',true)$q$,'P0001');
select pg_temp.expect_error($q$select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000002','SITE-901',0,'10000000-0000-4000-8000-000000000004',pg_temp.data())$q$,'P0001');
do $$ begin assert (select version from public.maintenance_plans where id='PLAN-30000000-0000-4000-8000-000000000001')=1;
 assert (select count(*) from public.plan_cycles where plan_id='PLAN-30000000-0000-4000-8000-000000000001')=12;
 assert (select sum(target) from public.plan_cycles where plan_id='PLAN-30000000-0000-4000-8000-000000000001')=1;
 assert not exists(select 1 from public.maintenance_plans where id='PLAN-30000000-0000-4000-8000-000000000002');end $$;
reset role;
drop trigger synthetic_plan_audit_failure on public.plan_events;
set local role authenticated;
select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000001','SITE-901',1,'10000000-0000-4000-8000-000000000004','{}',true);
select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000001','SITE-901',1,'10000000-0000-4000-8000-000000000004','{}',true);
do $$ begin
 assert (public.read_plan_command_state('PLAN-30000000-0000-4000-8000-000000000001','SITE-901')->>'deleted')::boolean;
 assert (select jsonb_array_length(before_snapshot->'cycles') from public.plan_events where command='delete')=12;
 assert not exists(select 1 from public.plan_cycles where plan_id='PLAN-30000000-0000-4000-8000-000000000001');
end $$;
select pg_temp.expect_error($q$select public.apply_plan_command('PLAN-30000000-0000-4000-8000-000000000001','SITE-901',0,'10000000-0000-4000-8000-000000000005',pg_temp.data())$q$,'22023');
select pg_temp.expect_error($q$select public.read_plan_command_state('Missing','SITE-901')$q$,'22023');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
do $$ begin assert (public.read_plan_command_state('PLAN-30000000-0000-4000-8000-000000000001','SITE-901')->>'deleted')::boolean;end $$;
select pg_temp.expect_error($q$select public.apply_plan_command('PLAN-legacy','SITE-901',4,'10000000-0000-4000-8000-000000000005',pg_temp.data())$q$,'42501');
reset role;
update private.plan_settings set enabled=false;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by) values('PLAN-30000000-0000-4000-8000-000000000001','SITE-901','Reuse','PM',2026,12,1,auth.uid())$q$,'22023');
reset role;
rollback;
\o
\echo Plan/cycle command assertions passed; fixtures rolled back.
