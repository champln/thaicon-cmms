-- Additive foundation only. Client writes deliberately remain disabled until
-- versioned commands and acceptance rules are implemented and verified.
begin;
create table public.maintenance_contracts (
 id uuid primary key default gen_random_uuid(),
 jobsite_id text not null references public.jobsites(id),
 name text not null check(length(btrim(name)) > 0),
 starts_on date not null, ends_on date not null,
 version integer not null default 1 check(version > 0),
 created_at timestamptz not null default now(),
 check(ends_on >= starts_on), unique(id,jobsite_id)
);
create table public.contract_asset_groups (
 id uuid primary key default gen_random_uuid(),
 contract_id uuid not null, jobsite_id text not null,
 name text not null check(length(btrim(name)) > 0),
 building text not null, asset_type text not null check(asset_type in ('AHU','FCU','SPT')),
 major_frequency integer not null check(major_frequency >= 0),
 minor_frequency integer not null check(minor_frequency >= 0),
 foreign key(contract_id,jobsite_id) references public.maintenance_contracts(id,jobsite_id),
 unique(id,contract_id,jobsite_id)
);
create table public.contract_month_targets (
 id uuid primary key default gen_random_uuid(),
 contract_id uuid not null, jobsite_id text not null, group_id uuid not null,
 month_start date not null check(extract(day from month_start)=1),
 cleaning_kind text not null check(cleaning_kind in ('major','minor')),
 target integer not null check(target >= 0),
 foreign key(group_id,contract_id,jobsite_id) references public.contract_asset_groups(id,contract_id,jobsite_id),
 unique(group_id,month_start,cleaning_kind)
);
-- No client grants on any new table until command/RLS integration tests pass.
alter table public.maintenance_contracts enable row level security;
alter table public.contract_asset_groups enable row level security;
alter table public.contract_month_targets enable row level security;
revoke all on public.maintenance_contracts, public.contract_asset_groups, public.contract_month_targets from public, anon, authenticated;
comment on table public.maintenance_contracts is 'Contract reporting foundation; not activated. Existing PM plans and historical Actual are untouched.';
commit;
