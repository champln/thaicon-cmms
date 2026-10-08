\set ON_ERROR_STOP on
\o /dev/null
begin;
do $$ begin if current_database()<>'thaicon_tor_check' then raise exception 'Wrong target'; end if; end $$;
create function pg_temp.expect_error(sql text, expected text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute sql;
  exception when others then
    get stacked diagnostics actual=returned_sqlstate;
    if actual=expected then return; end if;
    raise exception 'Expected %, got %: %',expected,actual,sql;
  end;
  raise exception 'Command unexpectedly succeeded: %',sql;
end;
$$;
insert into auth.users(id,email,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','admin@example.invalid','{"username":"tor_admin"}'),
('00000000-0000-4000-8000-000000000002','engineer@example.invalid','{"username":"tor_engineer"}'),
('00000000-0000-4000-8000-000000000003','peer@example.invalid','{"username":"tor_peer"}'),
('00000000-0000-4000-8000-000000000004','viewer@example.invalid','{"username":"tor_viewer"}');
update public.profiles set role='admin' where username='tor_admin';
update public.profiles set role='engineer' where username in ('tor_engineer','tor_peer');
insert into public.jobsites(id,name,province,site_type) values ('SITE-901','A','Test','Test'),('SITE-902','B','Test','Test');
insert into public.user_jobsites(user_id,jobsite_id) values
('00000000-0000-4000-8000-000000000002','SITE-901'),
('00000000-0000-4000-8000-000000000003','SITE-902'),
('00000000-0000-4000-8000-000000000004','SITE-901');
insert into public.assets(id,jobsite_id,name,asset_type,location) values ('AS-A','SITE-901','A','AC','Test');
insert into public.work_orders(id,jobsite_id,work_type,title,asset_id,due_label,created_by)
values ('WO-A','SITE-901','PM','Test','AS-A','Test','00000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin assert not public.work_order_commands_ready(); end $$;
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',1,'10000000-0000-4000-8000-000000000001','note',null,'test')$q$,'42501');
-- Legacy client still works while gate OFF, but cannot spoof managed fields.
update public.work_orders set title='Legacy edit' where id='WO-A';
do $$ begin assert (select version from public.work_orders where id='WO-A')=2; end $$;
select pg_temp.expect_error($q$update public.work_orders set version=99 where id='WO-A'$q$,'42501');
select pg_temp.expect_error($q$update public.work_orders set started_at=now() where id='WO-A'$q$,'42501');
select pg_temp.expect_error('update private.work_order_settings set enabled=true','42501');
reset role;
update private.work_order_settings set enabled=true;
set local role authenticated;
do $$ begin assert public.work_order_commands_ready(); end $$;
select pg_temp.expect_error($q$update public.work_orders set title='bypass' where id='WO-A'$q$,'42501');
select pg_temp.expect_error($q$delete from public.work_orders where id='WO-A'$q$,'42501');
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',2,'10000000-0000-4000-8000-000000000001','assign','00000000-0000-4000-8000-000000000003')$q$,'22023');
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',2,'10000000-0000-4000-8000-000000000001','assign','00000000-0000-4000-8000-000000000004')$q$,'22023');
select public.apply_work_order_command('WO-A',2,'10000000-0000-4000-8000-000000000001','assign','00000000-0000-4000-8000-000000000002');
-- Retry retains the ORIGINAL result even if later commands have changed row.
do $$ declare r jsonb; begin
  r:=public.apply_work_order_command('WO-A',2,'10000000-0000-4000-8000-000000000001','assign','00000000-0000-4000-8000-000000000002');
  assert (r->>'replayed')::boolean;
  assert (select count(*) from public.work_order_events)=1;
  assert (r->'order'->>'version')::integer=3;
end $$;
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',3,'10000000-0000-4000-8000-000000000001','note',null,'changed request')$q$,'22023');
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',2,'10000000-0000-4000-8000-000000000002','note',null,'stale')$q$,'40001');
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',3,'10000000-0000-4000-8000-000000000002','note',null,' ')$q$,'22023');
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',3,'10000000-0000-4000-8000-000000000002','start',null,'extra')$q$,'22023');
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',3,'10000000-0000-4000-8000-000000000002',null)$q$,'22023');
-- Engineer assignment attempt; viewer and cross-site peer denied.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',3,'10000000-0000-4000-8000-000000000002','assign','00000000-0000-4000-8000-000000000002')$q$,'42501');
select public.apply_work_order_command('WO-A',3,'10000000-0000-4000-8000-000000000002','start');
select public.apply_work_order_command('WO-A',4,'10000000-0000-4000-8000-000000000003','note',null,'ตรวจแล้ว');
select public.apply_work_order_command('WO-A',5,'10000000-0000-4000-8000-000000000004','submit');
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',6,'10000000-0000-4000-8000-000000000005','approve')$q$,'42501');
select pg_temp.expect_error('update public.work_order_events set note=''spoof''','42501');
select pg_temp.expect_error('delete from public.work_order_events','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
do $$ begin assert (select count(*) from public.work_order_events)=0; end $$;
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',6,'10000000-0000-4000-8000-000000000005','note',null,'out of site')$q$,'42501');
reset role;
insert into public.user_jobsites values('00000000-0000-4000-8000-000000000003','SITE-901',now(),null);
set local role authenticated;
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',6,'10000000-0000-4000-8000-000000000005','note',null,'not assigned')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$ begin assert (select count(*) from public.work_order_events)=4; end $$;
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',6,'10000000-0000-4000-8000-000000000005','note',null,'viewer')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',6,'10000000-0000-4000-8000-000000000005','return',null,' ')$q$,'22023');
select public.apply_work_order_command('WO-A',6,'10000000-0000-4000-8000-000000000005','return',null,'เติมภาพ');
-- Atomicity: simulate audit INSERT failing after the order UPDATE.
reset role;
create function pg_temp.fail_event() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure'; end $$;
create trigger synthetic_event_failure before insert on public.work_order_events for each row execute function pg_temp.fail_event();
set local role authenticated;
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',7,'10000000-0000-4000-8000-000000000006','note',null,'rollback')$q$,'P0001');
do $$ begin
  assert (select version from public.work_orders where id='WO-A')=7;
  assert (select count(*) from public.work_order_events)=5;
end $$;
reset role;
drop trigger synthetic_event_failure on public.work_order_events;
set local role authenticated;
-- Same request can safely retry after a rolled-back transaction.
select public.apply_work_order_command('WO-A',7,'10000000-0000-4000-8000-000000000006','note',null,'rollback');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.apply_work_order_command('WO-A',8,'10000000-0000-4000-8000-000000000007','submit');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.apply_work_order_command('WO-A',9,'10000000-0000-4000-8000-000000000008','approve');
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',10,'10000000-0000-4000-8000-000000000009','note',null,'closed')$q$,'22023');
do $$ begin
  assert (select count(*) from public.work_order_events)=8;
  assert (select status from public.work_orders where id='WO-A')='completed';
  assert (select progress from public.work_orders where id='WO-A')=100;
  assert (select started_at is not null and completed_at>=started_at from public.work_orders where id='WO-A');
  assert not exists(select 1 from public.work_order_events where actor_name='' or recorded_at is null);
end $$;
reset role;
update public.profiles set is_active=false where username='tor_engineer';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$ begin assert (select count(*) from public.work_order_events)=0; end $$;
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',3,'10000000-0000-4000-8000-000000000002','start')$q$,'42501');
reset role;
update public.profiles set is_active=true where username='tor_engineer';
delete from public.user_jobsites where user_id='00000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin assert (select count(*) from public.work_order_events)=0; end $$;
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',3,'10000000-0000-4000-8000-000000000002','start')$q$,'42501');
reset role;
update public.jobsites set is_active=false where id='SITE-901';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin assert (select count(*) from public.work_order_events)=0; end $$;
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',2,'10000000-0000-4000-8000-000000000001','assign','00000000-0000-4000-8000-000000000002')$q$,'42501');
reset role;
set local role anon;
select pg_temp.expect_error('select * from public.work_order_events','42501');
select pg_temp.expect_error('select public.work_order_commands_ready()','42501');
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-A',1,'10000000-0000-4000-8000-000000000001','start')$q$,'42501');
reset role;
rollback;
\o
\echo Work order command SQL assertions passed; all fixtures rolled back.
