-- Disposable PostgreSQL harness ONLY. Auth/Storage schemas are minimal shims;
-- successful SQL tests do not certify Supabase HTTP, JWT or object storage.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'thaicon_tor_check' then raise exception 'Wrong target'; end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key, bucket_id text, name text, owner_id text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$
select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1];
$$;
