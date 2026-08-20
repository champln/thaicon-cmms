-- ThaiCon CMMS access-control foundation.
-- This migration deliberately covers authentication profiles and Jobsite access only.
-- Work-order workflow tables will be added after the customer approves the end-to-end flow.

create type public.app_role as enum ('admin', 'engineer', 'user');

create table public.jobsites (
  id text primary key,
  name text not null,
  province text not null,
  site_type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobsites_id_format check (id ~ '^SITE-[0-9]{3,}$')
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role public.app_role not null default 'user',
  title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_normalized check (username = lower(username)),
  constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,50}$')
);

create table public.user_jobsites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  jobsite_id text not null references public.jobsites (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles (id) on delete set null,
  primary key (user_id, jobsite_id)
);

create index user_jobsites_jobsite_id_idx on public.user_jobsites (jobsite_id);

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = (select auth.uid())
    and profile.is_active = true;
$$;

create function private.can_access_jobsite(target_jobsite_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_user_role() = 'admin'::public.app_role
    or exists (
      select 1
      from public.user_jobsites as access
      join public.profiles as profile on profile.id = access.user_id
      where access.user_id = (select auth.uid())
        and access.jobsite_id = target_jobsite_id
        and profile.is_active = true
    ),
    false
  );
$$;

revoke all on function private.current_user_role() from public;
revoke all on function private.can_access_jobsite(text) from public;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.can_access_jobsite(text) to authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger jobsites_set_updated_at
before update on public.jobsites
for each row execute function private.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_display_name text;
begin
  requested_username := lower(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(coalesce(new.email, new.id::text), '@', 1)
  ));
  requested_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    requested_username
  );

  insert into public.profiles (id, username, display_name, role)
  values (new.id, requested_username, requested_display_name, 'user')
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

alter table public.jobsites enable row level security;
alter table public.profiles enable row level security;
alter table public.user_jobsites enable row level security;

revoke all on public.jobsites from anon;
revoke all on public.profiles from anon;
revoke all on public.user_jobsites from anon;

grant select, insert, update, delete on public.jobsites to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.user_jobsites to authenticated;

create policy "Authorized users can view Jobsites"
on public.jobsites
for select
to authenticated
using (private.can_access_jobsite(id));

create policy "Admins can create Jobsites"
on public.jobsites
for insert
to authenticated
with check (private.current_user_role() = 'admin');

create policy "Admins can update Jobsites"
on public.jobsites
for update
to authenticated
using (private.current_user_role() = 'admin')
with check (private.current_user_role() = 'admin');

create policy "Admins can delete Jobsites"
on public.jobsites
for delete
to authenticated
using (private.current_user_role() = 'admin');

create policy "Users can view their profile and admins can view all profiles"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or private.current_user_role() = 'admin'
);

create policy "Admins can create profiles"
on public.profiles
for insert
to authenticated
with check (private.current_user_role() = 'admin');

create policy "Admins can update profiles"
on public.profiles
for update
to authenticated
using (private.current_user_role() = 'admin')
with check (private.current_user_role() = 'admin');

create policy "Admins can delete profiles"
on public.profiles
for delete
to authenticated
using (private.current_user_role() = 'admin');

create policy "Users can view their Jobsite assignments and admins can view all assignments"
on public.user_jobsites
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.current_user_role() = 'admin'
);

create policy "Admins can create Jobsite assignments"
on public.user_jobsites
for insert
to authenticated
with check (private.current_user_role() = 'admin');

create policy "Admins can update Jobsite assignments"
on public.user_jobsites
for update
to authenticated
using (private.current_user_role() = 'admin')
with check (private.current_user_role() = 'admin');

create policy "Admins can delete Jobsite assignments"
on public.user_jobsites
for delete
to authenticated
using (private.current_user_role() = 'admin');

