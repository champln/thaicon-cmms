\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database()<>'thaicon_tor_check' then raise exception 'Wrong target'; end if;
end $$;
create function pg_temp.fk_denied(sql text) returns void language plpgsql as $$
begin
  begin execute sql; exception when foreign_key_violation then return; end;
  raise exception 'Expected FK denial: %',sql;
end $$;
insert into auth.users values ('00000000-0000-4000-8000-000000000001','tor@example.invalid','{"username":"tor_admin"}');
update public.profiles set role='admin';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.jobsites(id,name,province,site_type) values ('SITE-901','A','Test','Test'),('SITE-902','B','Test','Test');
insert into public.assets(id,jobsite_id,name,asset_type,location) values ('AS-A','SITE-901','A','AC','Test'),('AS-B','SITE-902','B','AC','Test');
insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by)
values ('PLAN-A','SITE-901','Test','PM',2026,12,1,auth.uid());
insert into public.work_orders(id,jobsite_id,work_type,title,asset_id,due_label,created_by)
values ('WO-A','SITE-901','PM','Test','AS-A','Test',auth.uid());
insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,work_order_id,asset_id,asset_name,service_date,technician_name,customer_name,work_performed,findings,action_taken,created_by)
values ('SR-A','SITE-901','PLAN-A','PLAN-A-C01','WO-A','AS-A','A',current_date,'Test','Test','Test','Test','Test',auth.uid());
insert into public.repair_requests(id,jobsite_id,service_report_id,asset_id,asset_name,requested_date,title,description,reported_by,created_by)
values ('RR-A','SITE-901','SR-A','AS-A','A',current_date,'Test','Test','Test',auth.uid());
insert into public.alarms(id,jobsite_id,asset_id,level,title,detail) values ('AL-A','SITE-901','AS-A','info','Test','Test');
insert into public.assets(id,jobsite_id,name,asset_type,location) values ('AS-A2','SITE-901','A2','AC','Test');
insert into public.work_orders(id,jobsite_id,work_type,title,asset_id,due_label,created_by)
values ('WO-A2','SITE-901','PM','Other asset','AS-A2','Test',auth.uid());
select pg_temp.fk_denied($q$update public.service_reports set work_order_id='WO-A2' where id='SR-A'$q$);
select pg_temp.fk_denied($q$update public.repair_requests set asset_id='AS-A2' where id='RR-A'$q$);
select pg_temp.fk_denied($q$update public.work_orders set asset_id='AS-B' where id='WO-A'$q$);
select pg_temp.fk_denied($q$update public.alarms set asset_id='AS-B' where id='AL-A'$q$);
select pg_temp.fk_denied($q$update public.service_reports set asset_id='AS-B' where id='SR-A'$q$);
select pg_temp.fk_denied($q$update public.service_reports set work_order_id='MISSING' where id='SR-A'$q$);
select pg_temp.fk_denied($q$update public.repair_requests set asset_id='AS-B' where id='RR-A'$q$);
select pg_temp.fk_denied($q$update public.repair_requests set service_report_id='MISSING' where id='RR-A'$q$);
select pg_temp.fk_denied($q$delete from public.assets where id='AS-A'$q$);
-- Optional references remain optional; no fabricated links required.
update public.repair_requests set service_report_id=null where id='RR-A';
update public.service_reports set work_order_id=null where id='SR-A';
do $$ begin
  assert (select count(*) from public.work_orders)=2;
  assert (select count(*) from public.service_reports)=1;
  assert (select count(*) from pg_constraint where conname in (
    'work_orders_asset_same_site_fk','alarms_asset_same_site_fk','reports_asset_same_site_fk',
    'reports_order_same_asset_fk','repairs_asset_same_site_fk','repairs_report_same_asset_fk'
  ) and not convalidated)=6, 'Legacy validation must remain explicitly pending';
end $$;
-- Exercise the staged upgrade on a deliberately inconsistent legacy relation.
-- All DDL and fixtures here roll back; never run on a deployed database.
alter table public.work_orders drop constraint work_orders_asset_same_site_fk;
insert into public.work_orders(id,jobsite_id,work_type,title,asset_id,due_label,created_by)
values ('WO-LEGACY','SITE-901','PM','Legacy mismatch','AS-B','Unknown',auth.uid());
alter table public.work_orders add constraint work_orders_asset_same_site_fk
foreign key(jobsite_id,asset_id) references public.assets(jobsite_id,id) on delete restrict not valid;
do $$ begin assert exists(select 1 from public.work_orders where id='WO-LEGACY'), 'Legacy record must survive'; end $$;
select pg_temp.fk_denied($q$alter table public.work_orders validate constraint work_orders_asset_same_site_fk$q$);
select pg_temp.fk_denied($q$insert into public.work_orders(id,jobsite_id,work_type,title,asset_id,due_label,created_by) values ('WO-BAD-NEW','SITE-901','PM','Bad','AS-B','Test',auth.uid())$q$);
rollback;
\echo TOR scope checks passed; fixtures rolled back. Not an Auth/RLS test.
