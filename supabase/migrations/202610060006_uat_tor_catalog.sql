-- New execution catalog; preserve every earlier observation and role allowlist.
insert into public.uat_scenarios(version,id,roles)
select '2026-10-06',id,roles from public.uat_scenarios where version='2026-10-04';
insert into public.uat_scenarios(version,id,roles) values
('2026-10-06','WO-05',array['admin','engineer']::public.app_role[]),
('2026-10-06','WO-06',array['admin']::public.app_role[]),
('2026-10-06','MAT-01',array['admin','engineer']::public.app_role[]),
('2026-10-06','MAT-02',array['admin','engineer']::public.app_role[]),
('2026-10-06','XLS-01',array['admin','engineer','user']::public.app_role[]),
('2026-10-06','SYNC-02',array['admin','engineer']::public.app_role[]);
alter table public.uat_runs drop constraint uat_runs_scenario_version_check;
alter table public.uat_runs add constraint uat_runs_scenario_version_check
check(scenario_version in ('2026-10-04','2026-10-06'));
