// Run only against the known disposable container; no network or secrets.
import { spawn, spawnSync } from 'node:child_process';
const container=process.env.TOR_DB_CONTAINER ?? 'thaicon-tor-check-20261006';
if(!/^thaicon-tor-check-[a-z0-9]+$/.test(container))throw Error('Invalid disposable container name');
const args=['exec','-i',container,'psql','-U','postgres','-d','thaicon_tor_check','-qAt','-v','ON_ERROR_STOP=1'];
const run=sql=>{const r=spawnSync('docker',args,{input:sql,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
const concurrent=sql=>new Promise((resolve,reject)=>{
  const p=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let output='',error='';
  p.stdout.on('data',s=>output+=s);p.stderr.on('data',s=>error+=s);
  p.on('error',reject);p.on('close',code=>resolve({code,output,error}));p.stdin.end(sql);
});
const actor='90000000-0000-4000-8000-000000000001';
if(run('select current_database()')!=='thaicon_tor_check')throw Error('Wrong database');
const identity=spawnSync('docker',['inspect',container,'--format','{{.Config.Labels.purpose}} {{.HostConfig.NetworkMode}}'],{encoding:'utf8'});
if(identity.status!==0||identity.stdout.trim()!=='thaicon-tor-disposable none')throw Error('Wrong container');
if(run("select count(*) from public.jobsites where id='SITE-990'")!=='0')throw Error('Fixture collision');
const previousGate=run('select enabled from private.work_order_settings where singleton');
const previousReportGate=run('select reviews_enabled from private.service_report_settings where singleton');
const previousDraftGate=run('select drafts_enabled from private.service_report_settings where singleton');
const previousRepairGate=run('select enabled from private.repair_settings where singleton');
let created=false;
try {
  run(`begin;
    insert into auth.users(id,email,raw_user_meta_data) values('${actor}','race@example.invalid','{"username":"tor_race_admin"}');
    update public.profiles set role='admin' where id='${actor}';
    insert into public.jobsites(id,name,province,site_type) values('SITE-990','Race test','Test','Test');
    insert into public.assets(id,jobsite_id,name,asset_type,location) values('RACE-AS','SITE-990','Test','AC','Test');
    insert into public.work_orders(id,jobsite_id,work_type,title,asset_id,due_label,created_by) values('RACE-WO','SITE-990','PM','Test','RACE-AS','Test','${actor}');
    insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by)
      values('RACE-PLAN','SITE-990','Race','PM',2026,12,1,'${actor}');
    insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,asset_id,asset_name,service_date,quantity,
      technician_name,customer_name,work_performed,findings,action_taken,status,created_by)
      select id,'SITE-990','RACE-PLAN','RACE-PLAN-C01','RACE-AS','Test','2026-10-06',2,
      'Tech','Customer','Clean','','','submitted','${actor}' from (values('RACE-SR-A'),('RACE-SR-B')) f(id);
    insert into storage.objects(id,bucket_id,name,owner_id)
      select gen_random_uuid(),'service-report-photos','SITE-990/'||id||'/proof.png','${actor}' from (values('RACE-SR-A'),('RACE-SR-B')) f(id);
    insert into public.service_report_attachments(service_report_id,storage_path,file_name,content_type,file_size,uploaded_by)
      select id,'SITE-990/'||id||'/proof.png','proof.png','image/png',100,'${actor}' from (values('RACE-SR-A'),('RACE-SR-B')) f(id);
    update private.service_report_settings set reviews_enabled=true;
    update private.work_order_settings set enabled=true;commit;`);
  created=true;
  const sql=(version,request,note)=>`begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${actor}',true);
    select public.apply_work_order_command('RACE-WO',${version},'${request}','note',null,'${note}');
    select pg_sleep(0.3);commit;`;
  const first=await Promise.all([
    concurrent(sql(1,'91000000-0000-4000-8000-000000000001','A')),
    concurrent(sql(1,'91000000-0000-4000-8000-000000000002','B')),
  ]);
  if(first.filter(r=>r.code===0).length!==1 || first.filter(r=>r.error.includes('version conflict')).length!==1)throw Error(JSON.stringify(first));
  if(run("select version from public.work_orders where id='RACE-WO'")!=='2')throw Error('Lost update');
  console.log('PASS: simultaneous different requests => one commit, one version conflict');
  const retry=await Promise.all([1,2].map(()=>concurrent(sql(2,'92000000-0000-4000-8000-000000000001','Same retry'))));
  if(retry.some(r=>r.code!==0)||retry.filter(r=>r.output.includes('"replayed": true')).length!==1)throw Error(JSON.stringify(retry));
  if(run("select version::text||':'||(select count(*) from public.work_order_events where work_order_id='RACE-WO') from public.work_orders where id='RACE-WO'")!=='3:2')throw Error('Duplicate retry effect');
  console.log('PASS: simultaneous same request => one event, one replay, one version increment');
  const review=(id,request)=>`begin;set local role authenticated;
    select set_config('request.jwt.claim.sub','${actor}',true);
    select public.apply_service_report_review('${id}',1,'${request}','approve');select pg_sleep(0.3);commit;`;
  const competing=await Promise.all([
    concurrent(review('RACE-SR-A','93000000-0000-4000-8000-000000000001')),
    concurrent(review('RACE-SR-A','93000000-0000-4000-8000-000000000002')),
  ]);
  if(competing.filter(r=>r.code===0).length!==1||competing.filter(r=>r.error.includes('version conflict')).length!==1)throw Error(JSON.stringify(competing));
  const same=await Promise.all([1,2].map(()=>concurrent(review('RACE-SR-B','94000000-0000-4000-8000-000000000001'))));
  if(same.some(r=>r.code!==0)||same.filter(r=>r.output.includes('"replayed": true')).length!==1)throw Error(JSON.stringify(same));
  if(run("select actual::text||':'||(select count(*) from public.service_report_events where service_report_id in ('RACE-SR-A','RACE-SR-B')) from public.plan_progress where plan_id='RACE-PLAN'")!=='4:2')throw Error('Approval duplicated Actual or audit');
  console.log('PASS: concurrent Service Report approval same/different requests => Actual exactly once per report');
  run(`insert into public.repair_requests(id,jobsite_id,service_report_id,asset_id,asset_name,requested_date,title,description,reported_by,created_by)
    values('RACE-RR','SITE-990','RACE-SR-A','RACE-AS','Test','2026-10-06','Noise','Inspect','Tech','${actor}');
    update private.service_report_settings set drafts_enabled=true;update private.repair_settings set enabled=true;`);
  const repair=(version,key,title)=>`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);
    select public.save_repair_command('RACE-RR','SITE-990',${version},'${key}',
    '{"asset_id":"RACE-AS","service_report_id":"RACE-SR-A","requested_date":"2026-10-06","title":"${title}","description":"Inspect","priority":"high","status":"resolved","reported_by":"Tech","resolution":"Fixed"}');select pg_sleep(0.3);commit;`;
  const repairRace=await Promise.all([concurrent(repair(1,'95000000-0000-4000-8000-000000000001','A')),concurrent(repair(1,'95000000-0000-4000-8000-000000000002','B'))]);
  if(repairRace.filter(r=>r.code===0).length!==1||repairRace.filter(r=>r.error.includes('version conflict')).length!==1)throw Error(JSON.stringify(repairRace));
  const repairRetry=await Promise.all([1,2].map(()=>concurrent(repair(2,'96000000-0000-4000-8000-000000000001','Same'))));
  if(repairRetry.some(r=>r.code!==0)||repairRetry.filter(r=>r.output.includes('"replayed": true')).length!==1)throw Error(JSON.stringify(repairRetry));
  if(run("select version::text||':'||(select count(*) from public.repair_events where repair_id='RACE-RR') from public.repair_requests where id='RACE-RR'")!=='3:2'||run("select actual from public.plan_progress where plan_id='RACE-PLAN'")!=='4')throw Error('Repair duplicate or changed Actual');
  console.log('PASS: concurrent repair different-key conflict/same-key replay; one version/event per commit; Actual unchanged');
} finally {
  if(created)run(`begin;delete from public.work_order_events where work_order_id='RACE-WO';
    alter table public.repair_events disable trigger repair_events_immutable;
    delete from public.repair_events where repair_id='RACE-RR';alter table public.repair_events enable trigger repair_events_immutable;
    delete from public.repair_requests where id='RACE-RR';
    update private.repair_settings set enabled=${previousRepairGate==='t'?'true':'false'};
    update private.service_report_settings set drafts_enabled=${previousDraftGate==='t'?'true':'false'};
    update private.service_report_settings set reviews_enabled=false;
    delete from storage.objects where name in ('SITE-990/RACE-SR-A/proof.png','SITE-990/RACE-SR-B/proof.png');
    delete from public.service_report_events where service_report_id in ('RACE-SR-A','RACE-SR-B');
    delete from public.service_reports where plan_id='RACE-PLAN';delete from public.maintenance_plans where id='RACE-PLAN';
    delete from public.work_orders where id='RACE-WO';delete from public.assets where id='RACE-AS';
    delete from public.jobsites where id='SITE-990';delete from auth.users where id='${actor}';
    update private.work_order_settings set enabled=${previousGate==='t'?'true':'false'};
    update private.service_report_settings set reviews_enabled=${previousReportGate==='t'?'true':'false'};commit;`);
  console.log('Temporary concurrency fixtures cleaned; gate restored');
}
