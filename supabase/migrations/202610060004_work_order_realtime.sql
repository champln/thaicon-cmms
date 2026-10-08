-- Pending, additive publication setup. Preserve every pre-existing member.
-- Client UI must re-read through RLS, not treat event payloads as write results.
do $$
declare target text;
begin
  if not exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime' and puballtables) then return; end if;
  foreach target in array array['work_orders','work_order_events'] loop
    if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=target) then
      execute format('alter publication supabase_realtime add table public.%I',target);
    end if;
  end loop;
end;
$$;
