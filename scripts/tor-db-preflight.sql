-- Read-only diagnostics for the six-migration operational baseline.
-- Does not repair records. Counts only: no personal data, keys or file URLs.
-- Run on the approved test target first; inspect missing schema separately.
\set ON_ERROR_STOP on
begin transaction read only;
set local statement_timeout = '15s';
select 'work_order_asset_scope' as check_name, count(*) as issues
from public.work_orders w left join public.assets a on a.id=w.asset_id
where a.id is null or a.jobsite_id<>w.jobsite_id
union all
select 'alarm_asset_scope', count(*) from public.alarms r
left join public.assets a on a.id=r.asset_id where a.id is null or a.jobsite_id<>r.jobsite_id
union all
select 'report_asset_scope', count(*) from public.service_reports r
left join public.assets a on a.id=r.asset_id where a.id is null or a.jobsite_id<>r.jobsite_id
union all
select 'report_work_order_scope', count(*) from public.service_reports r
left join public.work_orders w on w.id=r.work_order_id
where r.work_order_id is not null and (w.id is null or w.jobsite_id<>r.jobsite_id or w.asset_id<>r.asset_id)
union all
select 'repair_asset_scope', count(*) from public.repair_requests r
left join public.assets a on a.id=r.asset_id where a.id is null or a.jobsite_id<>r.jobsite_id
union all
select 'repair_report_scope', count(*) from public.repair_requests r
left join public.service_reports s on s.id=r.service_report_id
where r.service_report_id is not null and (s.id is null or s.jobsite_id<>r.jobsite_id or s.asset_id<>r.asset_id)
union all
select 'due_date_needs_review', count(*) from public.work_orders where due_at is null
union all
select 'legacy_assignee_needs_review', count(*) from public.work_orders
where btrim(assignee) not in ('','ยังไม่มอบหมาย')
union all
select 'small_pm_target_needs_policy', count(*) from public.maintenance_plans
where annual_target < 12/cycle_months;
rollback;
