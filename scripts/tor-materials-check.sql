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
('00000000-0000-4000-8000-000000000001','mat-admin@example.invalid','{"username":"mat_admin"}'),
('00000000-0000-4000-8000-000000000002','mat-eng@example.invalid','{"username":"mat_eng"}'),
('00000000-0000-4000-8000-000000000003','mat-peer@example.invalid','{"username":"mat_peer"}'),
('00000000-0000-4000-8000-000000000004','mat-view@example.invalid','{"username":"mat_view"}');
update public.profiles set role='admin' where username='mat_admin';
update public.profiles set role='engineer' where username in ('mat_eng','mat_peer');
insert into public.jobsites(id,name,province,site_type) values ('SITE-901','A','Test','Test'),('SITE-902','B','Test','Test');
insert into public.user_jobsites(user_id,jobsite_id) values
('00000000-0000-4000-8000-000000000002','SITE-901'),('00000000-0000-4000-8000-000000000003','SITE-902'),('00000000-0000-4000-8000-000000000004','SITE-901');
insert into public.assets(id,jobsite_id,name,asset_type,location) values ('MAT-A','SITE-901','A','AC','Test');
insert into public.work_orders(id,jobsite_id,work_type,title,asset_id,due_label,created_by)
values ('WO-MAT','SITE-901','CM','Test','MAT-A','Test','00000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-901','[]')$q$,'42501');
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',1,'30000000-0000-4000-8000-000000000001','add','Filter',1,'piece')$q$,'42501');
reset role;
update private.work_order_settings set enabled=true;
set local role authenticated;
do $$declare c jsonb;begin
 c:=public.material_ledger_context('SITE-901','[{"id":"WO-MAT","version":1}]');
 assert c->>'actor_role'='admin' and c->>'parent_count'='1';
 assert (c->>'enabled')::boolean;
end;$$;
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-901','[{"id":"WO-MAT","version":2}]')$q$,'40001');
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-901','[{"id":"WO-MAT","version":1},{"id":"WO-MAT","version":1}]')$q$,'22023');
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-901','[{"id":"WO-MAT","version":1.5}]')$q$,'22023');
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-901','[{"id":"WO-MAT"}]')$q$,'22023');
select public.apply_work_order_command('WO-MAT',1,'30000000-0000-4000-8000-000000000011','assign','00000000-0000-4000-8000-000000000002');
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',2,'30000000-0000-4000-8000-000000000001','add','Filter',1,'piece')$q$,'22023');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.apply_work_order_command('WO-MAT',2,'30000000-0000-4000-8000-000000000012','start');
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',3,'30000000-0000-4000-8000-000000000001','add','Filter',0,'piece')$q$,'22023');
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',3,'30000000-0000-4000-8000-000000000001','add','Filter',1.00001,'piece')$q$,'22023');
-- Failure of material INSERT must roll back BOTH audit and parent version.
reset role;
create function pg_temp.fail_material() returns trigger language plpgsql as $$ begin raise exception 'Synthetic material failure'; end $$;
create trigger synthetic_material_failure before insert on public.work_order_materials for each row execute function pg_temp.fail_material();
set local role authenticated;
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',3,'30000000-0000-4000-8000-000000000001','add','Filter',1.25,'piece')$q$,'P0001');
do $$ begin assert (select version from public.work_orders where id='WO-MAT')=3; assert (select count(*) from public.work_order_events)=2; end $$;
reset role;
drop trigger synthetic_material_failure on public.work_order_materials;
set local role authenticated;
select public.record_work_order_material('WO-MAT',3,'30000000-0000-4000-8000-000000000001','add','Filter',1.25,'piece');
do $$ declare r jsonb; begin
  assert (select quantity from public.work_order_materials)=1.25;
  assert (select recorded_by::text from public.work_order_materials)='00000000-0000-4000-8000-000000000002';
  r:=public.record_work_order_material('WO-MAT',3,'30000000-0000-4000-8000-000000000001','add','Filter',1.25,'piece');
  assert (r->>'replayed')::boolean;
  assert (select count(*) from public.work_order_materials)=1;
end $$;
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',3,'30000000-0000-4000-8000-000000000002','add','Filter',1,'piece')$q$,'40001');
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',4,'30000000-0000-4000-8000-000000000001','add','Filter',2,'piece')$q$,'22023');
select pg_temp.expect_error($q$update public.work_order_materials set quantity=999$q$,'42501');
select pg_temp.expect_error($q$delete from public.work_order_materials$q$,'42501');
select public.record_work_order_material('WO-MAT',4,'30000000-0000-4000-8000-000000000002','void',null,null,null,'30000000-0000-4000-8000-000000000001','จำนวนผิด');
do $$ begin
  assert (select count(*) from public.work_order_materials)=1;
  assert (select void_reason from public.work_order_materials)='จำนวนผิด';
  assert (select voided_at>=recorded_at from public.work_order_materials);
end $$;
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',5,'30000000-0000-4000-8000-000000000003','void',null,null,null,'30000000-0000-4000-8000-000000000001','twice')$q$,'22023');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-901','[]')$q$,'42501');
do $$ begin assert (select count(*) from public.work_order_materials)=0; end $$;
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',5,'30000000-0000-4000-8000-000000000003','add','Filter',1,'piece')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$declare c jsonb;begin
 c:=public.material_ledger_context('SITE-901','[{"id":"WO-MAT","version":5}]');
 assert c->>'actor_role'='user' and c->>'actor_id'=auth.uid()::text;
 assert public.material_ledger_context('SITE-901','[]')->>'parent_count'='0';
end;$$;
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-902','[]')$q$,'42501');
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-901','[{"id":"missing","version":1}]')$q$,'42501');
reset role;
delete from public.user_jobsites where user_id='00000000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-901','[]')$q$,'42501');
reset role;
insert into public.user_jobsites values('00000000-0000-4000-8000-000000000004','SITE-901');
update public.profiles set is_active=false where username='mat_view';
set local role authenticated;
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-901','[]')$q$,'42501');
reset role;
update public.profiles set is_active=true where username='mat_view';
set local role authenticated;
do $$ begin assert (select count(*) from public.work_order_materials)=1; end $$;
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',5,'30000000-0000-4000-8000-000000000003','add','Filter',1,'piece')$q$,'42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select public.material_ledger_context('SITE-901','[]')$q$,'42501');
select pg_temp.expect_error('select * from public.work_order_materials','42501');
select pg_temp.expect_error($q$select public.record_work_order_material('WO-MAT',5,'30000000-0000-4000-8000-000000000003','add','Filter',1,'piece')$q$,'42501');
reset role;
rollback;
\o
\echo Material usage SQL assertions passed; all fixtures rolled back.
