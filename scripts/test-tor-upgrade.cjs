const { spawnSync } = require('node:child_process');
const { readFileSync, readdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const repo=path.resolve(__dirname,'..');
const container='thaicon-tor-upgrade-'+randomUUID().slice(0,8);
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||r.error?.message||'Docker failed');return r.stdout.trim();}
const sql=input=>docker(['exec','-i',container,'psql','-U','postgres','-d','thaicon_tor_check','-v','ON_ERROR_STOP=1','-Atq'],input);
(async()=>{let created=false;try{
  docker(['image','inspect','postgres:16-alpine']);
  docker(['run','--rm','-d','--name',container,'--network','none','--label','purpose=thaicon-tor-upgrade','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=thaicon_tor_check','postgres:16-alpine']);created=true;
  for(let n=0;n<50;n++){if(spawnSync('docker',['exec',container,'pg_isready','-U','postgres'],{encoding:'utf8'}).status===0)break;if(n===49)throw Error('DB not ready');await new Promise(r=>setTimeout(r,200));}
  sql(readFileSync(path.join(repo,'scripts/tor-db-bootstrap.sql'),'utf8'));
  const migrations=readdirSync(path.join(repo,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
  const baseline=migrations.filter(x=>x<'20261001');if(baseline.length!==6)throw Error('Expected six historical migrations');
  for(const file of baseline)sql(readFileSync(path.join(repo,'supabase/migrations',file),'utf8'));
  sql(`insert into auth.users values('99999999-0000-4000-8000-000000000009','review-upgrade@example.invalid','{"username":"review_upgrade"}');
    update public.profiles set role='admin' where username='review_upgrade';
    select set_config('request.jwt.claim.sub','99999999-0000-4000-8000-000000000009',false);
    insert into public.jobsites(id,name,province,site_type) values('SITE-991','A','Test','Test'),('SITE-992','B','Test','Test');
    insert into public.assets(id,jobsite_id,name,asset_type,location) values('LEG-A','SITE-991','A','AC','Test'),('LEG-B','SITE-992','B','AC','Test');
    insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by) values('LEG-PLAN','SITE-991','Historical plan','PM',2026,12,1,auth.uid());
    insert into public.work_orders(id,jobsite_id,work_type,title,asset_id,due_label,assignee,status,progress,created_by) values
      ('LEG-WO','SITE-991','PM','Historical order','LEG-A','Unknown historical date','Unmapped historical person','completed',100,auth.uid()),
      ('LEG-BAD','SITE-991','PM','Historical mismatch','LEG-B','Unknown','Unmapped legacy person','waiting',0,auth.uid());
    insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,work_order_id,asset_id,asset_name,service_date,quantity,technician_name,customer_name,work_performed,findings,action_taken,status,created_by)
      values('LEG-SR','SITE-991','LEG-PLAN','LEG-PLAN-C01','LEG-WO','LEG-A','A','2026-01-04',7,'Historical tech','Customer','PM','Normal','None','approved',auth.uid());
    insert into public.repair_requests(id,jobsite_id,service_report_id,asset_id,asset_name,requested_date,title,description,priority,status,reported_by,resolution,created_by)
      values('LEG-RR','SITE-991','LEG-SR','LEG-A','Historical asset label','2026-01-04','Historical repair','Historical detail','normal','resolved','Historical reporter','Historical resolution',auth.uid());
    create table public.review_before(entity text,id text,snapshot jsonb);
    insert into public.alarms(id,jobsite_id,asset_id,level,title,detail,measured_value,acknowledged,acknowledged_by,acknowledged_at) values
      ('LEG-AL-A','SITE-991','LEG-A','warning','Historical alarm','Historical reading','31',false,null,null),
      ('LEG-AL-B','SITE-991','LEG-A','info','Historical acknowledged alarm','Historical acknowledged reading','30',true,auth.uid(),'2026-01-04T00:00:00Z');
    insert into public.review_before select 'alarm',id,to_jsonb(a) from public.alarms a;
    insert into public.review_before select 'work',id,to_jsonb(w) from public.work_orders w;
    insert into public.review_before select 'report',id,to_jsonb(r) from public.service_reports r;
    insert into public.review_before select 'plan',id,to_jsonb(p) from public.maintenance_plans p;
    insert into public.review_before select 'cycle',id,to_jsonb(c) from public.plan_cycles c;
    insert into public.review_before select 'repair',id,to_jsonb(r) from public.repair_requests r;
    create table public.review_existing_publication_member(id integer primary key);
    create publication supabase_realtime for table public.review_existing_publication_member;`);
  for(const file of migrations.filter(x=>!baseline.includes(x)))sql(readFileSync(path.join(repo,'supabase/migrations',file),'utf8'));
  sql(`do $$begin
    assert exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='review_existing_publication_member'), 'Pre-existing publication member removed';
    assert (select count(*) from public.work_orders)=2;
    assert (select count(*) from public.service_reports)=1;
    assert not exists(select 1 from public.review_before b join public.work_orders w on b.entity='work' and b.id=w.id where not(to_jsonb(w) @> b.snapshot)), 'Historical WO fields changed';
    assert not exists(select 1 from public.review_before b join public.service_reports r on b.entity='report' and b.id=r.id where not(to_jsonb(r) @> b.snapshot)), 'Historical report fields changed';
    assert not exists(select 1 from public.review_before b join public.maintenance_plans p on b.entity='plan' and b.id=p.id where not(to_jsonb(p) @> b.snapshot)), 'Historical plan fields changed';
    assert not exists(select 1 from public.review_before b left join public.plan_cycles c on b.id=c.id where b.entity='cycle' and (c.id is null or not(to_jsonb(c) @> b.snapshot))), 'Historical cycle fields changed';
    assert not exists(select 1 from public.review_before b left join public.repair_requests r on b.id=r.id where b.entity='repair' and (r.id is null or not(to_jsonb(r) @> b.snapshot))), 'Historical repair fields changed';
    assert not exists(select 1 from public.review_before b left join public.alarms a on b.id=a.id where b.entity='alarm' and (a.id is null or not(to_jsonb(a) @> b.snapshot))), 'Historical alarm fields changed';
    assert (select sum(quantity) from public.service_reports where status='approved')=7;
    assert (select count(*) from public.work_orders where assignee_id is null)=2;
    assert (select count(*) from public.work_order_events)=0;
    assert (select count(*) from public.service_report_events)=0;
    assert not (select enabled from private.work_order_settings);
    assert not (select reviews_enabled from private.service_report_settings);
    assert not (select drafts_enabled from private.service_report_settings);
    if to_regclass('private.repair_settings') is not null then
      assert not (select enabled from private.repair_settings);
      assert (select count(*) from public.repair_events)=0;
    end if;
    if to_regclass('private.plan_settings') is not null then
      assert not (select enabled from private.plan_settings);
      assert (select count(*) from public.plan_events)=0;
      assert (select version from public.maintenance_plans where id='LEG-PLAN')=1;
    end if;
    if to_regclass('private.alarm_settings') is not null then
      assert not (select enabled from private.alarm_settings);
      assert (select count(*) from public.alarm_events)=0;
      assert (select count(*) from public.alarms where version=1)=2;
    end if;
    assert (select count(*) from pg_constraint where conname in('work_orders_asset_same_site_fk','alarms_asset_same_site_fk','reports_asset_same_site_fk','reports_order_same_asset_fk','repairs_asset_same_site_fk','repairs_report_same_asset_fk') and not convalidated)=6;
    begin
      insert into public.work_orders(id,jobsite_id,work_type,title,asset_id,due_label,created_by) values('NEW-BAD','SITE-991','PM','New mismatch','LEG-B','Test','99999999-0000-4000-8000-000000000009');
      raise exception 'Expected FK rejection for NEW mismatch';
    exception when foreign_key_violation then null;end;
    begin
      alter table public.work_orders validate constraint work_orders_asset_same_site_fk;
      raise exception 'Legacy mismatch must require manual validation';
    exception when foreign_key_violation then null;end;
  end $$;`);
  console.log('PASS: actual six-migration populated baseline upgraded through '+migrations.length+' migrations; all old WO/report/plan/cycle/repair fields and approved Actual=7 preserved; legacy mismatch retained for manual validation; new mismatch rejected; no invented assignees/events; gates stay OFF');
  if(migrations.some(f=>f.includes('repair_commands'))) {
    sql(`begin;
      select set_config('request.jwt.claim.sub','99999999-0000-4000-8000-000000000009',false);
      set local role authenticated;
      update public.repair_requests set title='Legacy client explicit edit' where id='LEG-RR';
      do $$begin
        assert (select version from public.repair_requests where id='LEG-RR')=2, 'Legacy repair write must advance server version';
        begin update public.repair_requests set version=99 where id='LEG-RR';
        exception when insufficient_privilege or invalid_parameter_value then null;end;
        assert (select version from public.repair_requests where id='LEG-RR')=2, 'Client must not forge or rewind repair version';
      end $$;
      rollback;`);
    console.log('PASS: gate-OFF authenticated legacy repair update advances version; caller cannot forge version');
  }
}finally{if(created){if(docker(['inspect',container,'--format','{{.Config.Labels.purpose}} {{.HostConfig.NetworkMode}}'])!=='thaicon-tor-upgrade none')throw Error('Cleanup identity mismatch');docker(['rm','-f',container]);console.log('Populated-baseline upgrade test database removed');}}})().catch(e=>{console.error(e.message);process.exitCode=1;});
