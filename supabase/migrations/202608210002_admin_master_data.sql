-- Admin master data: asset registry and hardened access rules.

create type public.asset_health as enum ('normal', 'watch', 'critical');

create table public.assets (
  id text primary key,
  jobsite_id text not null references public.jobsites (id) on delete restrict,
  name text not null,
  asset_type text not null,
  location text not null,
  health public.asset_health not null default 'normal',
  sensor_summary text not null default 'ยังไม่เชื่อมต่อ',
  last_pm date,
  next_pm date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_id_not_blank check (length(trim(id)) >= 3),
  constraint assets_pm_order check (last_pm is null or next_pm is null or next_pm >= last_pm)
);

create index assets_jobsite_active_idx on public.assets (jobsite_id, is_active);

create trigger assets_set_updated_at
before update on public.assets
for each row execute function private.set_updated_at();

alter table public.assets enable row level security;
revoke all on public.assets from anon;
grant select, insert, update, delete on public.assets to authenticated;

create policy "Authorized users can view assets"
on public.assets for select to authenticated
using (private.can_access_jobsite(jobsite_id));

create policy "Admins can create assets"
on public.assets for insert to authenticated
with check (private.current_user_role() = 'admin');

create policy "Admins can update assets"
on public.assets for update to authenticated
using (private.current_user_role() = 'admin')
with check (private.current_user_role() = 'admin');

create policy "Admins can delete assets"
on public.assets for delete to authenticated
using (private.current_user_role() = 'admin');

create view public.jobsite_asset_counts
with (security_invoker = true)
as
select jobsite_id, count(*) filter (where is_active)::integer as asset_count
from public.assets
group by jobsite_id;

grant select on public.jobsite_asset_counts to authenticated;
