import {openGroupedSection} from './open-grouped-section.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';

const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const config=JSON.parse(await readFile(process.argv[3],'utf8'));
const output=process.argv[4];
const prepareOnly=process.argv[5]==='--prepare';
assert.equal(config.url,'https://ddpoeszoedbtibgtqxmu.supabase.co','Only the isolated contract UAT project is allowed');
const auth={persistSession:false,autoRefreshToken:false,detectSessionInUrl:false};
const [admin,viewer,foreign,observer]=config.users;
async function login(user) {
  const client=createClient(config.url,config.key,{auth});
  const {data,error}=await client.auth.signInWithPassword({email:user.email,password:user.password});
  assert.ok(data?.session && !error,`Auth failed for ${user.role}: ${error?.code}`);
  assert.equal(data.user.id,user.id);
  return client;
}
const [api,sameSite,otherSite,readOnly]=await Promise.all([admin,viewer,foreign,observer].map(login));
const anon=createClient(config.url,config.key,{auth});
const server=prepareOnly ? null : spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','15194','--strictPort'],{
  env:{...process.env,VITE_SUPABASE_URL:config.url,VITE_SUPABASE_PUBLISHABLE_KEY:config.key,VITE_BASE_PATH:'/'},
});
let browser;
try {
  const url=prepareOnly ? 'http://127.0.0.1:15195/' : 'http://127.0.0.1:15194/';
  if(server) await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Vite startup timeout')),15000);
    server.once('error',reject);
    server.once('exit',code=>reject(Error('Vite exited '+code)));
    server.stdout.on('data',chunk=>{if(chunk.toString().includes(url)){clearTimeout(timer);resolve();}});
  });
  browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[];
  const failures=[];
  async function enter(user,site) {
    const context=await browser.newContext({acceptDownloads:true});
    const page=await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',async response=>{
      if (response.status()<400 || !response.url().startsWith(config.url)) return;
      const endpoint=new URL(response.url()).pathname;
      if(!endpoint.startsWith('/rest/v1/')) return;
      try { const body=await response.json(); failures.push([endpoint,response.status(),body.code,body.message]); }
      catch { failures.push([endpoint,response.status()]); }
    });
    if (user.role==='admin' && !prepareOnly) {
      // The unrelated directory Edge Function is not deployed in this UAT.
      // Read its directory inputs under the actual browser session and RLS.
      await page.route('**/functions/v1/admin-users',async route=>{
        const req=route.request();
        if (req.method()!=='POST' || req.postDataJSON()?.action!=='list') return route.abort();
        const authorization=req.headers().authorization;
        const scoped=createClient(config.url,config.key,{auth,global:{headers:{authorization}}});
        const profiles=await scoped.from('profiles').select('id,username,display_name,role,title,is_active');
        const assignments=await scoped.from('user_jobsites').select('user_id,jobsite_id');
        await route.fulfill({status:profiles.error||assignments.error ? 403 : 200,
          json:{profiles:profiles.data??[],assignments:assignments.data??[]}});
      });
    }
    await page.goto(url);
    await page.getByPlaceholder('เช่น admin').fill(user.email);
    await page.getByPlaceholder('กรอกรหัสผ่าน').fill(user.password);
    await page.getByRole('button',{name:/^เข้าสู่ระบบ/}).click();
    try { await page.getByRole('button',{name:new RegExp(site)}).waitFor(); }
    catch { throw Error(`Site selector failed for ${user.role}: ${(await page.locator('body').innerText()).slice(0,950)}`); }
    if(user.role!=='admin') {
      assert.equal(await page.getByRole('button',{name:new RegExp(site==='SITE-901' ? 'SITE-902':'SITE-901')}).count(),0);
    }
    await page.getByRole('button',{name:new RegExp(site)}).click();
    return page;
  }
  const page=await enter(admin,'SITE-901');
  const menu=(tab,label)=>['รายงาน','Service Report','แผน PM','ใบงาน','ใบแจ้งซ่อม'].includes(label)
    ? openGroupedSection(tab,label)
    : tab.getByRole('navigation',{name:'เมนูหลัก'}).getByRole('button',{name:label,exact:true}).click();
  await menu(page,'แผน PM');
  const setup=page.getByRole('region',{name:'สัญญาบำรุงรักษา',exact:true});
  const reviewers=page.getByRole('region',{name:'จัดการผู้ตรวจรับลูกค้า',exact:true});
  const reviewerSelect=reviewers.getByLabel('บัญชีลูกค้าที่ใช้งานได้',{exact:true});
  const updateReviewer=async(grant)=>{
    await menu(page,'แผน PM');
    await reviewerSelect.waitFor();
    assert.equal(await reviewers.count(),1);
    if(grant) {
      await reviewerSelect.selectOption(viewer.id);
      try { await reviewers.getByRole('button',{name:'มอบหมายสิทธิ์ตรวจรับ',exact:true}).click({timeout:5000}); }
      catch { throw Error(JSON.stringify({failures,selected:await reviewerSelect.inputValue(),panel:await reviewers.innerText()})); }
    } else {
      page.once('dialog',dialog=>dialog.accept());
      await reviewers.getByRole('button',{name:'ถอนสิทธิ์ตรวจรับ contract-viewer',exact:true}).click();
    }
    try { await reviewers.getByText(grant?'มอบหมายผู้ตรวจรับแล้ว':'ถอนสิทธิ์ตรวจรับแล้ว',{exact:true}).waitFor({timeout:7000}); }
    catch { throw Error(JSON.stringify({failures,panel:await reviewers.innerText()})); }
  };
  await reviewerSelect.waitFor();
  if((await sameSite.rpc('can_review_contract_customer',{p_site:'SITE-901'})).data) await updateReviewer(false);
  assert.equal(await reviewerSelect.locator(`option[value="${foreign.id}"]`).count(),0);
  if(!prepareOnly) {
    await updateReviewer(true);
    assert.equal((await sameSite.rpc('can_review_contract_customer',{p_site:'SITE-901'})).data,true);
  }
  const runId=Date.now().toString(36);
  const title=(prepareOnly?'UAT ทดลองตรวจรับ ':'UAT contract ')+runId;
  await setup.getByRole('button',{name:'สร้างสัญญา'}).click();
  await setup.getByLabel('ชื่อสัญญา').fill(title);
  await setup.getByLabel('วันเริ่มสัญญา').fill('2026-06-01');
  await setup.getByLabel('วันสิ้นสุดสัญญา').fill('2027-05-31');
  await setup.getByRole('button',{name:'เพิ่มกลุ่มเครื่อง'}).click();
  await setup.getByLabel('ชื่อกลุ่ม').fill('AHU อาคาร A');
  await setup.getByLabel('อาคาร',{exact:true}).fill('A');
  assert.equal(await setup.getByLabel('เครื่องจากทะเบียนไซต์').locator('option[value="UAT-AHU-902"]').count(),0);
  await setup.getByLabel('เครื่องจากทะเบียนไซต์').selectOption('UAT-AHU-901');
  await setup.getByRole('button',{name:'เพิ่มเข้ากลุ่ม'}).click();
  await setup.getByLabel('ล้างใหญ่ 2026-06',{exact:true}).fill('14');
  await setup.getByRole('button',{name:'บันทึกสัญญา'}).click();
  try { await setup.getByText('บันทึกสัญญาแล้ว',{exact:true}).waitFor(); }
  catch { throw Error(JSON.stringify({failures,alert:await setup.getByRole('alert').allTextContents()})); }
  const contractId=await setup.getByLabel('สัญญาที่บันทึกแล้ว').inputValue();
  assert.match(contractId,/^[a-f0-9-]{36}$/);
  await menu(page,'Service Report');
  const png=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=160;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#123c66';ctx.fillRect(0,0,320,160);
    ctx.fillStyle='#fff';ctx.font='22px Arial';ctx.fillText('UAT AUTH HVAC PHOTO',15,85);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  async function createReport(work, date) {
    await page.getByRole('button',{name:/สร้าง Service Report/}).click();
    const form=page.getByRole('dialog');
    await form.locator('[name=assetId]').selectOption('UAT-AHU-901');
    await form.locator('[name=serviceDate]').fill(date);
    await form.locator('[name=customerName]').fill('ผู้ตรวจรับ UAT');
    await form.locator('[name=workPerformed]').fill(work);
    await form.locator('[name=findings]').fill('พบถาดน้ำทิ้งรั่ว ทดสอบเท่านั้น');
    await form.locator('[name=actionTaken]').fill('แจ้งซ่อมถาดน้ำทิ้ง');
    await form.locator('[name=result]').selectOption('repair_required');
    await form.locator('[name=photos]').setInputFiles({name:'auth-uat-hvac.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await form.getByRole('button',{name:'ส่งอนุมัติ',exact:true}).click();
    await form.waitFor({state:'hidden'});
  }
  const loadReport=(work='UAT cleaning '+runId)=>api.from('service_reports').select('id,version,status').eq('jobsite_id','SITE-901').eq('work_performed',work).single();
  async function approveReport(id) {
    await page.getByRole('row').filter({has:page.getByText(id,{exact:true})}).getByRole('button',{name:'เปิด',exact:true}).click();
    await page.getByRole('button',{name:'อนุมัติรายงาน',exact:true}).click();
    await page.locator('.maint-detail-modal').waitFor({state:'hidden'});
  }
  await createReport('UAT cleaning '+runId,'2026-06-12');
  const submitted=await loadReport();
  assert.equal(submitted.data?.status,'submitted',submitted.error?.message);
  const reportId=submitted.data.id;
  if(prepareOnly) {
    await approveReport(reportId);
    const secondWork='UAT revoke '+runId;
    await createReport(secondWork,'2026-06-13');
    const second=await loadReport(secondWork);
    assert.ok(second.data?.id && second.data.status==='submitted');
    await approveReport(second.data.id);
    assert.equal((await loadReport()).data?.status,'approved');
    assert.equal((await loadReport(secondWork)).data?.status,'approved');
    assert.equal((await sameSite.rpc('can_review_contract_customer',{p_site:'SITE-901'})).data,false);
    const customerPage=await enter(viewer,'SITE-901');
    await menu(customerPage,'Service Report');
    await customerPage.getByText(reportId,{exact:true}).waitFor();
    await customerPage.getByText(second.data.id,{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    await mkdir(output,{recursive:true});
    const handoff={url,site:'SITE-901',contract:title,contractId,acceptReport:reportId,revokeReport:second.data.id};
    await writeFile(path.join(output,'manual-uat.json'),JSON.stringify(handoff,null,2));
    console.log(JSON.stringify(handoff));
  } else {
  const rpc=(client,name,params)=>client.rpc(name,params);
  const management={p_site:'SITE-901',p_user:foreign.id,p_grant:true,p_request_id:crypto.randomUUID()};
  assert.equal((await rpc(api,'set_contract_reviewer',management)).error?.code,'22023');
  assert.equal((await rpc(sameSite,'set_contract_reviewer',{...management,p_user:viewer.id})).error?.code,'42501');
  assert.equal((await rpc(otherSite,'list_contract_reviewers',{p_site:'SITE-901'})).error?.code,'42501');
  assert.ok((await rpc(anon,'list_contract_reviewers',{p_site:'SITE-901'})).error);
  const receive={p_site:'SITE-901',p_contract:contractId,p_report:reportId,p_version:submitted.data.version,p_kind:'major'};
  assert.equal((await rpc(sameSite,'accept_contract_customer',receive)).error?.code,'22023');
  await approveReport(reportId);
  const approved=await loadReport();
  assert.equal(approved.data?.status,'approved',approved.error?.message);
  receive.p_version=approved.data.version;
  const readParams={p_site:'SITE-901',p_contract:contractId};
  assert.deepEqual((await rpc(sameSite,'read_contract_accepted_evidence',readParams)).data,[]);
  assert.equal((await rpc(api,'accept_contract_customer',receive)).error?.code,'42501');
  assert.equal((await rpc(readOnly,'accept_contract_customer',receive)).error?.code,'42501');
  assert.equal((await rpc(otherSite,'accept_contract_customer',receive)).error?.code,'42501');
  const openReport=async(tab)=>{
    await menu(tab,'Service Report');
    await tab.getByRole('row').filter({has:tab.getByText(reportId,{exact:true})}).getByRole('button',{name:'เปิด',exact:true}).click();
  };
  const observerPage=await enter(observer,'SITE-901');
  await openReport(observerPage);
  assert.equal(await observerPage.getByRole('button',{name:'ยืนยันตรวจรับงาน'}).count(),0);
  const reviewerPage=await enter(viewer,'SITE-901');
  await openReport(reviewerPage);
  const acceptance=reviewerPage.getByRole('region',{name:'ตรวจรับงานตามสัญญา',exact:true});
  await acceptance.getByLabel('สัญญาที่ตรวจรับ').selectOption(contractId);
  await updateReviewer(false);
  assert.equal((await rpc(sameSite,'can_review_contract_customer',{p_site:'SITE-901'})).data,false);
  // Keep the customer's previously opened form and browser session.
  reviewerPage.once('dialog',dialog=>dialog.accept());
  await acceptance.getByRole('button',{name:'ยืนยันตรวจรับงาน'}).click();
  await acceptance.getByRole('alert').getByText('ไม่มีสิทธิ์ตรวจรับไซต์นี้',{exact:true}).waitFor();
  assert.equal((await rpc(sameSite,'accept_contract_customer',receive)).error?.code,'42501');
  assert.deepEqual((await rpc(sameSite,'read_contract_accepted_evidence',readParams)).data,[]);
  await reviewerPage.locator('.maint-detail-modal').getByRole('button',{name:'×',exact:true}).click();
  await openReport(reviewerPage);
  assert.equal(await reviewerPage.getByRole('button',{name:'ยืนยันตรวจรับงาน'}).count(),0);
  await reviewerPage.locator('.maint-detail-modal').getByRole('button',{name:'×',exact:true}).click();
  await updateReviewer(true);
  await openReport(reviewerPage);
  await acceptance.getByLabel('สัญญาที่ตรวจรับ').selectOption(contractId);
  reviewerPage.once('dialog',dialog=>dialog.accept());
  await acceptance.getByRole('button',{name:'ยืนยันตรวจรับงาน'}).click();
  await acceptance.getByText(/ลูกค้าตรวจรับแล้ว/).waitFor();
  const receipt=await rpc(sameSite,'accept_contract_customer',receive);
  assert.ok(receipt.data?.id && !receipt.error,receipt.error?.message);
  assert.equal((await rpc(sameSite,'accept_contract_customer',{...receive,p_kind:'minor'})).error?.code,'23505');
  assert.equal((await rpc(otherSite,'read_contract_accepted_evidence',readParams)).error?.code,'42501');
  assert.equal((await rpc(otherSite,'read_contract_definition',{p_id:contractId,p_site:'SITE-901'})).error?.code,'42501');
  assert.equal((await rpc(otherSite,'read_contract_accepted_evidence',{...readParams,p_site:'SITE-902'})).error?.code,'P0002');
  assert.ok((await rpc(anon,'read_contract_accepted_evidence',readParams)).error);
  const accepted=(await rpc(sameSite,'read_contract_accepted_evidence',readParams)).data;
  assert.equal(accepted?.length,1);
  assert.equal(accepted[0].receipt_type,'customer');
  assert.equal(accepted[0].accepted_by,viewer.id);
  assert.equal(accepted[0].approved_by,admin.id);
  await updateReviewer(false);
  assert.equal((await rpc(sameSite,'accept_contract_customer',receive)).error?.code,'42501');
  assert.equal((await rpc(sameSite,'read_contract_accepted_evidence',readParams)).data?.[0]?.id,receipt.data.id);
  assert.deepEqual((await otherSite.from('service_reports').select('id').eq('id',reportId)).data,[]);
  const {data:photos,error:photoError}=await api.from('service_report_attachments').select('storage_path').eq('service_report_id',reportId);
  assert.ok(!photoError && photos.length===1);
  assert.ok((await otherSite.storage.from('service-report-photos').download(photos[0].storage_path)).error);

  async function view(tab) {
    await menu(tab,'รายงาน');
    const panel=tab.getByRole('region',{name:'รายงานสัญญาบำรุงรักษา',exact:true});
    await panel.getByLabel('สัญญารายงาน').selectOption(contractId);
    await panel.getByLabel('เดือนในสัญญา').selectOption('2026-06');
    const totals=await panel.getByRole('region',{name:'สรุปรายเดือนและยอดสะสม'}).locator('tbody td').allTextContents();
    assert.deepEqual(totals,['14','1','7.1%','14','1']);
    return {panel,totals};
  }
  const {panel,totals}=await view(page);
  const delivery=panel.getByRole('region',{name:'ฉบับส่งมอบ',exact:true});
  await delivery.getByLabel('ชื่อหรือเลขงวด').fill('งวด UAT '+runId);
  await delivery.getByRole('button',{name:'ออกฉบับตามตัวกรอง'}).click();
  await delivery.getByText('บันทึกฉบับที่ 1 แล้ว',{exact:true}).waitFor();
  const issueId=await delivery.getByLabel('ฉบับที่บันทึก',{exact:true}).inputValue();
  const issueRead={p_site:'SITE-901',p_id:issueId,p_format:'pdf'};
  assert.equal((await rpc(otherSite,'list_contract_deliveries',{p_site:'SITE-901'})).error?.code,'42501');
  assert.equal((await rpc(otherSite,'read_contract_delivery_file',issueRead)).error?.code,'42501');
  assert.equal((await rpc(otherSite,'read_contract_delivery_file',{...issueRead,p_site:'SITE-902'})).error?.code,'P0002');
  assert.ok((await rpc(anon,'read_contract_delivery_file',issueRead)).error);
  assert.equal((await rpc(readOnly,'issue_contract_delivery',{
    p_site:'SITE-901',p_contract:contractId,p_contract_version:1,p_id:crypto.randomUUID(),
    p_revision:2,p_period:'denied',p_pdf:'',p_xlsx:'',
  })).error?.code,'42501');
  await mkdir(output,{recursive:true});
  for(const [label,ext] of [['Excel','xlsx'],['PDF','pdf']]) {
    const pending=page.waitForEvent('download');
    await delivery.getByRole('button',{name:`ดาวน์โหลด ${label} ฉบับส่งมอบ`}).click();
    const download=await pending;
    assert.match(download.suggestedFilename(),/^ThaiCon-UAT-/);
    await download.saveAs(path.join(output,'auth-uat.'+ext));
    await delivery.getByText(`ดาวน์โหลด ${label} แล้ว`,{exact:true}).waitFor();
  }
  await panel.getByLabel('ประเภทล้าง').selectOption('minor');
  await delivery.getByLabel('ชื่อหรือเลขงวด').fill('งวด UAT ฉบับแก้ไข '+runId);
  await delivery.getByRole('button',{name:'ออกฉบับตามตัวกรอง'}).click();
  await delivery.getByText('บันทึกฉบับที่ 2 แล้ว',{exact:true}).waitFor();
  await reviewerPage.reload();
  const returnSite=reviewerPage.getByRole('button',{name:/SITE-901/});
  const overviewMenu=reviewerPage.getByRole('navigation',{name:'เมนูหลัก'}).getByRole('button',{name:'ภาพรวม',exact:true});
  await returnSite.or(overviewMenu).first().waitFor();
  if(await returnSite.isVisible()) await returnSite.click();
  const {panel:viewerPanel}=await view(reviewerPage);
  assert.equal(await viewerPanel.getByRole('button',{name:'ออกฉบับตามตัวกรอง'}).count(),0);
  const archive=viewerPanel.getByRole('region',{name:'ฉบับส่งมอบ',exact:true});
  await archive.getByLabel('ฉบับที่บันทึก',{exact:true}).selectOption(issueId);
  for (const [label,ext] of [['Excel','xlsx'],['PDF','pdf']]) {
    const download=reviewerPage.waitForEvent('download');
    await archive.getByRole('button',{name:`ดาวน์โหลด ${label} ฉบับส่งมอบ`}).click();
    await (await download).saveAs(path.join(output,'reopened.'+ext));
    assert.deepEqual(await readFile(path.join(output,'reopened.'+ext)),await readFile(path.join(output,'auth-uat.'+ext)));
    await archive.getByText(`ดาวน์โหลด ${label} แล้ว`,{exact:true}).waitFor();
  }
  const foreignPage=await enter(foreign,'SITE-902');
  await menu(foreignPage,'รายงาน');
  const foreignPanel=foreignPage.getByRole('region',{name:'รายงานสัญญาบำรุงรักษา',exact:true});
  await foreignPanel.getByText(/สร้างสัญญาทดลอง/).waitFor();
  assert.equal(await foreignPanel.getByLabel('สัญญารายงาน').count(),0);
  await foreignPanel.getByText('ยังไม่มีฉบับส่งมอบ',{exact:true}).waitFor();
  await menu(foreignPage,'Service Report');
  assert.equal(await foreignPage.getByText(reportId,{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'auth-uat-results.json'),JSON.stringify({runId,contractId,reportId,receipt:receipt.data,issueId,totals,
    sourceSite:'SITE-901',foreignSite:'SITE-902',roleChecks:'Admin, customer reviewer, read-only User, other-site User and anonymous',
    checks:['actual browser password login','scoped contract saved','report and photo submitted','approval before acceptance',
      'receipt replay and duplicate rejected','cross-site definition, evidence, Service Report and Storage denied',
      'assigned viewer same totals and read-only','archived PDF and Excel downloads are byte-identical after reload',
      'cross-site and anonymous archive downloads denied',
      'Admin grant and revoke in UI; cross-site target excluded; non-admin management denied',
      'revoked browser session denied from open form and exact API replay; existing receipt retained']},null,2));
  console.log('PASS real Supabase Auth, scoped report and photo, acceptance and PDF/XLSX downloads',runId,reportId,totals.join('/'));
  }
} finally {
  await browser?.close();
  server?.kill();
}
