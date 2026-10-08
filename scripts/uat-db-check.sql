\set ON_ERROR_STOP on
-- Run only against the disposable harness; every fixture rolls back.
begin;
do $$ begin
  if current_database() <> 'thaicon_uat_check' then raise exception 'Wrong test database'; end if;
end $$;
create function pg_temp.denied(command text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when insufficient_privilege then return;
  end;
  raise exception 'Expected permission denial: %', command;
end $$;
insert into auth.users(id,email,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','uat_engineer@example.invalid','{"username":"uat_engineer"}'),
('00000000-0000-4000-8000-000000000002','uat_peer@example.invalid','{"username":"uat_peer"}'),
('00000000-0000-4000-8000-000000000003','uat_admin@example.invalid','{"username":"uat_admin"}'),
('00000000-0000-4000-8000-000000000004','uat_user@example.invalid','{"username":"uat_user"}');
update public.profiles set role='engineer' where username in ('uat_engineer','uat_peer');
update public.profiles set role='admin' where username='uat_admin';
insert into public.jobsites(id,name,province,site_type) values
('SITE-901','Synthetic A','Test','Test'),('SITE-902','Synthetic B','Test','Test');
insert into public.user_jobsites(user_id,jobsite_id) values
('00000000-0000-4000-8000-000000000001','SITE-901'),
('00000000-0000-4000-8000-000000000002','SITE-901'),
('00000000-0000-4000-8000-000000000004','SITE-902');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin assert not public.uat_results_ready(), 'UAT must default disabled'; end $$;
select pg_temp.denied($q$insert into public.uat_runs(id,jobsite_id,scenario_version,tester_name,release_label) values ('10000000-0000-4000-8000-000000000001','SITE-901','2026-10-04','Engineer','test')$q$);
select pg_temp.denied('update private.uat_settings set enabled=true');
reset role;
update private.uat_settings set enabled=true;
do $$ begin
  assert (select count(*) from public.uat_scenarios)=32, 'Scenario catalog count';
  assert (select count(*) from public.uat_scenarios where 'admin'::public.app_role=any(roles))=30, 'Admin catalog count';
  assert (select count(*) from public.uat_scenarios where 'engineer'::public.app_role=any(roles))=13, 'Engineer catalog count';
  assert (select count(*) from public.uat_scenarios where 'user'::public.app_role=any(roles))=9, 'User catalog count';
end $$;
set local role authenticated;
do $$ begin assert public.uat_results_ready(), 'Enabled active user'; end $$;
insert into public.uat_runs(id,jobsite_id,scenario_version,tester_name,release_label) values
('10000000-0000-4000-8000-000000000001','SITE-901','2026-10-04','Engineer','test');
insert into public.uat_observations(id,run_id,scenario_id,result,actual,client_at) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','SR-01','FAIL','Synthetic failure','2026-10-04T00:00:00Z'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','SR-01','PASS','Synthetic retest','2026-10-04T00:01:00Z');
do $$ begin
  assert (select count(*) from public.uat_runs)=1, 'Owner read';
  assert (select count(*) from public.uat_observations)=2, 'History preserved';
  assert (select result from public.uat_observations order by event_no desc limit 1)='PASS', 'Server event order';
  assert (select owner_id from public.uat_runs)=auth.uid(), 'Owner derived from session';
  assert (select tester_role from public.uat_runs)='engineer', 'Role derived from profile';
  assert not exists(select 1 from public.uat_observations where recorded_by <> auth.uid()), 'Actor derived from session';
end $$;
select pg_temp.denied($q$insert into public.uat_runs(id,jobsite_id,scenario_version,tester_name,release_label) values ('10000000-0000-4000-8000-000000000002','SITE-902','2026-10-04','Engineer','test')$q$);
select pg_temp.denied($q$insert into public.uat_runs(id,jobsite_id,scenario_version,tester_name,release_label,owner_id) values ('10000000-0000-4000-8000-000000000002','SITE-901','2026-10-04','Engineer','test','00000000-0000-4000-8000-000000000003')$q$);
select pg_temp.denied($q$insert into public.uat_runs(id,jobsite_id,scenario_version,tester_name,release_label,tester_role) values ('10000000-0000-4000-8000-000000000002','SITE-901','2026-10-04','Engineer','test','admin')$q$);
select pg_temp.denied($q$insert into public.uat_observations(id,run_id,scenario_id,result,actual,client_at) values ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','WO-03','PASS','Not permitted',now())$q$);
select pg_temp.denied($q$insert into public.uat_observations(id,run_id,scenario_id,result,actual,client_at,recorded_at) values ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','SR-01','PASS','Spoof time',now(),now())$q$);
select pg_temp.denied($q$update public.uat_observations set result='PASS'$q$);
select pg_temp.denied('delete from public.uat_runs');
select pg_temp.denied('delete from public.uat_observations');
-- Peer at same site cannot see or append another tester's results.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$ begin
  assert (select count(*) from public.uat_runs)=0, 'Same-site peer isolation';
  assert (select count(*) from public.uat_observations)=0, 'Same-site observation isolation';
end $$;
select pg_temp.denied($q$insert into public.uat_observations(id,run_id,scenario_id,result,actual,client_at) values ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','SR-01','PASS','Peer spoof',now())$q$);
-- Admin may review, but not impersonate the owner.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
do $$ begin assert (select count(*) from public.uat_observations)=2, 'Admin review'; end $$;
select pg_temp.denied($q$insert into public.uat_observations(id,run_id,scenario_id,result,actual,client_at) values ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','SR-01','PASS','Admin spoof',now())$q$);
-- User can record UAT for their own role without operational edit permissions.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$ begin assert (select count(*) from public.uat_runs)=0, 'Cross-site read denied'; end $$;
insert into public.uat_runs(id,jobsite_id,scenario_version,tester_name,release_label) values
('10000000-0000-4000-8000-000000000004','SITE-902','2026-10-04','User','test');
insert into public.uat_observations(id,run_id,scenario_id,result,actual,client_at) values
('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','ROLE-02','BLOCKED','Synthetic result',now());
-- Existing sessions lose UAT access after profile/site/assignment changes.
reset role;
update public.profiles set is_active=false where username='uat_engineer';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin
  assert not public.uat_results_ready(), 'Disabled gate';
  assert (select count(*) from public.uat_observations)=0, 'Disabled read';
end $$;
select pg_temp.denied($q$insert into public.uat_observations(id,run_id,scenario_id,result,actual,client_at) values ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','SR-01','PASS','Disabled write',now())$q$);
reset role;
update public.profiles set is_active=true where username='uat_engineer';
update public.jobsites set is_active=false where id='SITE-901';
set local role authenticated;
do $$ begin assert (select count(*) from public.uat_runs)=0, 'Inactive site'; end $$;
reset role;
update public.jobsites set is_active=true where id='SITE-901';
delete from public.user_jobsites where user_id='00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin assert (select count(*) from public.uat_observations)=0, 'Revoked assignment'; end $$;
reset role;
set local role anon;
select pg_temp.denied('select * from public.uat_runs');
select pg_temp.denied('select * from public.uat_observations');
select pg_temp.denied('select public.uat_results_ready()');
reset role;
rollback;
\echo UAT database assertions passed; all synthetic fixtures rolled back.
