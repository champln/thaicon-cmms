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
  raise exception 'Unexpected success: %',sql;
end;
$$;
insert into auth.users(id,email,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','create-admin@example.invalid','{"username":"create_admin"}'),
('00000000-0000-4000-8000-000000000002','create-eng@example.invalid','{"username":"create_eng"}'),
('00000000-0000-4000-8000-000000000003','create-peer@example.invalid','{"username":"create_peer"}'),
('00000000-0000-4000-8000-000000000004','create-viewer@example.invalid','{"username":"create_viewer"}');
update public.profiles set role='admin' where username='create_admin';
update public.profiles set role='engineer' where username in ('create_eng','create_peer');
insert into public.jobsites(id,name,province,site_type) values ('SITE-901','A','Test','Test'),('SITE-902','B','Test','Test');
insert into public.assets(id,jobsite_id,name,asset_type,location) values ('CREATE-A','SITE-901','A','AC','Test'),('CREATE-B','SITE-902','B','AC','Test');
insert into public.user_jobsites(user_id,jobsite_id) values ('00000000-0000-4000-8000-000000000002','SITE-901');
insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by)
values('SMALL-TARGET','SITE-901','Small','PM',2026,1,1,'00000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.plan_cycles where plan_id='SMALL-TARGET' and target=0)=11;
  assert (select sum(target) from public.plan_cycles where plan_id='SMALL-TARGET')=1;
end $$;
select pg_temp.expect_error($q$update public.plan_cycles set target=-1 where id='SMALL-TARGET-C01'$q$,'23514');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select public.create_work_order_command('WO-20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','SITE-901','CREATE-A','Test','CM','normal','Test')$q$,'42501');
reset role;
update private.work_order_settings set enabled=true;
set local role authenticated;
do $$ begin
  assert (select count(*) from public.work_order_assignees('SITE-901'))=2;
  assert not exists(select 1 from public.work_order_assignees('SITE-901') where id in ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'));
end $$;
select pg_temp.expect_error($q$select public.create_work_order_command('WO-20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','SITE-901','CREATE-B','Test','CM','normal','Test')$q$,'22023');
select pg_temp.expect_error($q$select public.create_work_order_command('WO-20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','SITE-901','CREATE-A',' ','CM','normal','Test')$q$,'22023');
do $$ declare r jsonb; begin
  r:=public.create_work_order_command('WO-20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','SITE-901','CREATE-A',' Test ','CM','normal','Test','Actual description');
  assert not (r->>'replayed')::boolean;
  assert r->'order'->>'title'='Test';
  assert r->'order'->>'description'='Actual description';
  assert (r->'order'->>'version')::integer=1;
  assert r->'order'->>'created_by'='00000000-0000-4000-8000-000000000001';
  assert r->'order'->>'status'='waiting';
  assert r->'order'->>'assignee_id' is null;
  assert (select count(*) from public.work_order_events)=1;
  assert (select command from public.work_order_events)='create';
  r:=public.create_work_order_command('WO-20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','SITE-901','CREATE-A','Test','CM','normal','Test','Actual description');
  assert (r->>'replayed')::boolean;
  assert (select count(*) from public.work_order_events)=1;
end $$;
select pg_temp.expect_error($q$select public.create_work_order_command('WO-20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','SITE-901','CREATE-A','Changed','CM','normal','Test','Actual description')$q$,'22023');
select pg_temp.expect_error($q$select public.apply_work_order_command('WO-20000000-0000-4000-8000-000000000001',1,'20000000-0000-4000-8000-000000000001','note',null,'reuse create request')$q$,'22023');
-- If evidence cannot be written, no created order may remain.
reset role;
create function pg_temp.fail_event() returns trigger language plpgsql as $$ begin raise exception 'Synthetic event failure'; end $$;
create trigger synthetic_creation_failure before insert on public.work_order_events for each row execute function pg_temp.fail_event();
set local role authenticated;
select pg_temp.expect_error($q$select public.create_work_order_command('WO-20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','SITE-901','CREATE-A','Rollback','EM','high','Test')$q$,'P0001');
do $$ begin assert not exists(select 1 from public.work_orders where title='Rollback'); end $$;
reset role;
drop trigger synthetic_creation_failure on public.work_order_events;
set local role authenticated;
select public.create_work_order_command('WO-20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','SITE-901','CREATE-A','Rollback','EM','high','Test');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select public.work_order_assignees('SITE-901')$q$,'42501');
select pg_temp.expect_error($q$select public.create_work_order_command('WO-20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','SITE-901','CREATE-A','Denied','PM','normal','Test')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.expect_error($q$select public.create_work_order_command('WO-20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','SITE-901','CREATE-A','Denied','PM','normal','Test')$q$,'42501');
reset role;
update public.profiles set is_active=false where username='create_admin';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select public.work_order_assignees('SITE-901')$q$,'42501');
select pg_temp.expect_error($q$select public.create_work_order_command('WO-20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','SITE-901','CREATE-A','Denied','PM','normal','Test')$q$,'42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select public.work_order_assignees('SITE-901')$q$,'42501');
select pg_temp.expect_error($q$select public.create_work_order_command('WO-20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','SITE-901','CREATE-A','Denied','PM','normal','Test')$q$,'42501');
reset role;
rollback;
\o
\echo Work order creation SQL assertions passed; all fixtures rolled back.
