alter table public.assets
 add column building text not null default '',
 add column floor text not null default '',
 add column room text not null default '',
 add column manufacturer text not null default '',
 add column model text not null default '',
 add column serial_number text not null default '',
 add constraint assets_metadata_length check (length(building)<=200 and length(floor)<=200 and length(room)<=200 and length(manufacturer)<=200 and length(model)<=200 and length(serial_number)<=200);
create index service_reports_asset_history_idx on public.service_reports (jobsite_id, asset_id, service_date desc);
create index repair_requests_asset_history_idx on public.repair_requests (jobsite_id, asset_id, requested_date desc);
