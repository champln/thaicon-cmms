\set ON_ERROR_STOP on
\o /dev/null
begin;
do $$ begin
  if current_database()<>'thaicon_tor_check' then raise exception 'Wrong target'; end if;
  assert (select count(*) from public.uat_scenarios where version='2026-10-04')=32;
  assert (select count(*) from public.uat_scenarios where version='2026-10-06')=38;
  assert not exists(select 1 from public.uat_scenarios where version='2026-10-04' and id='MAT-01');
  assert (select roles from public.uat_scenarios where version='2026-10-06' and id='WO-06')=array['admin']::public.app_role[];
end $$;
insert into auth.users(id,email,raw_user_meta_data)
values('00000000-0000-4000-8000-000000000001','uat-tor@example.invalid','{"username":"uat_tor"}');
update public.profiles set role='engineer' where username='uat_tor';
insert into public.jobsites(id,name,province,site_type) values('SITE-901','Test','Test','Test');
insert into public.user_jobsites(user_id,jobsite_id) values('00000000-0000-4000-8000-000000000001','SITE-901');
update private.uat_settings set enabled=true;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.uat_runs(id,jobsite_id,scenario_version,tester_name,release_label) values
('40000000-0000-4000-8000-000000000001','SITE-901','2026-10-04','Synthetic','Old'),
('40000000-0000-4000-8000-000000000002','SITE-901','2026-10-06','Synthetic','New');
insert into public.uat_observations(id,run_id,scenario_id,result,actual,evidence,client_at)
values('40000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000002','MAT-01','BLOCKED','Synthetic','',now());
do $$ begin
  begin
    insert into public.uat_observations(id,run_id,scenario_id,result,actual,evidence,client_at)
    values('40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000001','MAT-01','PASS','Wrong version','',now());
    raise exception 'Old run accepted new scenario';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.uat_runs)=2;
  assert (select count(*) from public.uat_observations)=1;
end $$;
reset role;
rollback;
\o
\echo Versioned TOR UAT SQL assertions passed; all fixtures rolled back.
