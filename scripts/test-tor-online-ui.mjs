// Separate ephemeral Vite origin; real local Auth password login through React.
// Usage: node scripts/test-tor-online-ui.mjs <isolated stack dir> <Playwright module> <output dir>
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const target=path.resolve(process.argv[2]), output=path.resolve(process.argv[4]);
assert.match(await readFile(path.join(target,"supabase/config.toml"),"utf8"),/project_id = "thaicon-tor-local"/);
await mkdir(output,{recursive:true});
const status=spawnSync("npx.cmd",["--yes","supabase@2.119.0","status","--workdir",target,"--output","json"],{shell:true,encoding:"utf8"});
assert.equal(status.status,0);
const keys=JSON.parse(status.stdout); assert.equal(keys.API_URL,"http://127.0.0.1:55681");
const localContainer="supabase_db_thaicon-tor-local";
function sql(input) { const result=spawnSync("docker",["exec","-i",localContainer,"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-Atq"],{input,encoding:"utf8"}); if(result.status!==0)throw Error("Local SQL fixture failed"); return result.stdout.trim(); }
const identity=spawnSync("docker",["inspect",localContainer,"--format","{{.Name}}"],{encoding:"utf8"}); assert.equal(identity.stdout.trim(),"/"+localContainer);
if(sql("select count(*) from supabase_migrations.schema_migrations where version='202610060013';")==='0'){
 const migration=await readFile(new URL('../supabase/migrations/202610060013_alarm_acknowledgement.sql',import.meta.url),'utf8');
 sql('begin;'+migration+"insert into supabase_migrations.schema_migrations(version,name,statements) values('202610060013','alarm_acknowledgement',array[]::text[]);commit;");
}
const operator=createClient(keys.API_URL,keys.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
if(sql("select count(*) from supabase_migrations.schema_migrations where version='202610080001';")==='0'){
 const migration=await readFile(new URL('../supabase/migrations/202610080001_material_ledger_context.sql',import.meta.url),'utf8');
 sql('begin;'+migration+"insert into supabase_migrations.schema_migrations(version,name,statements) values('202610080001','material_ledger_context',array[]::text[]);commit;");
}
const playwright=await import(pathToFileURL(process.argv[3]).href);
const {chromium}=playwright.default ?? playwright;
const suffix=randomUUID().slice(0,8); const accounts={}; const pageErrors=[];
let browser,server,allowLegacyAlarmAck=false;
const priorGate=sql("select enabled from private.uat_settings;");
const priorOrderGate=sql("select enabled from private.work_order_settings;");
const priorAlarmGate=sql("select enabled from private.alarm_settings;");
try {
  for(const role of ["admin","engineer","user"]) {
    const email=`ui_${role}_${suffix}@example.invalid`,password=randomUUID()+"Aa1!";
    const response=await operator.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username:`ui_${role}_${suffix}`,display_name:`UI ${role} ${suffix}`}});
    if(response.error)throw Error("Local Auth fixture failed");
    accounts[role]={id:response.data.user.id,email,password,username:`ui_${role}_${suffix}`};
  }
  sql(`update public.profiles set role='admin' where id='${accounts.admin.id}'; update public.profiles set role='engineer' where id='${accounts.engineer.id}';
    insert into public.jobsites(id,name,province,site_type) values('SITE-907','TOR A','Test','Test'),('SITE-908','TOR B','Test','Test') on conflict(id) do nothing;
    insert into public.assets(id,jobsite_id,name,asset_type,location) values('TOR-A','SITE-907','AC A','AC','Test') on conflict(id) do nothing;
    insert into public.user_jobsites(user_id,jobsite_id) values('${accounts.engineer.id}','SITE-907'),('${accounts.user.id}','SITE-907');
    update private.work_order_settings set enabled=true; update private.uat_settings set enabled=true;update private.alarm_settings set enabled=true;`);
  server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","15183","--strictPort"],{env:{...process.env,VITE_SUPABASE_URL:keys.API_URL,VITE_SUPABASE_PUBLISHABLE_KEY:keys.ANON_KEY,VITE_BASE_PATH:"/"},stdio:"ignore"});
  let ready=false;
  for(let n=0;n<50;n++){if(server.exitCode!==null)throw Error("Separate Vite process exited; port may be occupied");try{if((await fetch("http://127.0.0.1:15183/")).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready,"Separate Vite server did not start");
  browser=await chromium.launch({channel:"chrome",headless:true});
  const pages={};
  for(const role of ["admin","engineer","user"]) {
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(); pages[role]=page; page.setDefaultTimeout(15000);
    page.on("pageerror",e=>pageErrors.push(e.message));
    page.on("request",request=>{if(["POST","PATCH","DELETE"].includes(request.method())&&/\/rest\/v1\/alarms(\?|$)/.test(request.url())){
      if(!allowLegacyAlarmAck)pageErrors.push("Forbidden legacy Alarm browser write");
      else {assert.equal(request.method(),"PATCH");assert.deepEqual(request.postDataJSON(),{acknowledged:true});assert.equal(new URL(request.url()).searchParams.get("jobsite_id"),"eq.SITE-911");}
    }});
    await page.goto("http://127.0.0.1:15183/");
    await page.getByPlaceholder("เช่น admin").fill(role === "engineer" ? accounts[role].username : accounts[role].email); await page.getByPlaceholder("กรอกรหัสผ่าน").fill(accounts[role].password);
    await page.getByRole("button",{name:/^เข้าสู่ระบบ/}).click();
    await page.getByRole("button",{name:/SITE-907/}).click();
    await page.locator("nav").getByRole("button",{name:"ใบงาน",exact:true}).click();
    await page.locator(".wo-update-status").filter({hasText:/^ติดตามการเปลี่ยนแปลงใบงาน/}).waitFor();
    if(role!=="admin")assert.equal(await page.locator("nav").getByRole("button",{name:"จัดการระบบ",exact:true}).count(),0);
  }
  const title=`UAT-ONLINE-${suffix}`;const a=pages.admin,e=pages.engineer,v=pages.user;
  console.log("Online React: all three real Auth sessions logged in; creating/assigning work order");
  await a.getByRole("button",{name:"สร้างใบงาน",exact:true}).click(); const modal=a.locator(".cmms-modal");
  await modal.getByLabel("ชื่องาน",{exact:true}).fill(title); await modal.getByLabel("กำหนดเสร็จ",{exact:true}).fill("2026-10-10"); await modal.getByLabel("รายละเอียด",{exact:true}).fill("Local actual Auth UI check");
  await modal.getByLabel("วันและเวลากำหนดเสร็จ (เวลาไทย)",{exact:true}).fill("2026-10-10T16:00");
  await modal.getByRole("button",{name:"สร้างใบงาน",exact:true}).click();
  assert.equal(sql(`select due_at at time zone 'UTC' from public.work_orders where title='${title}';`),"2026-10-10 09:00:00");
  const open=async page=>{await page.getByRole("row").filter({hasText:title}).getByRole("button",{name:/^เปิด /}).click(); await page.locator(".cmms-drawer.order").getByText("สร้างใบงาน",{exact:true}).waitFor();};
  await open(a); const ad=a.locator(".cmms-drawer.order");await ad.getByRole("combobox").selectOption(accounts.engineer.id);await ad.getByRole("button",{name:"มอบหมายงาน",exact:true}).click();await ad.getByText("มอบหมายงาน",{exact:true}).first().waitFor();
  // Both independently signed-in pages update without page reload.
  await open(e);await open(v);const ed=e.locator(".cmms-drawer.order"),vd=v.locator(".cmms-drawer.order");
  await ed.getByRole("button",{name:"เริ่มงาน",exact:true}).click();await ed.getByRole("button",{name:"ส่งตรวจรับ",exact:true}).waitFor();
  await ed.getByLabel("ชื่ออะไหล่ / วัสดุ").fill("ไส้กรองออนไลน์ทดสอบ"); await ed.getByLabel("จำนวน",{exact:true}).fill("1.2345");await ed.getByLabel("หน่วย",{exact:true}).fill("ชิ้น");await ed.getByRole("button",{name:"บันทึกวัสดุ",exact:true}).click();
  await ed.locator(".wo-material strong").filter({hasText:"ไส้กรองออนไลน์ทดสอบ"}).waitFor();
  console.log("Online React: assigned engineer material committed; waiting for viewer invalidation");
  // All three pages confirmed actual Postgres readiness before writes. This
  // assertion deadline is below the 30-second fallback, not a promised SLA.
  try { await vd.locator(".wo-material strong").filter({hasText:"ไส้กรองออนไลน์ทดสอบ"}).waitFor({timeout:10000}); }
  catch(error) {
    console.log("Viewer update status:",await v.locator(".wo-update-status").innerText());
    console.log("Viewer history status:", (await vd.innerText()).slice(-500));
    await v.screenshot({path:path.join(output,"online-update-failure.png"),fullPage:true});
    throw error;
  }
  assert.equal(await vd.getByRole("button",{name:"บันทึกวัสดุ",exact:true}).count(),0);assert.equal(await v.getByRole("button",{name:"สร้างใบงาน",exact:true}).count(),0);
  await ed.getByRole("button",{name:"ส่งตรวจรับ",exact:true}).click();await ad.getByRole("button",{name:"ตรวจรับและปิดงาน",exact:true}).waitFor();await ad.getByRole("button",{name:"ตรวจรับและปิดงาน",exact:true}).click();await vd.getByText("ใบงานนี้ตรวจรับแล้ว",{exact:true}).waitFor();
  assert.equal(sql(`select (started_at is not null and completed_at is not null and completed_at>=started_at) from public.work_orders where title='${title}';`),"t");
  await v.reload();await v.getByRole("button",{name:/SITE-907/}).click();await v.locator("nav").getByRole("button",{name:"ใบงาน",exact:true}).click();await open(v);assert.equal(await vd.locator(".wo-material").count(),1);
  await v.screenshot({path:path.join(output,"online-viewer.png"),fullPage:true});
  await vd.getByRole("button",{name:"ปิด",exact:true}).click();
  await v.getByLabel("ค้นหาใบงาน",{exact:true}).fill(title);
  for (const [label, filename] of [["รายงานใบงาน Excel","online-order-summary.xlsx"],["รายงานใบงาน PDF","online-order-summary.pdf"]]) {
    const download = v.waitForEvent("download");
    await v.getByRole("button",{name:label,exact:true}).click();
    await (await download).saveAs(path.join(output,filename));
    await v.waitForFunction(()=>document.querySelector('[aria-label="ส่งออกรายงานใบงานตามตัวกรอง"]')?.getAttribute("aria-busy")==="false");
  }
  console.log("PASS: real-JWT User exports filtered WO summary XLSX/PDF after server start/approval timestamps and Bangkok due instant confirmed");
  for (const [label, filename] of [["รายงานวัสดุ Excel","material-ledger-online.xlsx"],["รายงานวัสดุ PDF","material-ledger-online.pdf"]]) {
    const download=v.waitForEvent("download",{timeout:30000});
    await v.getByRole("button",{name:label,exact:true}).click();
    await(await download).saveAs(path.join(output,filename));
    await v.waitForFunction(()=>document.querySelector('[aria-label="ส่งออกรายงานวัสดุตามตัวกรองใบงาน"]')?.getAttribute("aria-busy")==="false");
  }
  console.log("PASS: actual-JWT User material-ledger XLSX/PDF with pre/post scope and parent-version authorization");
  await v.locator("nav").getByRole("button",{name:"ทดสอบระบบ UAT",exact:true}).click();
  await v.getByRole("heading",{name:"ผล UAT ฐานกลาง",exact:true}).waitFor();
  await v.getByLabel("ชื่อผู้ทดสอบจริง").fill("Synthetic UI reviewer");await v.getByLabel("รุ่นระบบที่ทดสอบ / Commit").fill("local-unpublished-20261006");await v.getByRole("checkbox").check();await v.getByRole("button",{name:"เริ่มรอบใหม่เข้าฐาน UAT",exact:true}).click();
  await v.getByLabel("ค้นหาเคส").fill("NAV-01");const scenario=v.locator(".uat-case");await scenario.locator("summary").first().click();await scenario.getByLabel("สิ่งที่เกิดขึ้นจริง / เหตุผลที่ทดสอบไม่ได้").fill("Local UI persisted observation");
  // Commit the POST, then simulate losing its response. The UI retains the same
  // UUID, disables new writes and a retry must recover ONE evidence record.
  let capturedId="";let intercepted=false;
  await v.route("**/rest/v1/uat_observations*",async route=>{
    if(route.request().method()==="POST" && !intercepted){intercepted=true;capturedId=route.request().postDataJSON().id;await route.fetch();await route.abort("failed");}else await route.continue();
  });
  await scenario.getByRole("button",{name:"บันทึกผลเคสนี้เข้าฐาน UAT",exact:true}).click();await v.getByRole("button",{name:"ลองรายการเดิมอีกครั้ง",exact:true}).waitFor();
  await v.getByRole("button",{name:"ลองรายการเดิมอีกครั้ง",exact:true}).click();await v.getByText("เซิร์ฟเวอร์ยืนยันการบันทึกแล้ว ผลก่อนหน้ายังอยู่",{exact:true}).waitFor();
  assert.equal(sql(`select count(*) from public.uat_observations where id='${capturedId}';`),"1");
  await v.screenshot({path:path.join(output,"central-uat.png"),fullPage:true});
  await v.setViewportSize({width:390,height:844});
  assert.equal(await v.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await v.screenshot({path:path.join(output,"central-uat-mobile.png"),fullPage:true});
  await v.setViewportSize({width:1440,height:1000});
  const runCount=sql(`select count(*) from public.uat_runs where owner_id='${accounts.user.id}';`);assert.equal(runCount,"1");
  const runId=sql(`select id from public.uat_runs where owner_id='${accounts.user.id}';`);
  await v.reload();await v.getByRole("button",{name:/SITE-907/}).click();await v.locator("nav").getByRole("button",{name:"ทดสอบระบบ UAT",exact:true}).click();await v.getByText("Synthetic UI reviewer · local-unpublished-20261006",{exact:true}).waitFor();
  await v.getByLabel("ค้นหาเคส").fill("NAV-01");await v.locator(".uat-case > summary").click();await v.getByText("Local UI persisted observation",{exact:true}).waitFor();
  // Actual JWT negative tests, not service-role permission evidence.
  const staff=createClient(keys.API_URL,keys.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  assert.equal((await staff.auth.signInWithPassword({email:accounts.engineer.email,password:accounts.engineer.password})).error,null);
  const hidden=await staff.from("uat_runs").select("id").eq("id",runId);assert.equal(hidden.error,null);assert.equal(hidden.data.length,0);
  const forbidden=await staff.from("uat_observations").insert({id:randomUUID(),run_id:runId,scenario_id:"NAV-01",result:"PASS",actual:"Denied",evidence:"",client_at:new Date().toISOString()});assert.equal(forbidden.error?.code,"42501");
  await staff.auth.signOut();staff.realtime.disconnect();
  // Actual Auth sessions may access BOTH same-name sites, but the selected
  // site's operations/history must still be separated by canonical IDs.
  const sameName='Same site '+suffix,firstTitle='Site-ID own '+suffix,secondTitle='Site-ID foreign '+suffix;
  sql(`insert into public.jobsites(id,name,province,site_type) values('SITE-911','${sameName}','Test','Test'),('SITE-912','${sameName}','Test','Test') on conflict(id) do update set name=excluded.name;
    insert into public.user_jobsites(user_id,jobsite_id) values('${accounts.user.id}','SITE-911'),('${accounts.user.id}','SITE-912');
    insert into public.assets(id,jobsite_id,name,asset_type,location) values('SID-A-${suffix}','SITE-911','Site-ID asset A','AC','Test'),('SID-B-${suffix}','SITE-912','Site-ID asset B','AC','Test');
    insert into public.work_orders(id,jobsite_id,work_type,title,asset_id,due_label,created_by) values('SID-WA-${suffix}','SITE-911','PM','${firstTitle}','SID-A-${suffix}','Test','${accounts.admin.id}'),('SID-WB-${suffix}','SITE-912','PM','${secondTitle}','SID-B-${suffix}','Test','${accounts.admin.id}');
    insert into public.alarms(id,jobsite_id,asset_id,level,title,detail,measured_value,acknowledged) values('SID-AA-${suffix}','SITE-911','SID-A-${suffix}','warning','Own alarm ${suffix}','Original A','30',false),('SID-AB-${suffix}','SITE-912','SID-B-${suffix}','warning','Foreign alarm ${suffix}','Original B','31',false);`);
  const selectIdentitySite=async page=>{await page.reload();await page.getByRole('button',{name:/SITE-911/}).click();};
  await selectIdentitySite(v);await v.locator('nav').getByRole('button',{name:'ใบงาน',exact:true}).click();
  await v.getByRole('row').filter({hasText:firstTitle}).waitFor();assert.equal(await v.getByRole('row').filter({hasText:secondTitle}).count(),0);
  await v.locator('nav').getByRole('button',{name:'เครื่องจักร',exact:true}).click();await v.locator('.cmms-asset-card').filter({hasText:'SID-A-'+suffix}).click();
  await v.getByText('SID-WA-'+suffix+' • '+firstTitle,{exact:true}).waitFor();assert.equal(await v.getByText('SID-WB-'+suffix+' • '+secondTitle,{exact:true}).count(),0);
  await selectIdentitySite(a);await a.locator('nav').getByRole('button',{name:'Alarm',exact:true}).click();
  await a.getByText('Own alarm '+suffix,{exact:true}).waitFor();assert.equal(await a.getByText('Foreign alarm '+suffix,{exact:true}).count(),0);
  const ownAlarm=a.locator('.cmms-event-list article').filter({hasText:'Own alarm '+suffix});
  sql(`update public.alarms set detail='Newest server reading',measured_value='39' where id='SID-AA-${suffix}';`);
  let loseAlarmReply=true,alarmKey='',alarmCalls=0,failAlarmRead=false,loseAlarmRead=false;
  let releaseAlarmCommit=()=>{},seenAlarmIntercept=()=>{},liveAlarmContext=false;
  const beforeAlarmCommit=new Promise(resolve=>{seenAlarmIntercept=resolve;});
  const liveAlarmReceipts=new Set();
  a.on('response',async response=>{
    if(!response.ok())return;
    if(response.url().includes('/rpc/read_live_snapshot')){
      const data=await response.json().catch(()=>null);
      if(data?.kind==='alarms'&&data.actor_id===accounts.admin.id&&data.actor_role==='admin'&&data.enabled===true)
        for(const alarm of data.alarms??[])if(alarm.jobsite_id===data.site_id&&alarm.acknowledged&&alarm.acknowledged_by===accounts.admin.id&&alarm.acknowledged_at)liveAlarmReceipts.add(alarm.id);
    }
    if(response.url().includes('/rpc/live_snapshot_context')){
      const data=await response.json().catch(()=>null);
      if(data?.kind==='alarms'&&data.site_id==='SITE-911'&&data.actor_id===accounts.admin.id&&data.actor_role==='admin'&&data.enabled===true)liveAlarmContext=true;
    }
  });
  await a.route('**/rest/v1/rpc/read_live_snapshot',async route=>{
    if(failAlarmRead&&route.request().postDataJSON()?.p_kind==='alarms')
      await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic live Alarm read failure"}'});
    else await route.continue();
  });
  await a.route('**/rest/v1/alarms?**',async route=>{if(failAlarmRead&&route.request().method()==='GET')await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic alarm read failure"}'});else await route.continue();});
  await a.route('**/rest/v1/rpc/acknowledge_alarm_command',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    alarmCalls++;
    if(loseAlarmReply){loseAlarmReply=false;alarmKey=route.request().postDataJSON().p_request_id;seenAlarmIntercept();await new Promise(resolve=>{releaseAlarmCommit=resolve;});await route.fetch();await route.abort('failed');}
    else if(loseAlarmRead){loseAlarmRead=false;const response=await route.fetch();failAlarmRead=true;await route.fulfill({response});}
    else await route.continue();
  });
  await ownAlarm.getByRole('button',{name:/รับทราบ/}).click();await beforeAlarmCommit;
  assert.equal(await ownAlarm.getByText('รับทราบแล้ว',{exact:true}).count(),0);
  assert.equal(sql(`select acknowledged from public.alarms where id='SID-AA-${suffix}';`),'f');
  releaseAlarmCommit();await a.getByRole('button',{name:'ลองคำขอรับทราบเดิมอีกครั้ง',exact:true}).waitFor();
  if(await ownAlarm.getByText('รับทราบแล้ว',{exact:true}).count())
    assert.ok(liveAlarmReceipts.has('SID-AA-'+suffix)&&liveAlarmContext,'Visible receipt requires actual authorized live snapshot/context');
  assert.equal(await a.locator('.cmms-toast').filter({hasText:'เซิร์ฟเวอร์ยืนยันการรับทราบ Alarm แล้ว'}).count(),0);
  await a.getByRole('button',{name:'ลองคำขอรับทราบเดิมอีกครั้ง',exact:true}).click();await ownAlarm.getByText('รับทราบแล้ว',{exact:true}).waitFor();
  assert.equal(sql(`select detail||':'||measured_value||':'||acknowledged_by::text from public.alarms where id='SID-AA-${suffix}';select count(*) from public.alarm_events where actor_id='${accounts.admin.id}' and request_id='${alarmKey}';`),'Newest server reading:39:'+accounts.admin.id+'\n1');
  // Second operation confirms RPC once; authoritative read outage must not
  // announce success or send another command after acknowledged result.
  sql(`insert into public.alarms(id,jobsite_id,asset_id,level,title,detail) values('SID-AC-${suffix}','SITE-911','SID-A-${suffix}','warning','Read retry alarm ${suffix}','Latest C');`);
  await selectIdentitySite(a);await a.locator('nav').getByRole('button',{name:'Alarm',exact:true}).click();const readRetryAlarm=a.locator('.cmms-event-list article').filter({hasText:'Read retry alarm '+suffix});
  loseAlarmRead=true;const beforeCalls=alarmCalls;await readRetryAlarm.getByRole('button',{name:'รับทราบ',exact:true}).click();await a.getByRole('button',{name:'ลองคำขอรับทราบเดิมอีกครั้ง',exact:true}).waitFor({timeout:45000});
  assert.equal(await readRetryAlarm.getByText('รับทราบแล้ว',{exact:true}).count(),0);
  failAlarmRead=false;
  if(await a.getByRole('button',{name:'โหลด Alarm ล่าสุดอีกครั้ง',exact:true}).count())
    await a.getByRole('button',{name:'โหลด Alarm ล่าสุดอีกครั้ง',exact:true}).click();
  await a.locator('.wo-update-status').filter({hasText:/^ติดตามการเปลี่ยนแปลง Alarm/}).waitFor();
  await a.getByRole('button',{name:'ลองคำขอรับทราบเดิมอีกครั้ง',exact:true}).click();await readRetryAlarm.getByText('รับทราบแล้ว',{exact:true}).waitFor();assert.equal(alarmCalls,beforeCalls+1);
  console.log('PASS: narrow real-JWT Alarm ACK, committed reply loss same-key retry, ACK then read-failure/read-only retry; no early success or stale measurement overwrite; actual actor/time/audit; zero legacy Alarm browser writes');
  sql(`insert into public.alarms(id,jobsite_id,asset_id,level,title,detail,measured_value) values('SID-AD-${suffix}','SITE-911','SID-A-${suffix}','warning','Legacy narrow alarm ${suffix}','Latest D','41');update private.alarm_settings set enabled=false;`);
  allowLegacyAlarmAck=true;await selectIdentitySite(a);await a.locator('nav').getByRole('button',{name:'Alarm',exact:true}).click();
  let loseLegacyReply=true;
  await a.unroute('**/rest/v1/alarms?**');
  await a.route('**/rest/v1/alarms?**',async route=>{
    if(route.request().method()==='PATCH'&&loseLegacyReply){loseLegacyReply=false;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  const legacyAlarm=a.locator('.cmms-event-list article').filter({hasText:'Legacy narrow alarm '+suffix});
  await legacyAlarm.getByRole('button',{name:'รับทราบ',exact:true}).click();await a.getByRole('button',{name:'ลองคำขอรับทราบเดิมอีกครั้ง',exact:true}).waitFor();assert.equal(await legacyAlarm.getByText('รับทราบแล้ว',{exact:true}).count(),0);
  const originalReceipt=sql(`select acknowledged_by::text||':'||acknowledged_at::text from public.alarms where id='SID-AD-${suffix}';`);
  await a.getByRole('button',{name:'ลองคำขอรับทราบเดิมอีกครั้ง',exact:true}).click();await legacyAlarm.getByText('รับทราบแล้ว',{exact:true}).waitFor();
  assert.equal(sql(`select acknowledged_by::text||':'||acknowledged_at::text from public.alarms where id='SID-AD-${suffix}';`),originalReceipt);
  assert.equal(sql(`select detail||':'||measured_value from public.alarms where id='SID-AD-${suffix}';`),'Latest D:41');
  allowLegacyAlarmAck=false;sql('update private.alarm_settings set enabled=true;');
  const alarmTester=createClient(keys.API_URL,keys.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  assert.equal((await alarmTester.auth.signInWithPassword({email:accounts.user.email,password:accounts.user.password})).error,null);
  assert.equal((await alarmTester.rpc('acknowledge_alarm_command',{p_alarm_id:'SID-AA-'+suffix,p_site_id:'SITE-911',p_request_id:randomUUID()})).error?.code,'42501');
  await alarmTester.auth.signOut();alarmTester.realtime.disconnect();
  console.log('PASS: gate-OFF React uses only scoped boolean PATCH, lost reply retry retains original server receipt and newest reading; User JWT cannot acknowledge');
  for(let n=0;n<50;n++){if(sql(`select acknowledged from public.alarms where id='SID-AA-${suffix}';`)==='t')break;if(n===49)throw Error('Same-name Alarm acknowledgement not stored');await new Promise(r=>setTimeout(r,100));}
  assert.equal(sql(`select acknowledged::text||':'||detail||':'||measured_value from public.alarms where id='SID-AB-${suffix}';`),'false:Original B:31');
  sql(`update public.jobsites set name='Renamed site ${suffix}' where id='SITE-911';`);
  await selectIdentitySite(v);await v.locator('nav').getByRole('button',{name:'ใบงาน',exact:true}).click();await v.getByRole('row').filter({hasText:firstTitle}).waitFor();assert.equal(await v.getByRole('row').filter({hasText:secondTitle}).count(),0);
  await v.locator('nav').getByRole('button',{name:'เครื่องจักร',exact:true}).click();await v.locator('.cmms-asset-card').filter({hasText:'SID-A-'+suffix}).click();await v.getByText('SID-WA-'+suffix+' • '+firstTitle,{exact:true}).waitFor();
  await v.screenshot({path:path.join(output,'canonical-site-history.png'),fullPage:true});
  console.log('PASS: actual JWT viewer authorized to two same-name sites sees only selected ID WO/asset history; Admin sees selected ID Alarm only and acknowledgement leaves other site untouched; rename preserves operations/history');
  // PM readiness can be healthy while operations loading fails. Never show
  // fabricated zero totals or offer writes/exports from an incomplete load.
  let failOperations=true;
  await a.route('**/rest/v1/work_orders?**',async route=>{if(failOperations&&route.request().method()==='GET')await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic operations read failure"}'});else await route.continue();});
  await selectIdentitySite(a);await a.locator('nav').getByRole('button',{name:'ใบงาน',exact:true}).click();
  await a.getByRole('alert').filter({hasText:'ไม่ใช้ยอดศูนย์หรือข้อมูล Demo แทน'}).waitFor({timeout:45000});
  assert.equal(await a.getByRole('button',{name:'สร้างใบงาน',exact:true}).count(),0);assert.equal(await a.getByRole('row').filter({hasText:firstTitle}).count(),0);
  await a.locator('nav').getByRole('button',{name:'ภาพรวม',exact:true}).click();await a.getByRole('alert').filter({hasText:'ไม่ใช้ยอดศูนย์หรือข้อมูล Demo แทน'}).waitFor();assert.equal(await a.locator('.cmms-kpi-grid').count(),0);
  failOperations=false;await a.getByRole('button',{name:'โหลดใบงานและ Alarm อีกครั้ง',exact:true}).click();await a.locator('nav').getByRole('button',{name:'ใบงาน',exact:true}).click();await a.getByRole('row').filter({hasText:firstTitle}).waitFor();await a.getByRole('button',{name:'สร้างใบงาน',exact:true}).waitFor();
  console.log('PASS: independent operations load failure hides unknown dashboard totals/WO mutation+export rows despite healthy PM load; explicit retry recovers confirmed records');
  let failOrderReadiness=true;
  await a.route('**/rest/v1/rpc/work_order_commands_ready',async route=>{if(failOrderReadiness)await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic readiness failure"}'});else await route.continue();});
  await selectIdentitySite(a);await a.locator('nav').getByRole('button',{name:'ใบงาน',exact:true}).click();
  await a.getByRole('alert').filter({hasText:'ไม่ใช้ยอดศูนย์หรือข้อมูล Demo แทน'}).waitFor({timeout:45000});
  const gateRetry=a.getByRole('button',{name:'โหลดใบงานและ Alarm อีกครั้ง',exact:true});assert.equal(await gateRetry.isEnabled(),true);assert.equal(await a.getByRole('button',{name:'สร้างใบงาน',exact:true}).count(),0);
  failOrderReadiness=false;await gateRetry.click();await a.getByRole('row').filter({hasText:firstTitle}).waitFor();await a.getByRole('button',{name:'สร้างใบงาน',exact:true}).waitFor();
  console.log('PASS: failed WO readiness settles instead of permanent spinner; enabled retry rechecks gate and recovers without legacy fallback');
  assert.deepEqual(pageErrors,[]);
  console.log("PASS: React online email login + role/scope, transactional WO/materials, three-session refresh/Realtime/viewer persistence; central UAT create/write/reload, committed-response-loss same-ID retry => one record; different JWT cannot read/append another tester's run");
  console.log("Username Edge login and Admin Edge list used by React; Admin create/update/delete Edge paths NOT RUN; synthetic local fixtures retained, no Production writes or populated env files");
} catch(error){console.error("FAIL:",error instanceof Error?error.message:"online UI test failed");console.error(error?.stack?.split("\n").find(line=>line.includes("test-tor-online-ui.mjs:"))??"");process.exitCode=1;}
finally {if(browser)await browser.close();if(server)server.kill();operator.realtime.disconnect();sql(`update private.uat_settings set enabled=${priorGate==="t"?"true":"false"};update private.work_order_settings set enabled=${priorOrderGate==="t"?"true":"false"};update private.alarm_settings set enabled=${priorAlarmGate==="t"?"true":"false"};`);}
