import {openGroupedSection} from './open-grouped-section.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const port = 15193;
const base = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'], {
  env: {...process.env,VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:'',VITE_BASE_PATH:'/'},
});
let browser;
try {
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('Vite startup timed out')),15000);
    server.once('error',reject);
    server.once('exit',code=>reject(new Error(`Vite exited ${code}`)));
    server.stdout.on('data',chunk=>{
      if (chunk.toString().includes(base)) { clearTimeout(timer); resolve(); }
    });
  });
  browser = await chromium.launch({channel:'chrome',headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const errors=[];
  async function enter(page,user,site='SITE-001') {
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);
    await page.getByPlaceholder('เช่น admin').fill(user);
    await page.getByPlaceholder('กรอกรหัสผ่าน').fill('demo123');
    await page.getByRole('button',{name:/^เข้าสู่ระบบ/}).click();
    if (user==='user') assert.equal(await page.getByRole('button',{name:/SITE-002/}).count(),0);
    await page.getByRole('button',{name:new RegExp(site)}).click();
    await openGroupedSection(page, 'แผน PM');
    return page.getByRole('region',{name:'สัญญาบำรุงรักษา'});
  }
  const page=await context.newPage();
  const panel=await enter(page,'admin');
  await panel.getByRole('button',{name:'สร้างสัญญา'}).click();
  await panel.getByLabel('ชื่อสัญญา').fill('สัญญาทดลอง A');
  await panel.getByLabel('วันเริ่มสัญญา').fill('2026-06-01');
  await panel.getByLabel('วันสิ้นสุดสัญญา').fill('2027-05-31');
  await panel.getByRole('button',{name:'เพิ่มกลุ่มเครื่อง'}).click();
  await panel.getByLabel('ชื่อกลุ่ม').fill('เครื่อง AHU');
  await panel.getByLabel('อาคาร',{exact:true}).fill('A');
  await panel.getByLabel('ค้นหาเครื่อง').fill('AHU-OPD-01');
  assert.equal(await panel.getByLabel('เครื่องจากทะเบียนไซต์').isDisabled(),true);
  await panel.getByLabel('ค้นหาเครื่อง').fill('CR-DP-02');
  await panel.getByLabel('เครื่องจากทะเบียนไซต์').selectOption('CR-DP-02');
  await panel.getByRole('button',{name:'เพิ่มเข้ากลุ่ม'}).click();
  await panel.getByRole('heading',{name:'เครื่องในกลุ่ม (1)'}).waitFor();
  assert.equal(await panel.getByRole('button',{name:'นำกลุ่มออก',exact:true}).isDisabled(),true);
  await panel.getByLabel('ล้างใหญ่ 2026-06',{exact:true}).fill('14');
  await panel.getByLabel('ล้างย่อย 2027-05',{exact:true}).fill('0');
  assert.equal(await panel.locator('tbody tr').count(),12);
  await panel.getByRole('button',{name:'บันทึกสัญญา'}).click();
  await panel.getByText('บันทึกสัญญาทดลองในเบราว์เซอร์แล้ว').waitFor();
  const stored=await page.evaluate(()=>localStorage.getItem('thaicon-contract-demo-v1:SITE-001'));
  assert.equal(JSON.parse(stored)[0].definition.targets.length,2);
  await page.reload();
  await openGroupedSection(page, 'แผน PM');
  const contractId=JSON.parse(stored)[0].id;
  await panel.getByLabel('สัญญาที่บันทึกแล้ว').selectOption(contractId);
  assert.equal(await panel.getByLabel('ล้างใหญ่ 2026-06',{exact:true}).inputValue(),'14');
  assert.equal(await panel.getByLabel('ล้างย่อย 2027-05',{exact:true}).inputValue(),'0');
  await panel.getByRole('heading',{name:'เครื่องในกลุ่ม (1)'}).waitFor();
  await panel.getByLabel('ล้างใหญ่ 2026-06',{exact:true}).fill('15');
  await panel.getByRole('button',{name:'เพิ่มกลุ่มเครื่อง'}).click();
  await panel.getByLabel('ชื่อกลุ่ม').fill('กลุ่ม B');
  await panel.getByLabel('อาคาร',{exact:true}).fill('B');
  await panel.getByLabel('เครื่องจากทะเบียนไซต์').selectOption('CR-DP-02');
  await panel.getByRole('button',{name:'ย้ายเข้ากลุ่มนี้'}).click();
  await panel.getByRole('heading',{name:'เครื่องในกลุ่ม (1)'}).waitFor();
  await panel.getByRole('button',{name:'บันทึกสัญญา'}).click();
  await panel.getByText('สัญญาฉบับที่ 2',{exact:true}).waitFor();
  const moved=await page.evaluate(()=>JSON.parse(localStorage.getItem('thaicon-contract-demo-v1:SITE-001'))[0].definition);
  assert.deepEqual(moved.members,[{group_id:moved.groups.find(g=>g.name==='กลุ่ม B').id,asset_id:'CR-DP-02'}]);
  await panel.getByRole('button',{name:'นำ CR-DP-02 ออกจากกลุ่ม'}).click();
  await panel.getByRole('button',{name:'บันทึกสัญญา'}).click();
  await panel.getByText('สัญญาฉบับที่ 3',{exact:true}).waitFor();
  await panel.getByRole('heading',{name:'เครื่องในกลุ่ม (0)'}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  const viewer=await browser.newContext();
  await viewer.addInitScript(value=>localStorage.setItem('thaicon-contract-demo-v1:SITE-001',value),stored);
  const view=await enter(await viewer.newPage(),'user');
  await view.getByLabel('สัญญาที่บันทึกแล้ว').selectOption(contractId);
  await view.getByText('สัญญาฉบับที่ 1',{exact:true}).waitFor();
  assert.equal(await view.getByRole('button',{name:'บันทึกสัญญา'}).count(),0);
  await view.getByRole('heading',{name:'เครื่องในกลุ่ม (1)'}).waitFor();
  assert.equal(await view.getByRole('button',{name:'นำ CR-DP-02 ออกจากกลุ่ม'}).count(),0);
  assert.equal(await view.getByLabel('ชื่อสัญญา').getAttribute('readonly'),'');
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(value=>{
    localStorage.setItem('thaicon-contract-demo-v1:SITE-001',value);
  },stored);
  async function openReport(id) {
    await page.getByRole('row').filter({has:page.getByText(id,{exact:true})}).getByRole('button',{name:'เปิด',exact:true}).click();
    return page.getByRole('region',{name:'งานล้างตามสัญญา'});
  }
  await page.reload();
  await openGroupedSection(page, 'Service Report');
  const photo=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');
    canvas.width=180; canvas.height=100;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#204675';ctx.fillRect(0,0,180,100);
    ctx.fillStyle='#fff';ctx.font='18px sans-serif';ctx.fillText('UAT HVAC PHOTO',10,55);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  async function createReport(title) {
    await page.getByRole('button',{name:/สร้าง Service Report/}).click();
    const form=page.getByRole('dialog');
    await form.locator('[name=assetId]').selectOption('CR-DP-02');
    await form.locator('[name=serviceDate]').fill('2026-06-12');
    await form.locator('[name=customerName]').fill('ผู้ตรวจรับทดสอบ');
    await form.locator('[name=workPerformed]').fill(title);
    await form.locator('[name=findings]').fill('พบจุดรั่วจากการทดสอบ');
    await form.locator('[name=actionTaken]').fill('ทำความสะอาดและแจ้งซ่อม');
    await form.locator('[name=result]').selectOption('repair_required');
    await form.locator('[name=photos]').setInputFiles({name:'uat-hvac.png',mimeType:'image/png',buffer:Buffer.from(photo,'base64')});
    await form.getByRole('button',{name:'ส่งอนุมัติ',exact:true}).click();
    await form.waitFor({state:'hidden'});
    return page.evaluate(value=>JSON.parse(localStorage.getItem('thaicon-cmms-maintenance-v3')).serviceReports
      .find(row=>row.workPerformed===value)?.id,title);
  }
  const reportId=await createReport('UAT ล้างแอร์รายเครื่อง');
  const duplicateId=await createReport('UAT งานซ้ำรายเครื่อง');
  assert.ok(reportId && duplicateId && reportId!==duplicateId);
  let evidence=await openReport(reportId);
  await evidence.getByLabel('สัญญา',{exact:true}).selectOption(contractId);
  await evidence.getByRole('button',{name:'เชื่อมกับสัญญา'}).click();
  await evidence.getByText('ตรวจรับลูกค้า (จำลอง) · ยังไม่ตรวจรับ',{exact:true}).waitFor();
  assert.equal(await evidence.getByRole('button',{name:'จำลองตรวจรับลูกค้า'}).count(),0);
  await page.getByRole('button',{name:'อนุมัติรายงาน',exact:true}).click();
  evidence=await openReport(reportId);
  await evidence.getByText('อนุมัติภายใน · อนุมัติแล้ว',{exact:true}).waitFor();
  await evidence.getByText('ตรวจรับลูกค้า (จำลอง) · ยังไม่ตรวจรับ',{exact:true}).waitFor();
  await evidence.getByRole('button',{name:'จำลองตรวจรับลูกค้า'}).click();
  await evidence.getByText('นับเป็นผลงานตามสัญญาทดลอง 1 ครั้ง',{exact:true}).waitFor();
  await page.locator('.maint-detail-modal').getByRole('button',{name:'×',exact:true}).click();
  evidence=await openReport(duplicateId);
  await evidence.getByLabel('สัญญา',{exact:true}).selectOption(contractId);
  await evidence.getByRole('button',{name:'เชื่อมกับสัญญา'}).click();
  await evidence.getByRole('alert').getByText(/มีงานล้างประเภทนี้/).waitFor();
  await page.reload();
  await openGroupedSection(page, 'Service Report');
  await (await openReport(reportId)).getByText('นับเป็นผลงานตามสัญญาทดลอง 1 ครั้ง',{exact:true}).waitFor();
  await page.locator('.maint-detail-modal').getByRole('button',{name:'×',exact:true}).click();
  await openGroupedSection(page, 'รายงาน');
  const reportPanel=page.getByRole('region',{name:'รายงานสัญญาบำรุงรักษา',exact:true});
  const monthly=reportPanel.getByRole('region',{name:'สรุปรายเดือนและยอดสะสม'});
  const breakdown=reportPanel.getByRole('region',{name:'รายละเอียดแยกตามอาคารและประเภทงาน'});
  assert.equal(await monthly.locator('tbody tr').count(),12);
  await reportPanel.getByLabel('เดือนในสัญญา').selectOption('2027-05');
  assert.deepEqual(await monthly.locator('tbody td').allTextContents(),['0','0','—','14','1']);
  await reportPanel.getByLabel('เดือนในสัญญา').selectOption('2026-06');
  await reportPanel.getByLabel('ประเภทล้าง').selectOption('minor');
  await breakdown.getByText('ไม่มีรายละเอียดตรงกับตัวกรอง').waitFor();
  await reportPanel.getByLabel('ประเภทล้าง').selectOption('major');
  await breakdown.getByText('ดูต้นทาง (1)',{exact:true}).click();
  await breakdown.getByRole('button',{name:reportId,exact:true}).click();
  await page.locator('.maint-detail-modal').getByRole('heading',{name:reportId,exact:true}).waitFor();
  await page.locator('.maint-detail-modal').getByRole('button',{name:'×',exact:true}).click();
  await reportPanel.waitFor();
  const delivery=reportPanel.getByRole('region',{name:'ฉบับส่งมอบ',exact:true});
  await reportPanel.getByLabel('เดือนในสัญญา').selectOption('2026-06');
  const screenTotals=await monthly.locator('tbody td').allTextContents();
  assert.deepEqual(screenTotals,['14','1','7.1%','14','1']);
  await delivery.getByLabel('ชื่อหรือเลขงวด').fill('งวดทดสอบ 1');
  await delivery.getByRole('button',{name:'ออกฉบับตามตัวกรอง'}).click();
  await delivery.getByText('บันทึกฉบับที่ 1 แล้ว',{exact:true}).waitFor();
  const original=await delivery.getByLabel('ฉบับที่บันทึก',{exact:true}).inputValue();
  await reportPanel.getByLabel('ประเภทล้าง').selectOption('minor');
  await delivery.getByLabel('ชื่อหรือเลขงวด').fill('งวดทดสอบ 2');
  await delivery.getByRole('button',{name:'ออกฉบับตามตัวกรอง'}).click();
  await delivery.getByText('บันทึกฉบับที่ 2 แล้ว',{exact:true}).waitFor();
  await page.reload();
  await openGroupedSection(page, 'รายงาน');
  await delivery.getByLabel('ฉบับที่บันทึก',{exact:true}).selectOption(original);
  for (const [label,extension] of [['Excel','xlsx'],['PDF','pdf']]) {
    const pending=page.waitForEvent('download');
    await delivery.getByRole('button',{name:`ดาวน์โหลด ${label} ฉบับส่งมอบ`}).click();
    const download=await pending;
    assert.match(download.suggestedFilename(),new RegExp(`-R1\\.${extension}$`));
    assert.equal(await download.failure(),null);
    if (process.argv[3]) {
      await mkdir(process.argv[3],{recursive:true});
      await download.saveAs(path.join(process.argv[3],`delivery.${extension}`));
    }
    await delivery.getByText(`ดาวน์โหลด ${label} แล้ว`,{exact:true}).waitFor();
  }
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'กลับสู่หน้าเลือกไซต์',exact:true}).click();
  await page.getByRole('button',{name:/SITE-002/}).click();
  await openGroupedSection(page, 'รายงาน');
  await delivery.getByText('ยังไม่มีฉบับส่งมอบ',{exact:true}).waitFor();
  assert.equal(await delivery.getByRole('button',{name:/ดาวน์โหลด.*ฉบับส่งมอบ/}).count(),0);
  assert.equal(await reportPanel.getByLabel('สัญญารายงาน').count(),0);
  await openGroupedSection(page, 'Service Report');
  assert.equal(await page.getByText(reportId,{exact:true}).count(),0);
  if (process.argv[3]) {
    await writeFile(path.join(process.argv[3],'browser-results.json'),JSON.stringify({
      reportId,screenTotals,month:'2026-06',sourceSite:'SITE-001',otherSite:'SITE-002',
      checks:['contract setup','asset assigned','report and photo submitted','internal approval','simulated acceptance',
        'duplicate rejected','cumulative and filtered totals','source drill-down','prior edition after reload',
        'PDF/XLSX downloads','mobile','viewer read-only and cannot select SITE-002','SITE-002 contract/report/archive hidden'],
    },null,2),'utf8');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS Demo contracts, acceptance, totals, source drill-down, archived PDF/XLSX downloads and mobile width');
} finally {
  await browser?.close();
  server.kill();
}
