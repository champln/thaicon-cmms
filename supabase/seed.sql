insert into public.jobsites (id, name, province, site_type)
values
  ('SITE-001', 'โรงพยาบาลกลาง', 'กรุงเทพมหานคร', 'โรงพยาบาล'),
  ('SITE-002', 'โรงพยาบาลนพรัตนราชธานี', 'กรุงเทพมหานคร', 'โรงพยาบาล'),
  ('SITE-003', 'โรงพยาบาลสิรินธร', 'กรุงเทพมหานคร', 'โรงพยาบาล'),
  ('SITE-004', 'มหาวิทยาลัยธรรมศาสตร์', 'ปทุมธานี', 'มหาวิทยาลัย'),
  ('SITE-005', 'โรงพยาบาลพญาไท 2', 'กรุงเทพมหานคร', 'โรงพยาบาล'),
  ('SITE-006', 'โรงพยาบาลพญาไท 3', 'กรุงเทพมหานคร', 'โรงพยาบาล')
on conflict (id) do update
set
  name = excluded.name,
  province = excluded.province,
  site_type = excluded.site_type,
  is_active = true;

-- Create authentication users through Supabase Auth first. The trigger creates
-- a profile with role=user. Promote roles and assign Jobsites only after the
-- generated auth UUIDs are known; never store demo passwords in SQL migrations.

insert into public.assets (id, jobsite_id, name, asset_type, location, health, sensor_summary, last_pm, next_pm)
values
  ('AHU-OPD-01', 'SITE-002', 'Air Handling Unit — OPD', 'AHU', 'อาคารผู้ป่วยนอก • ชั้น 2', 'watch', 'Online • 24.8°C', '2026-06-28', '2026-07-30'),
  ('CR-DP-02', 'SITE-001', 'Clean Room Differential Pressure', 'Clean Room', 'ห้องผ่าตัด • OR 2', 'critical', 'Online • 7.2 Pa', '2026-07-15', '2026-07-28'),
  ('FREEZER-PH-03', 'SITE-003', 'ตู้แช่ยา Pharmacy 03', 'Medical Freezer', 'ห้องยา • ชั้น 1', 'normal', 'Online • 3.8°C', '2026-07-08', '2026-08-08'),
  ('AHU-ICU-04', 'SITE-005', 'Air Handling Unit — ICU', 'AHU', 'อาคาร B • ชั้น 7', 'normal', 'Online • 23.1°C', '2026-07-22', '2026-08-22'),
  ('CTRL-LAB-05', 'SITE-004', 'Laboratory Control Panel', 'Control Panel', 'อาคารปฏิบัติการ • ชั้น 4', 'watch', 'Online • 41% load', '2026-07-01', '2026-08-01'),
  ('EXF-ER-06', 'SITE-006', 'Emergency Exhaust Fan', 'Exhaust', 'ห้องฉุกเฉิน • หลังอาคาร', 'normal', 'Online • Running', '2026-07-18', '2026-10-18')
on conflict (id) do update set
  jobsite_id = excluded.jobsite_id,
  name = excluded.name,
  asset_type = excluded.asset_type,
  location = excluded.location,
  health = excluded.health,
  sensor_summary = excluded.sensor_summary,
  last_pm = excluded.last_pm,
  next_pm = excluded.next_pm,
  is_active = true;
