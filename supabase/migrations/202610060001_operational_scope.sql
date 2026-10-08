-- Pending TOR integrity foundation. Apply only after target approval/preflight.
-- NOT VALID deliberately preserves pre-existing inconsistencies for review;
-- constraints enforce NEW/changed relationships immediately. Validate them in
-- a later approved migration after operator-led reconciliation, never auto-delete.
-- Lock/index cost must be measured on production-sized staging data first.
alter table public.assets add constraint assets_site_id_unique unique(jobsite_id,id);
alter table public.work_orders add constraint work_orders_site_asset_id_unique unique(jobsite_id,asset_id,id);
alter table public.service_reports add constraint reports_site_asset_id_unique unique(jobsite_id,asset_id,id);

alter table public.work_orders add constraint work_orders_asset_same_site_fk
  foreign key(jobsite_id,asset_id) references public.assets(jobsite_id,id) on delete restrict not valid;
alter table public.alarms add constraint alarms_asset_same_site_fk
  foreign key(jobsite_id,asset_id) references public.assets(jobsite_id,id) on delete restrict not valid;
alter table public.service_reports add constraint reports_asset_same_site_fk
  foreign key(jobsite_id,asset_id) references public.assets(jobsite_id,id) on delete restrict not valid;
alter table public.service_reports add constraint reports_order_same_asset_fk
  foreign key(jobsite_id,asset_id,work_order_id) references public.work_orders(jobsite_id,asset_id,id) on delete restrict not valid;
alter table public.repair_requests add constraint repairs_asset_same_site_fk
  foreign key(jobsite_id,asset_id) references public.assets(jobsite_id,id) on delete restrict not valid;
alter table public.repair_requests add constraint repairs_report_same_asset_fk
  foreign key(jobsite_id,asset_id,service_report_id) references public.service_reports(jobsite_id,asset_id,id) on delete restrict not valid;

create index work_orders_site_asset_idx on public.work_orders(jobsite_id,asset_id);
create index alarms_site_asset_idx on public.alarms(jobsite_id,asset_id);
create index reports_order_scope_idx on public.service_reports(jobsite_id,asset_id,work_order_id);
create index repairs_report_scope_idx on public.repair_requests(jobsite_id,asset_id,service_report_id);
