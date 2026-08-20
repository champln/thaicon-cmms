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
