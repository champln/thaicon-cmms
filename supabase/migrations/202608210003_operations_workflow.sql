-- Production operations data for Work Orders and Alarms.

alter table public.jobsites
add column pm_compliance numeric(5,2) not null default 0
check (pm_compliance between 0 and 100);

create type public.work_order_type as enum ('PM', 'CM', 'EM');
create type public.work_order_status as enum ('waiting', 'in_progress', 'review', 'completed');
create type public.work_order_priority as enum ('critical', 'high', 'normal', 'low');
create type public.alarm_level as enum ('critical', 'warning', 'info');

create table public.work_orders (
  id text primary key,
  jobsite_id text not null references public.jobsites (id) on delete restrict,
  work_type public.work_order_type not null,
  title text not null,
  asset_id text not null references public.assets (id) on delete restrict,
  priority public.work_order_priority not null default 'normal',
  status public.work_order_status not null default 'waiting',
  assignee text not null default 'ยังไม่มอบหมาย',
  due_label text not null,
  due_at timestamptz,
  progress integer not null default 0 check (progress between 0 and 100),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.alarms (
  id text primary key,
  jobsite_id text not null references public.jobsites (id) on delete restrict,
  asset_id text not null references public.assets (id) on delete restrict,
  level public.alarm_level not null,
  title text not null,
  detail text not null,
  occurred_at timestamptz not null default now(),
  display_time text not null default '',
  measured_value text not null default '',
  acknowledged boolean not null default false,
  acknowledged_by uuid references public.profiles (id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alarm_acknowledgement_consistency check (
    (acknowledged = false and acknowledged_by is null and acknowledged_at is null)
    or (acknowledged = true and acknowledged_by is not null and acknowledged_at is not null)
  )
);

create index work_orders_jobsite_status_idx on public.work_orders (jobsite_id, status, created_at desc);
create index alarms_jobsite_acknowledged_idx on public.alarms (jobsite_id, acknowledged, occurred_at desc);

create trigger work_orders_touch before update on public.work_orders
for each row execute function public.touch_maintenance_updated_at();
create trigger alarms_touch before update on public.alarms
for each row execute function public.touch_maintenance_updated_at();

create or replace function public.enforce_alarm_acknowledgement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.acknowledged = true and old.acknowledged = false then
    new.acknowledged_by := auth.uid();
    new.acknowledged_at := now();
  elsif new.acknowledged = false then
    new.acknowledged_by := null;
    new.acknowledged_at := null;
  end if;
  return new;
end;
$$;

create trigger alarms_enforce_acknowledgement
before update of acknowledged on public.alarms
for each row execute function public.enforce_alarm_acknowledgement();

alter table public.work_orders enable row level security;
alter table public.alarms enable row level security;
revoke all on public.work_orders from anon;
revoke all on public.alarms from anon;
grant select, insert, update, delete on public.work_orders to authenticated;
grant select, insert, update, delete on public.alarms to authenticated;

create policy "Authorized users can view Work Orders"
on public.work_orders for select to authenticated
using (private.can_access_jobsite(jobsite_id));
create policy "Staff can create Work Orders"
on public.work_orders for insert to authenticated
with check (private.can_manage_jobsite(jobsite_id) and private.current_user_role() in ('admin', 'engineer') and created_by = auth.uid());
create policy "Staff can update Work Orders"
on public.work_orders for update to authenticated
using (private.can_manage_jobsite(jobsite_id) and private.current_user_role() in ('admin', 'engineer'))
with check (private.can_manage_jobsite(jobsite_id));
create policy "Admins can delete Work Orders"
on public.work_orders for delete to authenticated
using (private.current_user_role() = 'admin');

create policy "Authorized users can view Alarms"
on public.alarms for select to authenticated
using (private.can_access_jobsite(jobsite_id));
create policy "Staff can create Alarms"
on public.alarms for insert to authenticated
with check (private.can_manage_jobsite(jobsite_id) and private.current_user_role() in ('admin', 'engineer'));
create policy "Staff can acknowledge Alarms"
on public.alarms for update to authenticated
using (private.can_manage_jobsite(jobsite_id) and private.current_user_role() in ('admin', 'engineer'))
with check (private.can_manage_jobsite(jobsite_id));
create policy "Admins can delete Alarms"
on public.alarms for delete to authenticated
using (private.current_user_role() = 'admin');
