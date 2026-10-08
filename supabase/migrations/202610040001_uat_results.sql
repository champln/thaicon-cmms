-- UAT results foundation. Deployment does NOT enable UAT.
-- Enable only on an approved isolated UAT database, never Production.
create table private.uat_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into private.uat_settings(singleton, enabled) values (true, false);
revoke all on private.uat_settings from public, anon, authenticated;

create function private.uat_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from private.uat_settings where singleton), false);
$$;
create function private.uat_site_access(site text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.uat_enabled()
    and private.current_user_role() is not null
    and private.can_access_jobsite(site)
    and exists (select 1 from public.jobsites where id = site and is_active);
$$;
revoke all on function private.uat_enabled() from public, anon, authenticated;
revoke all on function private.uat_site_access(text) from public, anon;
grant execute on function private.uat_site_access(text) to authenticated;

-- The application can report disabled distinctly from an empty result set.
create function public.uat_results_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.uat_enabled() and private.current_user_role() is not null;
$$;
revoke all on function public.uat_results_ready() from public, anon;
grant execute on function public.uat_results_ready() to authenticated;

-- Versioned allowlist; no client writes. Scenario content remains in source.
create table public.uat_scenarios (
  version text not null,
  id text not null,
  roles public.app_role[] not null,
  primary key(version, id)
);
insert into public.uat_scenarios(version,id,roles)
select '2026-10-04', id, array['admin','engineer','user']::public.app_role[]
from unnest(array['NAV-01','AUTH-01','AUTH-02','AUTH-03','UI-01','GUIDE-01','GUIDE-02','GUIDE-03']) as id;
insert into public.uat_scenarios(version,id,roles)
select '2026-10-04', id, array['admin']::public.app_role[]
from unnest(array['WO-01','WO-02','WO-03','WO-04','PM-01','PM-02','SR-04','RR-01','PDF-01','ALM-01','PM-03','SEC-01','SEC-02','SYNC-01','IOT-01','ASSET-01','LOC-01','HIST-01']) as id;
insert into public.uat_scenarios(version,id,roles)
select '2026-10-04', id, array['admin','engineer']::public.app_role[]
from unnest(array['SR-01','SR-02','SR-03','FILE-01']) as id;
insert into public.uat_scenarios values
  ('2026-10-04','ROLE-01',array['engineer']::public.app_role[]),
  ('2026-10-04','ROLE-02',array['user']::public.app_role[]);

create table public.uat_runs (
  id uuid primary key,
  jobsite_id text not null references public.jobsites(id) on delete restrict,
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  tester_role public.app_role not null default private.current_user_role(),
  scenario_version text not null check(scenario_version = '2026-10-04'),
  tester_name text not null check(length(btrim(tester_name)) between 1 and 120),
  release_label text not null check(length(btrim(release_label)) between 1 and 120),
  created_at timestamptz not null default clock_timestamp()
);
create index uat_runs_owner_site_idx on public.uat_runs(owner_id, jobsite_id, created_at, id);

create table public.uat_observations (
  id uuid primary key,
  run_id uuid not null references public.uat_runs(id) on delete restrict,
  event_no bigint generated always as identity unique,
  scenario_id text not null,
  result text not null check(result in ('PASS','FAIL','BLOCKED')),
  actual text not null check(length(btrim(actual)) between 1 and 4000),
  evidence text not null default '' check(length(evidence) <= 500),
  client_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid not null default auth.uid() references public.profiles(id) on delete restrict
);
create index uat_observations_run_event_idx on public.uat_observations(run_id, event_no);

alter table public.uat_scenarios enable row level security;
alter table public.uat_runs enable row level security;
alter table public.uat_observations enable row level security;
revoke all on public.uat_scenarios, public.uat_runs, public.uat_observations from public, anon, authenticated;
grant select on public.uat_scenarios, public.uat_runs, public.uat_observations to authenticated;
-- Attribution, server time and sequence cannot be supplied by clients.
grant insert(id, jobsite_id, scenario_version, tester_name, release_label) on public.uat_runs to authenticated;
grant insert(id, run_id, scenario_id, result, actual, evidence, client_at) on public.uat_observations to authenticated;
grant usage on sequence public.uat_observations_event_no_seq to authenticated;

create policy uat_catalog_read on public.uat_scenarios for select to authenticated
using (public.uat_results_ready());
create policy uat_run_read on public.uat_runs for select to authenticated
using (private.uat_site_access(jobsite_id) and (owner_id = auth.uid() or private.current_user_role() = 'admin'));
create policy uat_run_insert on public.uat_runs for insert to authenticated
with check (private.uat_site_access(jobsite_id) and owner_id = auth.uid() and tester_role = private.current_user_role());
create policy uat_observation_read on public.uat_observations for select to authenticated
using (exists(select 1 from public.uat_runs r where r.id = run_id));
create policy uat_observation_insert on public.uat_observations for insert to authenticated
with check (
  recorded_by = auth.uid() and exists (
    select 1 from public.uat_runs r join public.uat_scenarios s
      on s.version = r.scenario_version and s.id = scenario_id
    where r.id = run_id and r.owner_id = auth.uid()
      and r.tester_role = private.current_user_role()
      and r.tester_role = any(s.roles)
      and private.uat_site_access(r.jobsite_id)
  )
);
-- No UPDATE/DELETE grants or policies: corrections are new observations.
-- Disabling a profile/site or revoking assignment removes access via parent RLS.
-- Profiles/jobsites with UAT evidence cannot be hard-deleted; deactivate instead.
