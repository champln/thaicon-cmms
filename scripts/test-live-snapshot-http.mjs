// Development evidence only: actual local JWT/Realtime/Storage, not customer UAT.
// Usage: node scripts/test-live-snapshot-http.mjs <isolated stack directory>
// No Production link, Git writes, saved credentials or deletion of historical data.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { syntheticPhoto } from "./synthetic-photo.mjs";
const target=path.resolve(process.argv[2]);
assert.match(await readFile(path.join(target,"supabase/config.toml"),"utf8"),/project_id = "thaicon-tor-local"/);
const status=spawnSync("npx.cmd",["--yes","supabase@2.119.0","status","--workdir",target,"--output","json"],{shell:true,encoding:"utf8"});
assert.equal(status.status,0);
const keys=JSON.parse(status.stdout);assert.equal(keys.API_URL,"http://127.0.0.1:55681");
const container="supabase_db_thaicon-tor-local";
assert.equal(spawnSync("docker",["inspect",container,"--format","{{.Name}}"],{encoding:"utf8"}).stdout.trim(),"/"+container);
function sql(input) {
  const r=spawnSync("docker",["exec","-i",container,"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-Atq"],{input,encoding:"utf8"});
  if(r.status!==0)throw Error("Isolated live snapshot SQL failed: "+r.stderr);
  return r.stdout.trim();
}
if(sql("select count(*) from supabase_migrations.schema_migrations where version='202610060014';")==="0") {
  const source=await readFile(new URL("../supabase/migrations/202610060014_scoped_live_snapshots.sql",import.meta.url),"utf8");
  sql("begin;"+source+"insert into supabase_migrations.schema_migrations(version,name,statements) values('202610060014','scoped_live_snapshots',array[]::text[]);notify pgrst,'reload schema';commit;");
}
// Compile the actual product modules in memory, no generated source files.
const dataModule=source=>"data:text/javascript;base64,"+Buffer.from(ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText).toString("base64");
const scoped=dataModule(await readFile(new URL("../src/scoped-updates.ts",import.meta.url),"utf8"));
const watcherSource=(await readFile(new URL("../src/maintenance-updates.ts",import.meta.url),"utf8")).replace('"./scoped-updates"',JSON.stringify(scoped));
const {watchMaintenanceUpdates,watchAlarmUpdates}=await import(dataModule(watcherSource));
const {readScopedLiveSnapshot}=await import(dataModule(await readFile(new URL("../src/live-snapshot-supabase.ts",import.meta.url),"utf8")));
const operator=createClient(keys.API_URL,keys.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const prior=JSON.parse(sql("select json_build_object('plan',(select enabled from private.plan_settings),'drafts',(select drafts_enabled from private.service_report_settings),'reviews',(select reviews_enabled from private.service_report_settings),'repair',(select enabled from private.repair_settings),'alarm',(select enabled from private.alarm_settings));"));
const suffix=randomUUID().slice(0,8),site="SITE-9800"+parseInt(suffix,16)+"1",other="SITE-9800"+parseInt(suffix,16)+"2",asset="LIVE-AS-"+suffix;
const accounts={},stops=[];let maintenance,alarms,maintenanceConnection,alarmConnection,eventCount=0,issuedPhotoUrl="";
const ok=(r,where)=>{if(r.error)throw Error(where+": "+r.error.code+" "+r.error.message);return r.data;};
async function waitFor(predicate,description,timeout=10000) {
  const start=Date.now();
  while(!predicate()){if(Date.now()-start>timeout)throw Error("Timed out: "+description);await new Promise(r=>setTimeout(r,50));}
}
try {
  for(const role of ["admin","engineer","user"]) {
    const email="live_"+role+"_"+suffix+"@example.invalid",password=randomUUID()+"Aa1!";
    const result=ok(await operator.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username:"live_"+role+"_"+suffix}}),"Auth fixture");
    const client=createClient(keys.API_URL,keys.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    ok(await client.auth.signInWithPassword({email,password}),"JWT login");
    accounts[role]={id:result.user.id,client};
  }
  sql(`update public.profiles set role='admin' where id='${accounts.admin.id}';update public.profiles set role='engineer' where id='${accounts.engineer.id}';
    insert into public.jobsites(id,name,province,site_type) values('${site}','Same name','Test','Test'),('${other}','Same name','Test','Test');
    insert into public.assets(id,jobsite_id,name,asset_type,location) values('${asset}','${site}','Live test','AC','Test');
    insert into public.user_jobsites values('${accounts.engineer.id}','${site}'),('${accounts.user.id}','${site}');
    update private.plan_settings set enabled=true;update private.service_report_settings set drafts_enabled=true,reviews_enabled=true;
    update private.repair_settings set enabled=true;update private.alarm_settings set enabled=true;`);
  const viewer=accounts.user.client,admin=accounts.admin.client,engineer=accounts.engineer.client;
  const scope={siteId:site,userId:accounts.user.id,role:"user"};
  const reader=(kind,prepare=async s=>s,context=scope)=>readScopedLiveSnapshot(viewer,context,kind,prepare,()=>{});
  // Track real Postgres hints separately: assertions cannot accidentally pass
  // merely because the 30-second fallback happened to run.
  const watched={channel(name) {
    const channel=viewer.channel(name),on=channel.on.bind(channel);
    channel.on=(kind,filter,cb)=>on(kind,filter,kind==="postgres_changes" ? payload=>{eventCount++;cb(payload);} : cb);
    return channel;
  },removeChannel:channel=>viewer.removeChannel(channel)};
  const failures=[];
  stops.push(watchMaintenanceUpdates(watched,site,scope.userId,{
    refresh:async()=>{maintenance=await reader("maintenance");},
    connection:s=>{maintenanceConnection=s;},failure:()=>failures.push("maintenance"),
  }));
  stops.push(watchAlarmUpdates(watched,site,scope.userId,{
    refresh:async()=>{alarms=await reader("alarms");},connection:s=>{alarmConnection=s;},failure:()=>failures.push("alarms"),
  }));
  await waitFor(()=>maintenanceConnection==="connected"&&alarmConnection==="connected"&&maintenance&&alarms,"actual Postgres readiness");
  const plan="PLAN-"+randomUUID(),deletedPlan="PLAN-"+randomUUID();
  const planData={name:"Live PM",service_type:"PM",plan_year:2026,annual_target:1,cycle_months:1,start_month:1,status:"active"};
  const create=async id=>ok(await admin.rpc("apply_plan_command",{p_plan_id:id,p_site_id:site,p_expected_version:0,p_request_id:randomUUID(),p_data:planData}),"Admin create");
  let before=eventCount;
  await create(plan);
  await waitFor(()=>eventCount>before&&maintenance.plans.some(p=>p.id===plan),"plan realtime before poll");
  assert.ok(eventCount>before);
  assert.equal(maintenance.cycles.filter(c=>c.plan_id===plan&&c.target===0).length,11);
  await create(deletedPlan);
  await waitFor(()=>maintenance.plans.some(p=>p.id===deletedPlan),"delete fixture observed");
  before=eventCount;
  ok(await admin.rpc("apply_plan_command",{p_plan_id:deletedPlan,p_site_id:site,p_expected_version:1,p_request_id:randomUUID(),p_data:{},p_delete:true}),"Admin delete");
  await waitFor(()=>eventCount>before&&maintenance.plan_tombstones.some(p=>p.id===deletedPlan&&p.version===2),"scoped positive deletion evidence");
  assert.ok(eventCount>before);assert.ok(!maintenance.plans.some(p=>p.id===deletedPlan));
  console.log("PASS: distinct Admin/User JWT sessions; actual ready plan/cycles/delete hints and authoritative tombstones before poll");
  const report="SR-"+randomUUID(),photo=randomUUID(),storagePath=site+"/"+report+"/"+photo;
  const reportData={plan_id:plan,cycle_id:plan+"-C01",asset_id:asset,work_order_id:null,service_date:"2026-10-06",quantity:3,
    technician_name:"Local Engineer",customer_name:"Local Customer",work_performed:"PM",findings:"Repair needed",action_taken:"Inspect",result:"repair_required",attachments:[]};
  ok(await engineer.rpc("save_service_report_command",{p_report_id:report,p_site_id:site,p_expected_version:0,p_request_id:randomUUID(),p_data:reportData,p_submit:false}),"Engineer draft");
  await waitFor(()=>maintenance.reports.some(r=>r.id===report&&r.version===1),"report creation hint");
  ok(await engineer.storage.from("service-report-photos").upload(storagePath,syntheticPhoto,{contentType:"image/png"}),"Engineer photo");
  reportData.attachments=[{id:photo,storage_path:storagePath,file_name:"Live.png",content_type:"image/png",file_size:syntheticPhoto.length}];
  before=eventCount;
  ok(await engineer.rpc("save_service_report_command",{p_report_id:report,p_site_id:site,p_expected_version:1,p_request_id:randomUUID(),p_data:reportData,p_submit:true}),"Engineer submit");
  await waitFor(()=>eventCount>before&&maintenance.reports.some(r=>r.id===report&&r.version===2&&r.status==="submitted")&&maintenance.attachments.some(a=>a.id===photo)&&maintenance.repairs.some(r=>r.service_report_id===report),"atomic parent/photo/source-repair snapshot");
  assert.ok(eventCount>before);
  const prepared=await reader("maintenance",async snapshot=>{
    const result=await viewer.storage.from("service-report-photos").createSignedUrl(storagePath,60);
    const url=ok(result,"Viewer scoped photo").signedUrl;
    issuedPhotoUrl=url;
    assert.equal((await fetch(url)).status,200);return snapshot;
  });
  assert.ok(prepared.attachments.some(a=>a.id===photo));
  ok(await admin.rpc("apply_service_report_review",{p_report_id:report,p_expected_version:2,p_request_id:randomUUID(),p_command:"approve",p_reason:null}),"Admin approval");
  await waitFor(()=>maintenance.reports.some(r=>r.id===report&&r.status==="approved"&&r.version===3),"approval hint");
  assert.equal(maintenance.reports.filter(r=>r.status==="approved").reduce((n,r)=>n+r.quantity,0),3);
  const repair=maintenance.repairs.find(r=>r.service_report_id===report);
  const repairData=Object.fromEntries(["asset_id","requested_date","title","description","priority","status","reported_by","resolution","service_report_id"].map(k=>[k,repair[k]]));
  repairData.status="resolved";repairData.resolution="Local repair resolved";
  ok(await engineer.rpc("save_repair_command",{p_repair_id:repair.id,p_site_id:site,p_expected_version:repair.version,p_request_id:randomUUID(),p_data:repairData}),"Engineer repair");
  await waitFor(()=>maintenance.repairs.some(r=>r.id===repair.id&&r.status==="resolved"),"repair hint");
  console.log("PASS: actual owning Engineer submit/photo, Admin approval/Actual=3 and linked repair update reach independent User");
  const alarm="LIVE-AL-"+suffix;
  sql(`insert into public.alarms(id,jobsite_id,asset_id,level,title,detail,measured_value) values('${alarm}','${site}','${asset}','warning','Live alarm','New','31');`);
  await waitFor(()=>alarms.alarms.some(a=>a.id===alarm),"Alarm insert hint");
  sql(`update public.alarms set measured_value='33',detail='Latest owner measurement' where id='${alarm}';`);
  await waitFor(()=>alarms.alarms.some(a=>a.id===alarm&&a.measured_value==="33"),"Alarm measurement hint");
  ok(await engineer.rpc("acknowledge_alarm_command",{p_alarm_id:alarm,p_site_id:site,p_request_id:randomUUID()}),"Engineer acknowledgement");
  await waitFor(()=>alarms.alarms.some(a=>a.id===alarm&&a.acknowledged_by===accounts.engineer.id&&a.measured_value==="33"),"Alarm acknowledgement hint");
  assert.equal((await viewer.rpc("acknowledge_alarm_command",{p_alarm_id:alarm,p_site_id:site,p_request_id:randomUUID()})).error?.code,"42501");
  assert.equal((await viewer.rpc("read_live_snapshot",{p_site_id:other,p_kind:"maintenance"})).error?.code,"42501");
  console.log("PASS: scoped Alarm ingestion/measurement/acknowledgement; actual User write and same-name foreign-site read denied");
  viewer.realtime.disconnect();
  ok(await admin.rpc("apply_plan_command",{p_plan_id:plan,p_site_id:site,p_expected_version:1,p_request_id:randomUUID(),p_data:{...planData,name:"Missed during disconnect"}}),"Disconnected update");
  viewer.realtime.connect();
  await waitFor(()=>maintenance.plans.some(p=>p.id===plan&&p.version===2),"reconnect catches missed update");
  // Failure/recovery uses the product read boundary with a real JWT underneath.
  let fail=true;
  const flaky={rpc:(name,args)=>fail ? Promise.resolve({data:null,error:{code:"503"}}) : viewer.rpc(name,args)};
  await assert.rejects(()=>readScopedLiveSnapshot(flaky,scope,"maintenance",async s=>s,()=>{}),e=>e.kind==="failed");
  fail=false;assert.ok((await readScopedLiveSnapshot(flaky,scope,"maintenance",async s=>s,()=>{})).plans.some(p=>p.id===plan));
  assert.equal(failures.length,0,"Unexpected watcher refresh failure before negative tests");
  // Downgrade Admin to User with the same identity AND a retained authorized
  // site: this must be detected even though the role may still read this site.
  sql(`insert into public.user_jobsites values('${accounts.admin.id}','${site}');`);
  await assert.rejects(()=>readScopedLiveSnapshot(admin,{siteId:site,userId:accounts.admin.id,role:"admin"},"maintenance",async snapshot=>{
    sql(`update public.profiles set role='user' where id='${accounts.admin.id}';`);return snapshot;
  },()=>{}),e=>e.kind==="denied");
  sql(`update public.profiles set role='admin' where id='${accounts.admin.id}';`);
  // Real DB role change while preparation is pending; same actor/site remain.
  await assert.rejects(()=>reader("maintenance",async snapshot=>{
    sql(`update public.profiles set role='engineer' where id='${accounts.user.id}';`);return snapshot;
  }),e=>e.kind==="denied");
  sql(`update public.profiles set role='user' where id='${accounts.user.id}';`);
  await assert.rejects(()=>reader("maintenance",async snapshot=>{
    sql(`delete from public.user_jobsites where user_id='${accounts.user.id}' and jobsite_id='${site}';`);return snapshot;
  }),e=>e.kind==="denied");
  assert.ok((await viewer.storage.from("service-report-photos").createSignedUrl(storagePath,60)).error,
    "Fresh signing must be denied after assignment revocation");
  assert.equal((await fetch(issuedPhotoUrl)).status,200,
    "Previously issued signed capability remains usable within its 60-second fixture TTL");
  console.log("LIMIT: new signing/snapshot denied after revoke, but an already-issued signed photo URL remains usable until TTL; product signer currently requests 3600s, not immediate URL revocation");
  sql(`insert into public.user_jobsites values('${accounts.user.id}','${site}');update public.profiles set is_active=false where id='${accounts.user.id}';`);
  await assert.rejects(()=>reader("alarms"),e=>e.kind==="denied");
  sql(`update public.profiles set is_active=true where id='${accounts.user.id}';`);
  sql("update private.alarm_settings set enabled=false;");
  assert.equal(ok(await viewer.rpc("live_snapshot_access",{p_site_id:site,p_kind:"alarms"}),"Active OFF access"),false);
  await assert.rejects(()=>reader("alarms"),e=>e.kind==="denied");
  console.log("PASS: reconnect/read failure recovery; actual role change during preparation, revoked assignment, inactive account, gate OFF all fail closed");
} finally {
  for(const stop of stops)stop();
  for(const a of Object.values(accounts)){await a.client.auth.signOut();a.client.realtime.disconnect();}
  operator.realtime.disconnect();
  sql(`update private.plan_settings set enabled=${prior.plan};update private.service_report_settings set drafts_enabled=${prior.drafts},reviews_enabled=${prior.reviews};update private.repair_settings set enabled=${prior.repair};update private.alarm_settings set enabled=${prior.alarm};`);
  console.log("Isolated gates restored; synthetic accounts/rows retained for evidence, no customer records deleted");
}
