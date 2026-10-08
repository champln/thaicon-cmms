// Deterministic actual-role plan/first-report races, only inside the disposable
// no-network SQL harness. No host ports, Production, or customer data.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
const container=process.env.TOR_DB_CONTAINER;
assert.match(container??'',/^thaicon-tor-check-[a-z0-9]+$/);
const identity=spawnSync('docker',['inspect',container,'--format','{{.Config.Labels.purpose}} {{.HostConfig.NetworkMode}}'],{encoding:'utf8'});
assert.equal(identity.stdout.trim(),'thaicon-tor-disposable none');
const args=['exec','-i',container,'psql','-U','postgres','-d','thaicon_tor_check','-qAt','-v','ON_ERROR_STOP=1'];
const run=sql=>{const r=spawnSync('docker',args,{input:sql,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await wait(50);}throw Error('Plan race barrier timeout');};
function session(sql,hold=false) {
 const p=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let output='',error='',closed=false;
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.stdout.on('data',s=>output+=s);p.stderr.on('data',s=>error+=s);p.on('close',code=>{closed=true;resolve({code,output,error});});});
 if(hold)p.stdin.write(sql);else p.stdin.end(sql);
 return {done,p,get output(){return output;},get closed(){return closed;}};
}
const admin='98000000-0000-4000-8000-000000000001',engineer='98000000-0000-4000-8000-000000000002';
const previous=run("select enabled::text||':'||(select reviews_enabled::text||':'||drafts_enabled::text from private.service_report_settings) from private.plan_settings;").split(':');
const previousAlarm=run('select enabled::text from private.alarm_settings;');
const data='{"name":"Race","service_type":"PM","plan_year":2026,"annual_target":12,"cycle_months":3,"start_month":1,"status":"active"}';
const auth=(id,name)=>`begin;set local application_name='${name}';set local role authenticated;select set_config('request.jwt.claim.sub','${id}',true);`;
const change=(plan,key,remove)=>`select public.apply_plan_command('${plan}','SITE-989',1,'${key}','${remove?'{}':data}',${remove});`;
const report=(plan)=>`insert into public.service_reports(id,jobsite_id,plan_id,cycle_id,asset_id,asset_name,service_date,technician_name,customer_name,work_performed,findings,action_taken,created_by)
 values('SR-${plan}','SITE-989','${plan}','${plan}-C12','RACE-PAS','AC','2026-10-06','Tech','Customer','PM','','',auth.uid());`;
try {
 run(`insert into auth.users(id,email,raw_user_meta_data) values('${admin}','planrace_admin@example.invalid','{"username":"planrace_admin"}'),('${engineer}','planrace_engineer@example.invalid','{"username":"planrace_engineer"}');
 update public.profiles set role='admin' where id='${admin}';update public.profiles set role='engineer' where id='${engineer}';
 insert into public.jobsites(id,name,province,site_type) values('SITE-989','Plan race','Test','Test');
 insert into public.user_jobsites values('${engineer}','SITE-989');
 insert into public.assets(id,jobsite_id,name,asset_type,location) values('RACE-PAS','SITE-989','AC','AC','Test');
 insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by)
 select 'RACE-PLAN-'||n,'SITE-989','Race','PM',2026,12,1,'${admin}'::uuid from generate_series(1,5)n;
 update private.plan_settings set enabled=true;update private.service_report_settings set reviews_enabled=false,drafts_enabled=false;`);
 for(const [index,reportFirst,remove] of [[1,true,false],[2,false,false],[3,true,true],[4,false,true]]) {
  const plan='RACE-PLAN-'+index,key=`98100000-0000-4000-8000-${String(index).padStart(12,'0')}`,name='plan_race_wait_'+index;
  const first=session(auth(reportFirst?engineer:admin,'plan_race_hold_'+index)+(reportFirst?report(plan):change(plan,key,remove))+"select 'BARRIER_READY';\n",true);
  let second;
  try{
   await until(()=>first.output.includes('BARRIER_READY')||first.closed);assert.equal(first.closed,false,first.output);
   second=session(auth(reportFirst?admin:engineer,name)+(reportFirst?change(plan,key,remove):report(plan))+'commit;');
   await until(()=>run(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock';`)==='1'||second.closed);
   assert.equal(second.closed,false,'Second operation must actually wait on the first parent lock');
   first.p.stdin.end('commit;\n');
   const a=await first.done,b=await second.done;assert.equal(a.code,0,a.error);assert.notEqual(b.code,0,'Second operation unexpectedly succeeded');
   assert.match(b.error,reportFirst?/Referenced plan\/cycle schedule is locked/:/plan, cycle, and Jobsite do not match|Report plan missing/);
   assert.equal(run(`select count(*) from public.service_reports where plan_id='${plan}';`),reportFirst?'1':'0');
   if(reportFirst)assert.equal(run(`select count(*) from public.plan_cycles where plan_id='${plan}';`),'12');
  } finally {if(!first.closed){first.p.stdin.end('rollback;\n');await first.done;}if(second&&!second.closed)await second.done;}
 }
 console.log('PASS: four deterministic Admin plan edit/delete vs owning Engineer first-report races; both lock orderings really block and then reject stale/dangling references');
 const plan='RACE-PLAN-5',save=(version,key)=>auth(admin,'plan_race_same')+`select public.apply_plan_command('${plan}','SITE-989',${version},'${key}','${data}');commit;`;
 const diff=await Promise.all([1,2].map(n=>session(save(1,`98200000-0000-4000-8000-${String(n).padStart(12,'0')}`)).done));
 assert.equal(diff.filter(r=>r.code===0).length,1);assert.equal(diff.filter(r=>r.error.includes('version conflict')).length,1);
 const same=await Promise.all([1,2].map(()=>session(save(2,'98300000-0000-4000-8000-000000000001')).done));
 assert.ok(same.every(r=>r.code===0));assert.equal(same.filter(r=>r.output.includes('"replayed": true')).length,1);
 assert.equal(run(`select version::text||':'||(select count(*) from public.plan_events where plan_id='${plan}') from public.maintenance_plans where id='${plan}';`),'3:2');
 console.log('PASS: concurrent plan different-key version conflict/same-key exact replay, one event/version per committed command');
 run("insert into public.alarms(id,jobsite_id,asset_id,level,title,detail,measured_value) values('RACE-AL-A','SITE-989','RACE-PAS','warning','Newest','Latest reading','31'),('RACE-AL-B','SITE-989','RACE-PAS','warning','Same retry','Latest reading','32');update private.alarm_settings set enabled=true;");
 const acknowledge=(id,actor,key)=>auth(actor,'alarm_race')+`select public.acknowledge_alarm_command('${id}','SITE-989','${key}');commit;`;
 const alarmDifferent=await Promise.all([session(acknowledge('RACE-AL-A',admin,'98400000-0000-4000-8000-000000000001')).done,session(acknowledge('RACE-AL-A',engineer,'98400000-0000-4000-8000-000000000002')).done]);
 assert.ok(alarmDifferent.every(r=>r.code===0));
 assert.equal(run("select version::text||':'||(select count(*) from public.alarm_events where alarm_id='RACE-AL-A' and changed) from public.alarms where id='RACE-AL-A';"),'2:1');
 const alarmSame=await Promise.all([1,2].map(()=>session(acknowledge('RACE-AL-B',engineer,'98500000-0000-4000-8000-000000000001')).done));
 assert.ok(alarmSame.every(r=>r.code===0));assert.equal(alarmSame.filter(r=>r.output.includes('"replayed": true')).length,1);
 assert.equal(run("select version::text||':'||(select count(*) from public.alarm_events where alarm_id='RACE-AL-B') from public.alarms where id='RACE-AL-B';"),'2:1');
 console.log('PASS: concurrent Alarm first acknowledgement changes once, same-key exact retry has one audit/version; different actors cannot overwrite original receipt');
} finally {
 run(`update private.plan_settings set enabled=${previous[0]};update private.service_report_settings set reviews_enabled=${previous[1]},drafts_enabled=${previous[2]};update private.alarm_settings set enabled=${previousAlarm};`);
 console.log('Plan gates restored; synthetic fixtures remain only in disposable database removed by outer harness');
}
