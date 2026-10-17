\set ON_ERROR_STOP on
begin;
do $$begin if current_database()<>'thaicon_tor_check' then raise exception 'Wrong target';end if;end;$$;
create function pg_temp.expect_error(sql text) returns void language plpgsql as $$
begin begin execute sql;exception when insufficient_privilege then return;end;raise exception 'Unexpected success';end;$$;
insert into auth.users(id,email,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','a@example.invalid','{"username":"notice_admin"}'),
('00000000-0000-4000-8000-000000000002','e@example.invalid','{"username":"notice_engineer"}'),
('00000000-0000-4000-8000-000000000003','v@example.invalid','{"username":"notice_viewer"}');
update public.profiles set role='admin' where username='notice_admin';
update public.profiles set role='engineer' where username='notice_engineer';
insert into public.jobsites(id,name,province,site_type) values('SITE-901','A','T','T'),('SITE-902','B','T','T');
insert into public.user_jobsites values('00000000-0000-4000-8000-000000000002','SITE-901'),('00000000-0000-4000-8000-000000000003','SITE-901');
insert into public.assets(id,jobsite_id,name,asset_type,location) values('AS-A','SITE-901','A','AC','T'),('AS-B','SITE-902','B','AC','T');
insert into public.work_orders(id,jobsite_id,asset_id,work_type,title,status,assignee_id,assigned_by,assigned_at,due_label,due_at,created_by) values
('WO-A','SITE-901','AS-A','PM','Own','review','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',now(),'test',now()-interval '1 hour','00000000-0000-4000-8000-000000000001'),
('WO-B','SITE-902','AS-B','PM','Outside','review','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',now(),'test',now()-interval '1 hour','00000000-0000-4000-8000-000000000001'),
('WO-C','SITE-901','AS-A','PM','Someone else','in_progress','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',now(),'test',now()+interval '1 hour','00000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$declare feed jsonb; key text;begin
 feed:=public.read_work_notifications('SITE-901');
 assert jsonb_array_length(feed->'items')=2;
 assert not exists(select 1 from jsonb_array_elements(feed->'items') n where n->>'orderId'<>'WO-A');
 key:=feed->'items'->0->>'id';
 perform public.mark_work_notification_read('SITE-901',key);
 perform public.mark_work_notification_read('SITE-901',key);
 feed:=public.read_work_notifications('SITE-901');
 assert (select count(*) from jsonb_array_elements(feed->'items') n where (n->>'read')::boolean)=1;
end;$$;
select pg_temp.expect_error($q$select public.read_work_notifications('SITE-902')$q$);
select pg_temp.expect_error($q$select public.mark_work_notification_read('SITE-901','forged')$q$);
select pg_temp.expect_error($q$select * from private.work_notification_reads$q$);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$declare feed jsonb;begin
 feed:=public.read_work_notifications('SITE-901');
 assert exists(select 1 from jsonb_array_elements(feed->'items') n where n->>'kind'='review');
 assert not exists(select 1 from jsonb_array_elements(feed->'items') n where (n->>'read')::boolean);
end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.read_work_notifications('SITE-901')$q$);
reset role;
do $$begin assert (select count(*) from private.work_notification_reads)=1;
 assert not has_function_privilege('anon','public.read_work_notifications(text)','EXECUTE');
 assert not has_function_privilege('anon','public.mark_work_notification_read(text,text)','EXECUTE');
end;$$;
delete from public.user_jobsites where user_id='00000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_error($q$select public.read_work_notifications('SITE-901')$q$);
reset role;
rollback;
\echo Notification scope and idempotent receipt assertions passed.
