-- ThaiCon CMMS annual plan -> Service Report -> Actual workflow.
-- Actual is derived exclusively from approved Service Reports.

create type public.plan_status as enum ('draft', 'active', 'completed');
create type public.service_report_status as enum ('draft', 'submitted', 'approved', 'rejected');
create type public.service_result as enum ('normal', 'repair_required');
create type public.repair_status as enum ('draft', 'open', 'in_progress', 'resolved', 'cancelled');
create type public.repair_priority as enum ('low', 'normal', 'high', 'critical');

create table public.maintenance_plans (
  id text primary key,
  jobsite_id text not null references public.jobsites (id) on delete restrict,
  name text not null,
  service_type text not null,
  plan_year integer not null check (plan_year between 2020 and 2200),
  annual_target integer not null check (annual_target > 0),
  cycle_months integer not null check (cycle_months in (1, 2, 3)),
  start_month integer not null default 1 check (start_month between 1 and 12),
  status public.plan_status not null default 'draft',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_cycles (
  id text primary key,
  plan_id text not null references public.maintenance_plans (id) on delete cascade,
  sequence integer not null check (sequence > 0),
  label text not null,
  start_month integer not null check (start_month between 1 and 12),
  end_month integer not null check (end_month between 1 and 12),
  target integer not null check (target > 0),
  unique (plan_id, sequence)
);

create table public.service_reports (
  id text primary key,
  jobsite_id text not null references public.jobsites (id) on delete restrict,
  plan_id text not null references public.maintenance_plans (id) on delete restrict,
  cycle_id text not null references public.plan_cycles (id) on delete restrict,
  work_order_id text,
  asset_id text not null,
  asset_name text not null,
  service_date date not null,
  quantity integer not null default 1 check (quantity > 0),
  technician_name text not null,
  customer_name text not null,
  work_performed text not null,
  findings text not null,
  action_taken text not null,
  result public.service_result not null default 'normal',
  status public.service_report_status not null default 'draft',
  created_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_approval_consistency check (
    (status = 'approved' and approved_by is not null and approved_at is not null)
    or (status <> 'approved')
  )
);

create table public.service_report_attachments (
  id uuid primary key default gen_random_uuid(),
  service_report_id text not null references public.service_reports (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  file_size integer not null check (file_size > 0 and file_size <= 10000000),
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.repair_requests (
  id text primary key,
  jobsite_id text not null references public.jobsites (id) on delete restrict,
  service_report_id text references public.service_reports (id) on delete set null,
  asset_id text not null,
  asset_name text not null,
  requested_date date not null,
  title text not null,
  description text not null,
  priority public.repair_priority not null default 'normal',
  status public.repair_status not null default 'draft',
  reported_by text not null,
  resolution text not null default '',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index maintenance_plans_jobsite_year_idx on public.maintenance_plans (jobsite_id, plan_year);
create index service_reports_jobsite_date_idx on public.service_reports (jobsite_id, service_date desc);
create index service_reports_plan_status_idx on public.service_reports (plan_id, status);
create index repair_requests_jobsite_status_idx on public.repair_requests (jobsite_id, status);

create or replace function private.rebuild_plan_cycles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_count integer := 12 / new.cycle_months;
  base_target integer := new.annual_target / (12 / new.cycle_months);
  cycle_number integer;
  cycle_start integer;
  cycle_end integer;
  cycle_target integer;
  month_names text[] := array[
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
begin
  if tg_op = 'UPDATE' and exists (select 1 from public.service_reports where plan_id = new.id) then
    if new.cycle_months <> old.cycle_months or new.start_month <> old.start_month then
      raise exception 'Cannot change cycle schedule after Service Reports exist';
    end if;
    for cycle_number in 1..cycle_count loop
      cycle_target := case
        when cycle_number = cycle_count then new.annual_target - (base_target * (cycle_count - 1))
        else base_target
      end;
      update public.plan_cycles
      set target = cycle_target
      where plan_id = new.id and sequence = cycle_number;
    end loop;
    return new;
  end if;

  delete from public.plan_cycles where plan_id = new.id;
  for cycle_number in 1..cycle_count loop
    cycle_start := ((new.start_month - 1 + ((cycle_number - 1) * new.cycle_months)) % 12) + 1;
    cycle_end := ((cycle_start - 1 + new.cycle_months - 1) % 12) + 1;
    cycle_target := case
      when cycle_number = cycle_count then new.annual_target - (base_target * (cycle_count - 1))
      else base_target
    end;
    insert into public.plan_cycles (id, plan_id, sequence, label, start_month, end_month, target)
    values (
      new.id || '-C' || lpad(cycle_number::text, 2, '0'),
      new.id,
      cycle_number,
      case
        when new.cycle_months = 1 then month_names[cycle_start]
        else month_names[cycle_start] || ' - ' || month_names[cycle_end]
      end,
      cycle_start,
      cycle_end,
      cycle_target
    );
  end loop;
  return new;
end;
$$;

create trigger maintenance_plans_build_cycles
after insert or update of annual_target, cycle_months, start_month on public.maintenance_plans
for each row execute function private.rebuild_plan_cycles();

create or replace function private.can_manage_jobsite(target_jobsite_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.current_user_role() = 'admin'
    or exists (
      select 1 from public.user_jobsites uj
      where uj.user_id = auth.uid() and uj.jobsite_id = target_jobsite_id
    );
$$;

create or replace function public.validate_report_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.maintenance_plans p
    join public.plan_cycles c on c.plan_id = p.id
    where p.id = new.plan_id
      and p.jobsite_id = new.jobsite_id
      and c.id = new.cycle_id
  ) then
    raise exception 'Service Report plan, cycle, and Jobsite do not match';
  end if;
  return new;
end;
$$;

create trigger service_reports_validate_scope
before insert or update of jobsite_id, plan_id, cycle_id on public.service_reports
for each row execute function public.validate_report_scope();

create or replace function public.enforce_report_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('approved', 'rejected') and private.current_user_role() <> 'admin' then
    raise exception 'Only an admin can approve or reject a Service Report';
  end if;
  if new.status = 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
    new.rejection_reason := null;
  elsif new.status = 'rejected' then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end;
$$;

create trigger service_reports_enforce_approval
before insert or update of status on public.service_reports
for each row execute function public.enforce_report_approval();

create view public.plan_progress
with (security_invoker = true)
as
select
  p.id as plan_id,
  p.jobsite_id,
  p.plan_year,
  p.annual_target,
  coalesce(sum(sr.quantity) filter (where sr.status = 'approved'), 0)::integer as actual,
  greatest(p.annual_target - coalesce(sum(sr.quantity) filter (where sr.status = 'approved'), 0), 0)::integer as remaining,
  round((coalesce(sum(sr.quantity) filter (where sr.status = 'approved'), 0)::numeric / p.annual_target) * 100, 1) as progress_percent,
  count(sr.id) filter (where sr.status = 'submitted')::integer as pending_reports
from public.maintenance_plans p
left join public.service_reports sr on sr.plan_id = p.id
group by p.id;

alter table public.maintenance_plans enable row level security;
alter table public.plan_cycles enable row level security;
alter table public.service_reports enable row level security;
alter table public.service_report_attachments enable row level security;
alter table public.repair_requests enable row level security;

create policy "accessible users read plans" on public.maintenance_plans
for select using (private.can_access_jobsite(jobsite_id));
create policy "admins manage plans" on public.maintenance_plans
for all using (private.current_user_role() = 'admin') with check (private.current_user_role() = 'admin');

create policy "accessible users read cycles" on public.plan_cycles
for select using (exists (select 1 from public.maintenance_plans p where p.id = plan_id and private.can_access_jobsite(p.jobsite_id)));
create policy "admins manage cycles" on public.plan_cycles
for all using (private.current_user_role() = 'admin') with check (private.current_user_role() = 'admin');

create policy "accessible users read reports" on public.service_reports
for select using (private.can_access_jobsite(jobsite_id));
create policy "staff create reports" on public.service_reports
for insert with check (private.can_manage_jobsite(jobsite_id) and private.current_user_role() in ('admin', 'engineer'));
create policy "staff update reports" on public.service_reports
for update using (
  private.current_user_role() = 'admin'
  or (private.current_user_role() = 'engineer' and created_by = auth.uid() and status in ('draft', 'rejected'))
) with check (private.can_manage_jobsite(jobsite_id));
create policy "staff delete reports" on public.service_reports
for delete using (private.current_user_role() = 'admin' or (private.current_user_role() = 'engineer' and created_by = auth.uid() and status <> 'approved'));

create policy "accessible users read report attachments" on public.service_report_attachments
for select using (exists (select 1 from public.service_reports sr where sr.id = service_report_id and private.can_access_jobsite(sr.jobsite_id)));
create policy "staff manage report attachments" on public.service_report_attachments
for all using (private.current_user_role() = 'admin' or (private.current_user_role() = 'engineer' and uploaded_by = auth.uid()))
with check (private.current_user_role() in ('admin', 'engineer') and uploaded_by = auth.uid());

create policy "accessible users read repairs" on public.repair_requests
for select using (private.can_access_jobsite(jobsite_id));
create policy "staff create repairs" on public.repair_requests
for insert with check (private.can_manage_jobsite(jobsite_id) and private.current_user_role() in ('admin', 'engineer'));
create policy "staff update repairs" on public.repair_requests
for update using (private.current_user_role() = 'admin' or (private.current_user_role() = 'engineer' and created_by = auth.uid()))
with check (private.can_manage_jobsite(jobsite_id));
create policy "staff delete repairs" on public.repair_requests
for delete using (private.current_user_role() = 'admin' or (private.current_user_role() = 'engineer' and created_by = auth.uid()));

create or replace function public.touch_maintenance_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger maintenance_plans_touch before update on public.maintenance_plans for each row execute function public.touch_maintenance_updated_at();
create trigger service_reports_touch before update on public.service_reports for each row execute function public.touch_maintenance_updated_at();
create trigger repair_requests_touch before update on public.repair_requests for each row execute function public.touch_maintenance_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-report-photos', 'service-report-photos', false, 10000000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

revoke all on function private.can_manage_jobsite(text) from public;
grant execute on function private.can_manage_jobsite(text) to authenticated;

revoke all on public.maintenance_plans from anon;
revoke all on public.plan_cycles from anon;
revoke all on public.service_reports from anon;
revoke all on public.service_report_attachments from anon;
revoke all on public.repair_requests from anon;
grant select, insert, update, delete on public.maintenance_plans to authenticated;
grant select, insert, update, delete on public.plan_cycles to authenticated;
grant select, insert, update, delete on public.service_reports to authenticated;
grant select, insert, update, delete on public.service_report_attachments to authenticated;
grant select, insert, update, delete on public.repair_requests to authenticated;
grant select on public.plan_progress to authenticated;

create policy "accessible users read service report files"
on storage.objects for select to authenticated
using (bucket_id = 'service-report-photos' and private.can_access_jobsite((storage.foldername(name))[1]));

create policy "staff upload service report files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'service-report-photos'
  and private.current_user_role() in ('admin', 'engineer')
  and private.can_access_jobsite((storage.foldername(name))[1])
);

create policy "staff update own service report files"
on storage.objects for update to authenticated
using (bucket_id = 'service-report-photos' and owner_id = auth.uid()::text)
with check (bucket_id = 'service-report-photos' and owner_id = auth.uid()::text);

create policy "staff delete own service report files"
on storage.objects for delete to authenticated
using (bucket_id = 'service-report-photos' and (owner_id = auth.uid()::text or private.current_user_role() = 'admin'));
