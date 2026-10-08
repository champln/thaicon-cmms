-- Only for disposable, network-isolated PostgreSQL verification.
-- Minimal Auth contract, NOT a replacement for Supabase Auth/HTTP tests.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'thaicon_uat_check' then raise exception 'Wrong test database'; end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid;
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
