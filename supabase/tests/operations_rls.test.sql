begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_table('public', 'assets', 'asset registry exists');
select has_table('public', 'work_orders', 'Work Order table exists');
select has_table('public', 'alarms', 'Alarm table exists');
select has_column('public', 'jobsites', 'pm_compliance', 'Jobsite has PM compliance');
select col_is_fk('public', 'work_orders', 'jobsite_id', 'Work Orders reference Jobsites');
select col_is_fk('public', 'work_orders', 'asset_id', 'Work Orders reference assets');
select col_is_fk('public', 'alarms', 'jobsite_id', 'Alarms reference Jobsites');
select col_is_fk('public', 'alarms', 'asset_id', 'Alarms reference assets');
select ok((select relrowsecurity from pg_class where oid = 'public.assets'::regclass), 'RLS is enabled on assets');
select ok((select relrowsecurity from pg_class where oid = 'public.work_orders'::regclass), 'RLS is enabled on Work Orders');
select ok((select relrowsecurity from pg_class where oid = 'public.alarms'::regclass), 'RLS is enabled on Alarms');
select ok((select count(*) >= 4 from pg_policies where schemaname = 'public' and tablename in ('assets', 'work_orders', 'alarms')), 'operations tables have RLS policies');

select * from finish();
rollback;
