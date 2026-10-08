// Isolated local Supabase + fresh browser contexts only. Credentials stay in
// memory, never arguments/files/logs. No Production or customer acceptance.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { syntheticPhoto } from './synthetic-photo.mjs';
const target=path.resolve(process.argv[2]),output=path.resolve(process.argv[4]);
assert.match(await readFile(path.join(target,'supabase/config.toml'),'utf8'),/project_id = "thaicon-tor-local"/);
const container='supabase_db_thaicon-tor-local';
const sql=input=>{const r=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input,encoding:'utf8'});if(r.status!==0)throw Error('Isolated PM SQL check failed (details suppressed)');return r.stdout.trim();};
const identity=spawnSync('docker',['inspect',container,'--format','{{.Name}}'],{encoding:'utf8'});assert.equal(identity.stdout.trim(),'/'+container);
const status=spawnSync('npx.cmd',['--yes','supabase@2.119.0','status','--workdir',target,'--output','json'],{shell:true,encoding:'utf8'});assert.equal(status.status,0);
const keys=JSON.parse(status.stdout);assert.equal(keys.API_URL,'http://127.0.0.1:55681');
assert.equal(sql("select count(*) from supabase_migrations.schema_migrations where version='202610060010';"),'1');
if(sql("select count(*) from supabase_migrations.schema_migrations where version='202610060011';")==='0'){
 const migration=await readFile(new URL('../supabase/migrations/202610060011_repair_commands.sql',import.meta.url),'utf8');
 sql('begin;'+migration+"insert into supabase_migrations.schema_migrations(version,name,statements) values('202610060011','repair_commands',array[]::text[]);commit;");
}
if(sql("select count(*) from supabase_migrations.schema_migrations where version='202610060012';")==='0'){
 const migration=await readFile(new URL('../supabase/migrations/202610060012_plan_commands.sql',import.meta.url),'utf8');
 sql('begin;'+migration+"insert into supabase_migrations.schema_migrations(version,name,statements) values('202610060012','plan_commands',array[]::text[]);commit;");
}
// Refresh only still-unpublished definitions in this explicitly checked local
// project. Fresh complete migration install is verified by test:tor-db separately.
const source=await readFile(new URL('../supabase/migrations/202610060010_service_report_drafts.sql',import.meta.url),'utf8');
for(const name of ['public.service_report_commands_ready','public.save_service_report_command']){
 const start=source.indexOf('create function '+name+'('),end=source.indexOf('\nrevoke all on function '+name,start);assert.ok(start>=0&&end>start);
 sql('begin;'+source.slice(start,end).replace('create function','create or replace function')+'commit;');
}
const gates=sql('select reviews_enabled::text||\':\'||drafts_enabled::text from private.service_report_settings;').split(':');
const workOrderGate=sql('select enabled::text from private.work_order_settings;');
const repairGate=sql('select enabled::text from private.repair_settings;');
const planGate=sql('select enabled::text from private.plan_settings;');
const module=await import(pathToFileURL(process.argv[3]).href),{chromium}=module.default??module;
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const operator=createClient(keys.API_URL,keys.SERVICE_ROLE_KEY,opts),accounts={},clients=[];
const suffix=randomUUID().slice(0,8),errors=[],forbiddenLegacy=[];let browser,server;
const ok=(r,label)=>{if(r.error)throw Error(label+': '+(r.error.code??'failed'));return r.data;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async predicate=>{for(let n=0;n<80;n++){if(await predicate())return;await wait(200);}throw Error('Local PM assertion timeout');};
try{
 await mkdir(output,{recursive:true});
 for(const role of ['admin','engineer','user']){
  const email=`pm_${role}_${suffix}@example.invalid`,password=randomUUID()+'Aa1!';
  const created=ok(await operator.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username:`pm_${role}_${suffix}`,display_name:`PM ${role} ${suffix}`}}),'local Auth fixture');
  const client=createClient(keys.API_URL,keys.ANON_KEY,opts);clients.push(client);ok(await client.auth.signInWithPassword({email,password}),'real fixture login');
  accounts[role]={id:created.user.id,email,password,client};
 }
 sql(`update public.profiles set role='admin' where id='${accounts.admin.id}';update public.profiles set role='engineer' where id='${accounts.engineer.id}';
 insert into public.jobsites(id,name,province,site_type) values('SITE-907','TOR A','Test','Test') on conflict(id) do nothing;
 insert into public.assets(id,jobsite_id,name,asset_type,location) values('TOR-A','SITE-907','AC A','AC','Test') on conflict(id) do nothing;
 insert into public.user_jobsites(user_id,jobsite_id) values('${accounts.engineer.id}','SITE-907'),('${accounts.user.id}','SITE-907');
 update private.work_order_settings set enabled=true;update private.service_report_settings set reviews_enabled=true,drafts_enabled=true;update private.repair_settings set enabled=true;update private.plan_settings set enabled=true;`);
 const woId='WO-'+randomUUID();
 ok(await accounts.admin.client.rpc('create_work_order_command',{p_order_id:woId,p_request_id:randomUUID(),p_site_id:'SITE-907',p_asset_id:'TOR-A',p_title:'PM linked '+suffix,p_work_type:'PM',p_priority:'normal',p_due_label:'2026-10-10',p_description:'Synthetic'}),'linked order');
 ok(await accounts.admin.client.rpc('apply_work_order_command',{p_order_id:woId,p_expected_version:1,p_request_id:randomUUID(),p_command:'assign',p_assignee_id:accounts.engineer.id}),'linked assignment');
 ok(await accounts.engineer.client.rpc('apply_work_order_command',{p_order_id:woId,p_expected_version:2,p_request_id:randomUUID(),p_command:'start'}),'linked start');
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5183','--strictPort'],{env:{...process.env,VITE_SUPABASE_URL:keys.API_URL,VITE_SUPABASE_PUBLISHABLE_KEY:keys.ANON_KEY,VITE_BASE_PATH:'/'},stdio:'ignore'});
 await until(async()=>{if(server.exitCode!==null)throw Error('Ephemeral Vite failed');try{return(await fetch('http://127.0.0.1:5183/')).ok;}catch{return false;}});
 browser=await chromium.launch({channel:'chrome',headless:true});const pages={};
 async function site(page){await page.getByRole('button',{name:/SITE-907/}).click();}
 for(const role of ['admin','engineer','user']){
  const page=await(await browser.newContext({viewport:{width:1440,height:1000}})).newPage();pages[role]=page;page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(['POST','PATCH','DELETE'].includes(request.method())&&/\/rest\/v1\/(service_reports|service_report_attachments|repair_requests|maintenance_plans|plan_cycles)(\?|$)/.test(request.url()))forbiddenLegacy.push(request.method()+':'+new URL(request.url()).pathname);});
  await page.goto('http://127.0.0.1:5183/');await page.getByPlaceholder('เช่น admin').fill(accounts[role].email);await page.getByPlaceholder('กรอกรหัสผ่าน').fill(accounts[role].password);await page.getByRole('button',{name:/^เข้าสู่ระบบ/}).click();await site(page);
 }
 const a=pages.admin,e=pages.engineer,v=pages.user,planName='UI-PM-'+suffix;
 await a.locator('nav').getByRole('button',{name:'แผน PM',exact:true}).click();
 await a.getByRole('button',{name:/สร้างแผนงาน/}).click();let form=a.locator('.maint-modal');
 let losePlanReply=true,planKey='',failPlanRead=false,losePlanRead=false,loseDeleteReply=false,deleteKey='';
 await a.route('**/rest/v1/rpc/read_plan_command_state',async route=>{if(failPlanRead&&route.request().method()==='POST')await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic plan read failure"}'});else await route.continue();});
 await a.route('**/rest/v1/rpc/apply_plan_command',async route=>{
  if(route.request().method()!=='POST'){await route.continue();return;}
  const data=route.request().postDataJSON();
  if(losePlanReply&&!data.p_delete){losePlanReply=false;planKey=data.p_request_id;await route.fetch();await route.abort('failed');}
  else if(loseDeleteReply&&data.p_delete){loseDeleteReply=false;deleteKey=data.p_request_id;await route.fetch();await route.abort('failed');}
  else if(losePlanRead){losePlanRead=false;const response=await route.fetch();failPlanRead=true;await route.fulfill({response});}
  else await route.continue();
 });
 await form.getByLabel('ชื่อแผนงาน',{exact:true}).fill(planName);await form.getByLabel('เป้าหมายทั้งปี (ครั้ง)',{exact:true}).fill('12');await form.getByRole('button',{name:'บันทึกแผนงาน',exact:true}).click();
 await form.getByRole('button',{name:'ลองคำขอแผนเดิมอีกครั้ง',exact:true}).waitFor();assert.equal(await form.getByLabel('ชื่อแผนงาน',{exact:true}).inputValue(),planName);
 a.once('dialog',dialog=>dialog.dismiss());await a.keyboard.press('Escape');assert.equal(await form.isVisible(),true);assert.equal(await a.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')),true);
 await form.getByRole('button',{name:'ลองคำขอแผนเดิมอีกครั้ง',exact:true}).click();await form.waitFor({state:'hidden'});
 await until(()=>sql(`select count(*) from public.maintenance_plans where name='${planName}';`)==='1');
 const planId=sql(`select id from public.maintenance_plans where name='${planName}';`);
 // Independent customer page receives the plan without reload or 30s fallback.
 await v.locator('nav').getByRole('button',{name:'แผน PM',exact:true}).click();
 await v.locator('.maint-plan-selector').getByText(planName,{exact:true}).waitFor({timeout:10000});
 await a.locator('.wo-update-status').filter({hasText:/^ติดตามการเปลี่ยนแปลง PM/}).waitFor();
 assert.match(planId,/^PLAN-[0-9a-f-]{36}$/);assert.equal(sql(`select count(*) from public.plan_events where request_id='${planKey}' and actor_id='${accounts.admin.id}';`),'1');
 // Stale Admin draft is retained and explicitly resumed after complete comparison.
 await a.locator('.maint-plan-actions').getByRole('button',{name:'แก้ไข',exact:true}).click();form=a.locator('.maint-modal');
 await form.getByLabel('ประเภทบริการ',{exact:true}).fill('Retained PM draft');
 let failLivePlanRead=true;
 await a.route('**/rest/v1/rpc/read_live_snapshot',async route=>{
   if(failLivePlanRead && route.request().postDataJSON()?.p_kind==='maintenance')
     await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic live read failure"}'});
   else await route.continue();
 });
 const planData={name:planName,service_type:'Concurrent service',plan_year:2026,annual_target:12,cycle_months:1,start_month:1,status:'active'};
 ok(await accounts.admin.client.rpc('apply_plan_command',{p_plan_id:planId,p_site_id:'SITE-907',p_expected_version:1,p_request_id:randomUUID(),p_data:planData}),'concurrent plan');
 await form.getByText('โหลดข้อมูลใหม่ไม่สำเร็จ ร่างนี้ยังอยู่ หยุดบันทึกจนกว่าจะยืนยันข้อมูลได้',{exact:true}).waitFor({timeout:10000});
 assert.equal(await form.getByLabel('ประเภทบริการ',{exact:true}).inputValue(),'Retained PM draft');
 assert.equal(await form.getByRole('button',{name:'บันทึกแผนงาน',exact:true}).isDisabled(),true);
 failLivePlanRead=false;
 await form.getByRole('button',{name:'โหลดข้อมูลงานล่าสุดอีกครั้ง',exact:true}).click();
 await a.locator('.maint-plan-summary-title').getByText(/Concurrent service/).waitFor({timeout:10000});
 await until(()=>form.getByRole('button',{name:'บันทึกแผนงาน',exact:true}).isEnabled());
 assert.equal(await form.getByLabel('ประเภทบริการ',{exact:true}).inputValue(),'Retained PM draft');
 await form.getByRole('button',{name:'บันทึกแผนงาน',exact:true}).click();await form.getByRole('button',{name:'ตรวจแผนล่าสุดโดยเก็บร่าง',exact:true}).click();
 await form.getByText('ประเภทบริการ Concurrent service',{exact:true}).waitFor();assert.equal(await form.getByLabel('ประเภทบริการ',{exact:true}).inputValue(),'Retained PM draft');
 await a.setViewportSize({width:390,height:844});const planResume=form.getByRole('button',{name:'ใช้เวอร์ชันล่าสุดและทำต่อ',exact:true});await planResume.scrollIntoViewIfNeeded();assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await a.screenshot({path:path.join(output,'plan-conflict-mobile.png')});await a.setViewportSize({width:1440,height:1000});
 a.once('dialog',dialog=>dialog.accept());await planResume.click();losePlanRead=true;await form.getByRole('button',{name:'บันทึกแผนงาน',exact:true}).click();
 await form.getByRole('button',{name:'ลองคำขอแผนเดิมอีกครั้ง',exact:true}).waitFor({timeout:45000});failPlanRead=false;await form.getByRole('button',{name:'ลองคำขอแผนเดิมอีกครั้ง',exact:true}).click();await form.waitFor({state:'hidden'});
 assert.equal(sql(`select version::text||':'||service_type from public.maintenance_plans where id='${planId}';select sum(target) from public.plan_cycles where plan_id='${planId}';`),'3:Retained PM draft\n12');
 // Unreferenced hard delete keeps a positive scoped tombstone and full before audit.
 await a.getByRole('button',{name:/สร้างแผนงาน/}).click();form=a.locator('.maint-modal');await form.getByLabel('ชื่อแผนงาน',{exact:true}).fill('Delete plan '+suffix);await form.getByLabel('เป้าหมายทั้งปี (ครั้ง)',{exact:true}).fill('1');await form.getByRole('button',{name:'บันทึกแผนงาน',exact:true}).click();await form.waitFor({state:'hidden'});
 const deletePlanId=sql(`select id from public.maintenance_plans where name='Delete plan ${suffix}';`);
 await v.locator('.maint-plan-selector').getByText('Delete plan '+suffix,{exact:true}).waitFor({timeout:10000});
 loseDeleteReply=true;await a.locator('.maint-plan-actions').getByRole('button',{name:'ลบ',exact:true}).click();form=a.locator('.maint-modal');await form.getByRole('button',{name:'ยืนยันลบแผนงาน',exact:true}).click();await form.getByRole('button',{name:'ลองคำขอแผนเดิมอีกครั้ง',exact:true}).waitFor();
 await form.getByRole('button',{name:'ลองคำขอแผนเดิมอีกครั้ง',exact:true}).click();await form.waitFor({state:'hidden'});
 assert.equal(sql(`select count(*) from public.maintenance_plans where id='${deletePlanId}';select count(*) from public.plan_cycles where plan_id='${deletePlanId}';select jsonb_array_length(before_snapshot->'cycles') from public.plan_events where actor_id='${accounts.admin.id}' and request_id='${deleteKey}';`),'0\n0\n12');
 const tombstone=ok(await accounts.user.client.rpc('read_plan_command_state',{p_plan_id:deletePlanId,p_site_id:'SITE-907'}),'viewer deletion evidence');assert.equal(tombstone.deleted,true);assert.equal(tombstone.version,2);
 assert.equal((await accounts.engineer.client.rpc('apply_plan_command',{p_plan_id:planId,p_site_id:'SITE-907',p_expected_version:3,p_request_id:randomUUID(),p_data:planData})).error?.code,'42501');
 console.log('PASS phase: Admin plan create/edit/delete; lost-reply stable retry; retained stale fields/full comparison + resume; failed post-ACK read retry; actual cycles/scoped retained delete audit; Engineer cannot write');
 await until(async()=>await v.locator('.maint-plan-selector').getByText('Delete plan '+suffix,{exact:true}).count()===0);
 await e.reload();await site(e);await e.locator('nav').getByRole('button',{name:'Service Report',exact:true}).click();
 await e.getByRole('button',{name:/สร้าง Service Report/}).click();form=e.locator('.maint-modal.large');
 await form.locator('select[name=planId]').selectOption(planId);await form.locator('select[name=cycleId]').selectOption(planId+'-C01');
 await form.locator('select[name=assetId]').selectOption('TOR-A');await form.getByLabel('วันที่ให้บริการ',{exact:true}).fill('2026-10-06');await form.getByLabel('จำนวนงานที่เสร็จ',{exact:true}).fill('3');await form.getByLabel('เลขที่ใบงาน (ถ้ามี)',{exact:true}).fill(woId);
 await form.getByLabel('ผู้รับมอบงานลูกค้า',{exact:true}).fill('Synthetic customer');await form.locator('textarea[name=workPerformed]').fill('PM original '+suffix);await form.getByLabel('ผลการตรวจสอบ',{exact:true}).fill('Motor noise');await form.getByLabel('การแก้ไข / การดำเนินการ',{exact:true}).fill('Inspect');await form.locator('select[name=result]').selectOption('repair_required');
 await form.locator('input[type=file]').setInputFiles({name:'proof.png',mimeType:'image/png',buffer:syntheticPhoto});
 let lost=false,reportId='',requestId='',failSaveRead=false,loseSaveRead=false;
 await e.route('**/rest/v1/service_reports?**',async route=>{if(failSaveRead&&route.request().method()==='GET'){await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic read failure"}'});}else await route.continue();});
 await e.route('**/rest/v1/rpc/save_service_report_command',async route=>{
  const request=route.request();if(request.method()==='POST'&&!lost&&request.postDataJSON().p_submit){lost=true;reportId=request.postDataJSON().p_report_id;requestId=request.postDataJSON().p_request_id;await route.fetch();await route.abort('failed');}else if(request.method()==='POST'&&loseSaveRead&&request.postDataJSON().p_submit){loseSaveRead=false;const response=await route.fetch();failSaveRead=true;await route.fulfill({response});}else await route.continue();
 });
 await form.getByRole('button',{name:'ส่งอนุมัติ',exact:true}).click();await form.getByRole('button',{name:'ลองบันทึกคำขอเดิมอีกครั้ง',exact:true}).waitFor();
 assert.equal(await form.locator('textarea[name=workPerformed]').inputValue(),'PM original '+suffix);assert.equal(await form.locator('textarea[name=workPerformed]').isDisabled(),true);
 // Deliberately bypass the modal backdrop to exercise the navigation handler's
 // own pending guard (ordinary pointer navigation is already blocked by it).
 await e.locator('nav').getByRole('button',{name:'ใบงาน',exact:true}).click({force:true});assert.equal(await form.isVisible(),true);
 await form.getByRole('button',{name:'ลองบันทึกคำขอเดิมอีกครั้ง',exact:true}).click();await form.waitFor({state:'hidden'});
 assert.equal(sql(`select count(*) from public.service_report_events where actor_id='${accounts.engineer.id}' and request_id='${requestId}';select count(*) from public.repair_requests where service_report_id='${reportId}';`),'1\n1');
 console.log('PASS phase: photo/save-submit committed response loss + same-key retry');
 async function reports(page){await page.reload();await site(page);await page.locator('nav').getByRole('button',{name:'Service Report',exact:true}).click();await page.getByRole('row').filter({hasText:reportId}).waitFor();}
 const row=page=>page.getByRole('row').filter({hasText:reportId});
 let lostReview=false,reviewKey='',failReviewRead=false;
 await a.route('**/rest/v1/service_reports?**',async route=>{if(failReviewRead&&route.request().method()==='GET'){await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic read failure"}'});}else await route.continue();});
 await a.route('**/rest/v1/rpc/apply_service_report_review',async route=>{if(route.request().method()==='POST'&&!lostReview){lostReview=true;reviewKey=route.request().postDataJSON().p_request_id;await route.fetch();await route.abort('failed');}else if(route.request().method()==='POST'&&route.request().postDataJSON().p_command==='approve'){const response=await route.fetch();failReviewRead=true;await route.fulfill({response});}else await route.continue();});
 await reports(a);await row(a).getByRole('button',{name:'เปิด',exact:true}).click();a.once('dialog',dialog=>dialog.accept('Add detail'));
 await a.locator('.maint-detail-modal').getByRole('button',{name:'ส่งกลับแก้ไข',exact:true}).click();await a.getByRole('button',{name:'ลองคำสั่งตรวจเดิมอีกครั้ง',exact:true}).click();await a.locator('.maint-detail-modal').waitFor({state:'hidden'});
 assert.equal(sql(`select count(*) from public.service_report_events where actor_id='${accounts.admin.id}' and request_id='${reviewKey}';`),'1');
 await reports(e);await row(e).getByRole('button',{name:'เปิด',exact:true}).click();await e.locator('.maint-detail-modal').getByText('Add detail',{exact:true}).waitFor();await e.locator('.maint-detail-modal').getByRole('button',{name:'แก้ไข',exact:true}).click();form=e.locator('.maint-modal.large');await form.getByText('Add detail',{exact:true}).waitFor();
 await form.locator('textarea[name=workPerformed]').fill('PM corrected '+suffix);
 const current=ok(await accounts.admin.client.from('service_reports').select('*').eq('id',reportId).single(),'concurrent source');
 const photos=ok(await accounts.admin.client.from('service_report_attachments').select('id,storage_path,file_name,content_type,file_size').eq('service_report_id',reportId),'concurrent photos');
 const data={plan_id:current.plan_id,cycle_id:current.cycle_id,asset_id:current.asset_id,work_order_id:current.work_order_id,service_date:current.service_date,quantity:4,technician_name:current.technician_name,customer_name:current.customer_name,work_performed:current.work_performed,findings:'Admin concurrent change',action_taken:current.action_taken,result:current.result,attachments:photos};
 ok(await accounts.admin.client.rpc('save_service_report_command',{p_report_id:reportId,p_site_id:'SITE-907',p_expected_version:3,p_request_id:randomUUID(),p_data:data,p_submit:false}),'concurrent Admin save');
 await row(e).getByText('4',{exact:true}).waitFor({timeout:10000});
 assert.equal(await form.locator('textarea[name=workPerformed]').inputValue(),'PM corrected '+suffix);
 await form.getByRole('button',{name:'ส่งอนุมัติ',exact:true}).click();await form.getByRole('button',{name:'ตรวจฉบับล่าสุดโดยเก็บร่างเดิม',exact:true}).waitFor();
 assert.equal(await form.locator('textarea[name=workPerformed]').inputValue(),'PM corrected '+suffix);
 await form.getByRole('button',{name:'ตรวจฉบับล่าสุดโดยเก็บร่างเดิม',exact:true}).click();await form.getByText(/เวอร์ชัน 4/).waitFor();
 await e.setViewportSize({width:390,height:844});assert.equal(await e.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await form.getByRole('button',{name:'ใช้เวอร์ชันล่าสุดและแก้ไขร่างต่อ',exact:true}).scrollIntoViewIfNeeded();assert.equal(await form.getByRole('button',{name:'ใช้เวอร์ชันล่าสุดและแก้ไขร่างต่อ',exact:true}).isVisible(),true);await e.screenshot({path:path.join(output,'pm-conflict-feedback-mobile.png')});await e.setViewportSize({width:1440,height:1000});
 e.once('dialog',dialog=>dialog.accept());await form.getByRole('button',{name:'ใช้เวอร์ชันล่าสุดและแก้ไขร่างต่อ',exact:true}).click();
 loseSaveRead=true;await form.getByRole('button',{name:'ส่งอนุมัติ',exact:true}).click();await form.getByRole('button',{name:'ลองบันทึกคำขอเดิมอีกครั้ง',exact:true}).waitFor({timeout:45000});failSaveRead=false;await form.getByRole('button',{name:'ลองบันทึกคำขอเดิมอีกครั้ง',exact:true}).click();await form.waitFor({state:'hidden'});
 console.log('PASS phase: return + preserved conflict draft + explicit resume');
 // User leaves detail open BEFORE another actual JWT approves the report.
 // The live-confirmed version must feed both the visible detail and export.
 await reports(v);await row(v).getByRole('button',{name:'เปิด',exact:true}).click();
 await reports(a);await row(a).getByRole('button',{name:'เปิด',exact:true}).click();await a.locator('.maint-detail-modal').getByRole('button',{name:'อนุมัติรายงาน',exact:true}).click();
 await v.locator('.maint-detail-modal').getByText(accounts.admin.id,{exact:true}).waitFor({timeout:10000});
 assert.match(await v.locator('.maint-detail-modal .maint-review-metadata p').filter({hasText:'เวอร์ชันรายงาน'}).innerText(),/6/);
 await a.getByRole('button',{name:'ลองคำสั่งตรวจเดิมอีกครั้ง',exact:true}).waitFor({timeout:45000});failReviewRead=false;await a.unroute('**/rest/v1/rpc/apply_service_report_review');await a.getByRole('button',{name:'ลองคำสั่งตรวจเดิมอีกครั้ง',exact:true}).click();await a.locator('.maint-detail-modal').waitFor({state:'hidden'});
 assert.equal(sql(`select version::text||':'||status from public.service_reports where id='${reportId}';select count(*) from public.repair_requests where service_report_id='${reportId}';select actual from public.plan_progress where plan_id='${planId}';select version::text||':'||status from public.work_orders where id='${woId}';`),'6:approved\n1\n3\n3:in_progress');
 const detail=v.locator('.maint-detail-modal');
 for(const label of ['แก้ไข','ลบ','อนุมัติรายงาน','ส่งกลับแก้ไข'])assert.equal(await detail.getByRole('button',{name:label,exact:true}).count(),0);
 const download=v.waitForEvent('download',{timeout:25000});await detail.getByRole('button',{name:'ดาวน์โหลด PDF',exact:true}).click();await(await download).saveAs(path.join(output,'pm-service-report-online.pdf'));
 await v.screenshot({path:path.join(output,'pm-approved-viewer.png'),fullPage:true});await detail.getByRole('button',{name:'×',exact:true}).click();
 await v.locator('nav').getByRole('button',{name:'รายงาน',exact:true}).click();await v.locator('.maint-report-filters select').nth(2).selectOption(planId);assert.equal(await v.locator('.maint-report-kpis > div').nth(1).locator('strong').innerText(),'3');
 for(const [label,filename] of [['ดาวน์โหลด Excel','pm-performance-online.xlsx'],['ดาวน์โหลด PDF','pm-performance-online.pdf']]){
  const file=v.waitForEvent('download',{timeout:25000});await v.getByRole('button',{name:label,exact:true}).click();await(await file).saveAs(path.join(output,filename));
  await v.waitForFunction(()=>document.querySelector('[aria-label="ส่งออกรายงาน PM"]')?.getAttribute('aria-busy')==='false');
 }
 assert.equal(await v.locator('.maint-report-kpis > div').nth(1).locator('strong').innerText(),'3');
 await v.locator('nav').getByRole('button',{name:'เครื่องจักร',exact:true}).click();
 await v.locator('.cmms-asset-card').filter({hasText:'TOR-A'}).click();
 const historyFile=v.waitForEvent('download',{timeout:25000});await v.getByRole('button',{name:'ประวัติเครื่องจักร Excel',exact:true}).click();await(await historyFile).saveAs(path.join(output,'asset-history-linked-online.xlsx'));
 await v.waitForFunction(()=>document.querySelector('[aria-label="ส่งออกประวัติเครื่องจักร"]')?.getAttribute('aria-busy')==='false');
 await v.locator('.cmms-drawer').getByRole('button',{name:'ปิด',exact:true}).click();
 // Linked repair follow-up: real owner, same-key retry and stale draft recovery.
 const repairId=sql(`select id from public.repair_requests where service_report_id='${reportId}';`);
 await e.locator('nav').getByRole('button',{name:'ใบแจ้งซ่อม',exact:true}).click();const repairRow=page=>page.getByRole('row').filter({hasText:repairId});
 await repairRow(e).getByRole('button',{name:'แก้ไข',exact:true}).click();let repairForm=e.locator('.maint-modal');
 assert.equal(await repairForm.locator('select[name=assetId]').isDisabled(),true);await repairForm.locator('input[name=title]').fill('Repair follow-up '+suffix);await repairForm.locator('textarea[name=resolution]').fill('Motor fixed');await repairForm.locator('select[name=status]').selectOption('resolved');
 let lostRepair=false,repairKey='',failRepairRead=false,failRepairReload=false;
 await e.route('**/rest/v1/repair_requests?**',async route=>{if(failRepairRead&&route.request().method()==='GET')await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic repair read failure"}'});else await route.continue();});
 await e.route('**/rest/v1/rpc/save_repair_command',async route=>{if(!lostRepair&&route.request().method()==='POST'){lostRepair=true;repairKey=route.request().postDataJSON().p_request_id;await route.fetch();await route.abort('failed');}else if(failRepairReload&&route.request().method()==='POST'){failRepairReload=false;const response=await route.fetch();failRepairRead=true;await route.fulfill({response});}else await route.continue();});
 await repairForm.getByRole('button',{name:'บันทึกใบแจ้งซ่อม',exact:true}).click();await repairForm.getByRole('button',{name:'ลองบันทึกใบแจ้งซ่อมคำขอเดิม',exact:true}).waitFor();assert.equal(await repairForm.locator('input[name=title]').inputValue(),'Repair follow-up '+suffix);
 e.once('dialog',dialog=>dialog.dismiss());await e.keyboard.press('Escape');assert.equal(await repairForm.isVisible(),true);assert.equal(await e.evaluate(()=>document.activeElement?.closest('[role="dialog"]')!==null),true);
 await repairForm.getByRole('button',{name:'ลองบันทึกใบแจ้งซ่อมคำขอเดิม',exact:true}).click();await repairForm.waitFor({state:'hidden'});
 assert.equal(sql(`select version::text||':'||status from public.repair_requests where id='${repairId}';select count(*) from public.repair_events where actor_id='${accounts.engineer.id}' and request_id='${repairKey}';`),'2:resolved\n1');
 await repairRow(e).getByRole('button',{name:'แก้ไข',exact:true}).click();repairForm=e.locator('.maint-modal');await repairForm.locator('textarea[name=resolution]').fill('Engineer retained repair draft');
 const rr=ok(await accounts.admin.client.from('repair_requests').select('*').eq('id',repairId).single(),'repair concurrent source');
 const rrPayload=Object.fromEntries(['asset_id','requested_date','title','description','priority','status','reported_by','resolution','service_report_id'].map(k=>[k,rr[k]]));
 ok(await accounts.admin.client.rpc('save_repair_command',{p_repair_id:repairId,p_site_id:'SITE-907',p_expected_version:2,p_request_id:randomUUID(),p_data:{...rrPayload,resolution:'Admin concurrent repair'}}),'concurrent repair');
 await e.locator('.wo-update-status').filter({hasText:/^ติดตามการเปลี่ยนแปลง PM/}).waitFor();
 assert.equal(await repairForm.locator('textarea[name=resolution]').inputValue(),'Engineer retained repair draft');
 await repairForm.getByRole('button',{name:'บันทึกใบแจ้งซ่อม',exact:true}).click();await repairForm.getByRole('button',{name:'ตรวจใบแจ้งซ่อมล่าสุดโดยเก็บร่าง',exact:true}).click();await repairForm.getByText(/เวอร์ชัน 3/).waitFor();assert.equal(await repairForm.locator('textarea[name=resolution]').inputValue(),'Engineer retained repair draft');
 await e.setViewportSize({width:390,height:844});const resume=repairForm.getByRole('button',{name:'ใช้เวอร์ชันล่าสุดและแก้ไขใบแจ้งซ่อมต่อ',exact:true});await resume.scrollIntoViewIfNeeded();assert.equal(await e.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await e.screenshot({path:path.join(output,'repair-conflict-mobile.png')});await e.setViewportSize({width:1440,height:1000});
 e.once('dialog',dialog=>dialog.accept());await resume.click();failRepairReload=true;await repairForm.getByRole('button',{name:'บันทึกใบแจ้งซ่อม',exact:true}).click();await repairForm.getByRole('button',{name:'ลองบันทึกใบแจ้งซ่อมคำขอเดิม',exact:true}).waitFor({timeout:45000});failRepairRead=false;await repairForm.getByRole('button',{name:'ลองบันทึกใบแจ้งซ่อมคำขอเดิม',exact:true}).click();await repairForm.waitFor({state:'hidden'});
 assert.equal(sql(`select version::text||':'||status from public.repair_requests where id='${repairId}';select version::text||':'||status from public.service_reports where id='${reportId}';select actual from public.plan_progress where plan_id='${planId}';`),'4:resolved\n6:approved\n3');
 // Real JWT payload/role/scope denials, not arbitrary network failures.
 assert.equal((await accounts.engineer.client.rpc('save_repair_command',{p_repair_id:repairId,p_site_id:'SITE-907',p_expected_version:4,p_request_id:randomUUID(),p_data:{...rrPayload,asset_id:'OTHER-ASSET'}})).error?.code,'22023');
 assert.equal((await accounts.user.client.rpc('save_repair_command',{p_repair_id:repairId,p_site_id:'SITE-907',p_expected_version:4,p_request_id:randomUUID(),p_data:rrPayload})).error?.code,'42501');
 assert.equal((await accounts.engineer.client.rpc('save_repair_command',{p_repair_id:repairId,p_site_id:'SITE-902',p_expected_version:4,p_request_id:randomUUID(),p_data:rrPayload})).error?.code,'42501');
 // Standalone creation uses the same atomic path and a server UUID, not autosync.
 await a.locator('nav').getByRole('button',{name:'ใบแจ้งซ่อม',exact:true}).click();await a.getByRole('button',{name:/สร้างใบแจ้งซ่อม/}).click();const standalone=a.locator('.maint-modal');await standalone.locator('input[name=title]').fill('Standalone repair '+suffix);await standalone.locator('textarea[name=description]').fill('Standalone synthetic fault');await standalone.getByRole('button',{name:'บันทึกใบแจ้งซ่อม',exact:true}).click();await standalone.waitFor({state:'hidden'});
 const standaloneId=sql(`select id from public.repair_requests where title='Standalone repair ${suffix}';`);assert.match(standaloneId,/^RR-/);
 const standalonePayload={...rrPayload,service_report_id:null,title:'Attempt other owner'};
 assert.equal((await accounts.engineer.client.rpc('save_repair_command',{p_repair_id:standaloneId,p_site_id:'SITE-907',p_expected_version:1,p_request_id:randomUUID(),p_data:standalonePayload})).error?.code,'42501');
 // Real old-client PostgREST UPSERT must advance a server version even OFF.
 // Actual JWT revocation, including retry with the authorization read held:
 // cached master assets must NEVER reappear until verified authorization.
 await v.locator('nav').getByRole('button',{name:'เครื่องจักร',exact:true}).click();
 await v.getByText('TOR-A',{exact:true}).first().waitFor();
 sql(`delete from public.user_jobsites where user_id='${accounts.user.id}' and jobsite_id='SITE-907';`);
 await v.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await v.getByRole('heading',{name:'สิทธิ์บัญชีหรือไซต์เปลี่ยนไป',exact:true}).waitFor({timeout:10000});
 let held=false,releaseRead=()=>{};
 await v.route('**/rest/v1/rpc/read_live_snapshot',async route=>{
   held=true;await new Promise(resolve=>{releaseRead=resolve;});await route.continue();
 });
 await v.getByRole('button',{name:'ตรวจสิทธิ์อีกครั้ง',exact:true}).click();
 await until(async()=>held);
 assert.equal(await v.getByRole('heading',{name:'สิทธิ์บัญชีหรือไซต์เปลี่ยนไป',exact:true}).isVisible(),true);
 assert.equal(await v.getByText('TOR-A',{exact:true}).count(),0);
 const deniedResponse=v.waitForResponse(response=>response.url().includes('/rpc/read_live_snapshot')&&response.status()===403);
 releaseRead();await deniedResponse;
 await v.unroute('**/rest/v1/rpc/read_live_snapshot');
 assert.equal(await v.getByText('TOR-A',{exact:true}).count(),0);
 sql(`insert into public.user_jobsites(user_id,jobsite_id) values('${accounts.user.id}','SITE-907');`);
 await v.getByRole('button',{name:'ตรวจสิทธิ์อีกครั้ง',exact:true}).click();
 await v.getByText('TOR-A',{exact:true}).first().waitFor({timeout:10000});
 console.log('PASS: actual JWT revoked while cached master assets present; denied retry stays hidden through held RPC; only verified restored access reveals data');
 sql('update private.repair_settings set enabled=false;');
 ok(await accounts.admin.client.from('repair_requests').upsert({...standalonePayload,id:standaloneId,jobsite_id:'SITE-907',asset_name:'AC A',created_by:accounts.admin.id,title:'Standalone repair '+suffix}),'gate-off legacy upsert');
 assert.equal(sql(`select version from public.repair_requests where id='${standaloneId}';`),'2');sql('update private.repair_settings set enabled=true;');
 assert.equal((await accounts.admin.client.rpc('save_repair_command',{p_repair_id:standaloneId,p_site_id:'SITE-907',p_expected_version:1,p_request_id:randomUUID(),p_data:standalonePayload})).error?.code,'40001');
 // This explicit SDK-only old-client probe is outside browser command mode.
 // The browser request observer must still have seen zero legacy writes.
 await v.reload();await site(v);await v.locator('nav').getByRole('button',{name:'ใบแจ้งซ่อม',exact:true}).click();await repairRow(v).waitFor();assert.equal(await repairRow(v).getByRole('button',{name:'แก้ไข',exact:true}).count(),0);assert.equal(await v.getByRole('button',{name:/สร้างใบแจ้งซ่อม/}).count(),0);
 console.log('PASS phase: linked/standalone repair React commands; retained draft/conflict, committed reply loss and post-ACK read failure retry; real JWT role/owner/site/link denials; viewer readonly; report/Actual unchanged');
 // A genuinely partial operator gate must NOT silently use legacy writes.
 sql('update private.service_report_settings set reviews_enabled=false,drafts_enabled=true;');
 await e.reload();await site(e);await e.locator('nav').getByRole('button',{name:'Service Report',exact:true}).click();await e.getByRole('alert').filter({hasText:'ไม่ใช้ข้อมูล Demo แทน'}).waitFor();assert.equal(await e.getByRole('button',{name:/สร้าง Service Report/}).count(),0);
 sql('update private.service_report_settings set reviews_enabled=true,drafts_enabled=true;');await e.getByRole('button',{name:'ตรวจระบบบันทึกรายงานอีกครั้ง',exact:true}).click();await e.getByRole('button',{name:/สร้าง Service Report/}).waitFor();
 assert.deepEqual(forbiddenLegacy,[]);assert.deepEqual(errors,[]);
 console.log('PASS: real React PM plan -> photo+repair/save_submit; committed save/return lost responses same-key retry; acknowledged resubmit/approve then failed reload and safe retry; actual return reason visible; retained conflict text/photo + explicit compare/resume; one repair/Actual3/version6; viewer private-photo PDF; linked WO remains open; partial gate blocks writes; no legacy report/attachment/source-repair writes; mobile comparison controls reachable/no overflow');
}catch(error){console.error('FAIL:',error instanceof Error?error.message:'PM UI test failed');if(browser)for(const context of browser.contexts())for(const page of context.pages()){console.log('Diagnostic modal:',await page.locator('.maint-modal, .maint-detail-modal').allTextContents());await page.screenshot({path:path.join(output,'pm-failure-'+browser.contexts().indexOf(context)+'.png'),fullPage:true});}process.exitCode=1;}
finally{if(browser)await browser.close();if(server)server.kill();for(const client of clients){await client.auth.signOut();client.realtime.disconnect();}operator.realtime.disconnect();sql(`update private.service_report_settings set reviews_enabled=${gates[0]},drafts_enabled=${gates[1]};update private.work_order_settings set enabled=${workOrderGate};update private.repair_settings set enabled=${repairGate};update private.plan_settings set enabled=${planGate};`);}
