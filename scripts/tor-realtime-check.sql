\set ON_ERROR_STOP on
\o /dev/null
begin;
do $$ begin
  if current_database()<>'thaicon_tor_check' then raise exception 'Wrong target'; end if;
  assert (select count(*) from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('work_orders','work_order_events'))=2;
end $$;
-- Preserve a pre-existing member on rerun; never drop/recreate publication.
create table public.synthetic_existing_publication_member(id integer primary key);
alter publication supabase_realtime add table public.synthetic_existing_publication_member;
\ir /migrations/202610060004_work_order_realtime.sql
do $$ begin
  assert (select count(*) from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('work_orders','work_order_events','alarms'))=3;
  assert exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='synthetic_existing_publication_member');
end $$;
rollback;
\o
\echo Work order publication SQL assertions passed; all fixtures rolled back.
