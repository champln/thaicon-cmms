-- A pre-login reachability probe. Executes in PostgreSQL but never reads
-- application tables, returns identities/counts or uses elevated privileges.
create function public.database_health()
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$ select true; $$;

revoke all on function public.database_health() from public;
grant execute on function public.database_health() to anon, authenticated;
comment on function public.database_health() is
  'Non-sensitive connectivity probe only; does not verify login, write permissions or application data readiness.';
