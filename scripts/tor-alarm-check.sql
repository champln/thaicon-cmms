\set ON_ERROR_STOP on
\o /dev/null
begin;
do $$begin if current_database()<>'thaicon_tor_check' then raise exception 'Wrong target';end if;end;$$;
create function pg_temp.expect_error(sql text,expected text) returns void language plpgsql as $$
declare actual text;begin begin execute sql;exception when others then get stacked diagnostics actual=returned_sqlstate;if actual=expected then return;end if;raise exception 'Expected %, got %',expected,actual;end;raise exception 'Unexpected success';end;$$;
insert into auth.users(id,email,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','admin@example.invalid','{"username":"alarm_admin"}'),
('00000000-0000-4000-8000-000000000002','engineer@example.invalid','{"username":"alarm_engineer"}'),
('00000000-0000-4000-8000-000000000003','viewer@example.invalid','{"username":"alarm_viewer"}');
update public.profiles set role='admin' where username='alarm_admin';update public.profiles set role='engineer' where username='alarm_engineer';
insert into public.jobsites(id,name,province,site_type) values('SITE-901','A','Test','Test'),('SITE-902','B','Test','Test');
insert into public.user_jobsites values('00000000-0000-4000-8000-000000000002','SITE-901'),('00000000-0000-4000-8000-000000000003','SITE-901');
insert into public.assets(id,jobsite_id,name,asset_type,location) values('AS-A','SITE-901','A','AC','Test');
insert into public.alarms(id,jobsite_id,asset_id,level,title,detail,measured_value) values('AL-A','SITE-901','AS-A','warning','Original','Newest reading','31'),('AL-B','SITE-901','AS-A','warning','Rollback','Latest','32');
set local role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$begin assert not public.alarm_commands_ready();end;$$;
update public.alarms set detail='Explicit legacy edit' where id='AL-A';
do $$begin assert (select version from public.alarms where id='AL-A')=2;end;$$;
select pg_temp.expect_error($q$update public.alarms set version=99 where id='AL-A'$q$,'42501');
reset role;update private.alarm_settings set enabled=true;
set local role authenticated;
select public.acknowledge_alarm_command('AL-A','SITE-901','10000000-0000-4000-8000-000000000001');
select public.acknowledge_alarm_command('AL-A','SITE-901','10000000-0000-4000-8000-000000000001');
do $$begin
 assert (select count(*) from public.alarm_events)=1;
 assert (select version from public.alarms where id='AL-A')=3;
 assert (select acknowledged_by from public.alarms where id='AL-A')=auth.uid();
 assert (select title||':'||detail||':'||measured_value from public.alarms where id='AL-A')='Original:Explicit legacy edit:31';
end;$$;
select pg_temp.expect_error($q$select public.acknowledge_alarm_command('AL-B','SITE-901','10000000-0000-4000-8000-000000000001')$q$,'22023');
select pg_temp.expect_error($q$select public.acknowledge_alarm_command('AL-A','SITE-902','10000000-0000-4000-8000-000000000002')$q$,'42501');
select pg_temp.expect_error($q$update public.alarms set measured_value='Stale' where id='AL-A'$q$,'42501');
select pg_temp.expect_error($q$delete from public.alarm_events$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.acknowledge_alarm_command('AL-A','SITE-901','10000000-0000-4000-8000-000000000002');
do $$begin assert (select version from public.alarms where id='AL-A')=3;assert (select acknowledged_by from public.alarms where id='AL-A')='00000000-0000-4000-8000-000000000002';assert (select changed from public.alarm_events where request_id='10000000-0000-4000-8000-000000000002')=false;end;$$;
reset role;
create function pg_temp.fail_audit() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure';end;$$;
create trigger synthetic_alarm_audit_failure before insert on public.alarm_events for each row execute function pg_temp.fail_audit();
set local role authenticated;
select pg_temp.expect_error($q$select public.acknowledge_alarm_command('AL-B','SITE-901','10000000-0000-4000-8000-000000000003')$q$,'P0001');
do $$begin assert not (select acknowledged from public.alarms where id='AL-B');assert (select version from public.alarms where id='AL-B')=1;end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.acknowledge_alarm_command('AL-B','SITE-901','10000000-0000-4000-8000-000000000003')$q$,'42501');
reset role;update public.profiles set is_active=false where username='alarm_engineer';
set local role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select public.acknowledge_alarm_command('AL-A','SITE-901','10000000-0000-4000-8000-000000000001')$q$,'42501');
reset role;rollback;
\o
\echo Alarm command assertions passed; fixtures rolled back.
