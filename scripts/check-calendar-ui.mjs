import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {default:pw}=await import(pathToFileURL(process.argv[2]).href);
const browser=await pw.chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const url=process.argv[3] ?? 'http://127.0.0.1:15181/';
 await page.goto(url);
 await page.getByPlaceholder('เช่น admin').fill('admin');await page.getByPlaceholder('กรอกรหัสผ่าน').fill('demo123');
 await page.getByRole('button',{name:/^เข้าสู่ระบบ/}).click();await page.getByRole('button',{name:/SITE-001/}).click();
 const overview=page.getByRole('navigation',{name:'มุมมองภาพรวม'});
 const sidebar=page.getByRole('navigation',{name:'เมนูหลัก'});
 const toggle=page.locator('.cmms-calendar-disclosure > summary').filter({hasText:'ปฏิทินงานซ่อมบำรุง'});
 await toggle.waitFor();
 assert.equal(await page.locator('.work-calendar').count(),0);
 const kpis=page.getByRole('region',{name:'ตัวชี้วัดหลัก'});
 assert.ok((await kpis.boundingBox()).y < (await toggle.boundingBox()).y);
 for(const label of ['แผน PM','รายงาน','Service Report']) {
  assert.equal(await sidebar.getByRole('button',{name:label,exact:true}).count(),0);
  const tab=overview.getByRole('button',{name:label,exact:true});
  await tab.click();
  assert.equal(await tab.getAttribute('aria-current'),'page');
  assert.equal(await sidebar.getByRole('button',{name:'ภาพรวม',exact:true}).getAttribute('aria-current'),'page');
 }
 const equipment=page.getByRole('navigation',{name:'มุมมองเครื่องจักร'});
 const equipmentMenu=sidebar.getByRole('button',{name:'เครื่องจักร',exact:true});
 await equipmentMenu.click();
 assert.deepEqual(await equipment.getByRole('button').allTextContents(),['ทะเบียนเครื่องจักร','ใบงาน','ใบแจ้งซ่อม']);
 for(const label of ['ใบงาน','ใบแจ้งซ่อม']) {
  assert.equal(await sidebar.getByRole('button',{name:label,exact:true}).count(),0);
  const tab=equipment.getByRole('button',{name:label,exact:true});
  await tab.click();
  assert.equal(await tab.getAttribute('aria-current'),'page');
  assert.equal(await equipmentMenu.getAttribute('aria-current'),'page');
 }
 await sidebar.getByRole('button',{name:'ภาพรวม',exact:true}).click();
 await overview.getByRole('button',{name:'สรุปสถานะ'}).click();
 await page.evaluate(()=>{
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const key of Object.keys(localStorage)) {
   let state;try{state=JSON.parse(localStorage.getItem(key));}catch{continue;}
   if(Array.isArray(state?.workOrders)) {const o=state.workOrders[0];if(o){o.jobsiteId='SITE-001';o.dueAt=day+'T10:00:00+07:00';o.title='Calendar synthetic check';localStorage.setItem(key,JSON.stringify(state));}}
  }
 });
 await page.reload();
 const calendar=page.locator('.work-calendar');
 await toggle.focus();
 await page.keyboard.press('Enter');
 await calendar.getByText(/Calendar synthetic check/).first().waitFor();
 await calendar.getByRole('button',{name:'กำหนดการ',exact:true}).click();
 await calendar.locator('.calendar-event').filter({hasText:'Calendar synthetic check'}).click();
 await page.locator('.cmms-drawer.order').waitFor();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'ภาพรวม',exact:true}).click();
 await calendar.getByRole('button',{name:'กำหนดการ',exact:true}).click();
 await calendar.getByLabel('ประเภท',{exact:true}).selectOption('SR');
 assert.equal(await calendar.locator('.calendar-event.wo').count(),0);
 await calendar.getByRole('button',{name:'ล้างตัวกรอง'}).click();
 for(const name of ['สัปดาห์','วัน','เดือน'])await calendar.getByRole('button',{name,exact:true}).click();
 await calendar.getByRole('button',{name:'ช่วงถัดไป'}).click();await calendar.getByRole('button',{name:'วันนี้',exact:true}).click();
 await toggle.click();
 assert.equal(await calendar.isVisible(),false);
 await page.setViewportSize({width:375,height:812});
 await toggle.click();
 assert.equal(await calendar.locator('.calendar-grid-wrap').isVisible(),false);
 assert.equal(await calendar.locator('.calendar-agenda').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 for(const viewport of [{width:768,height:1024},{width:844,height:390}]) {
  await page.setViewportSize(viewport);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 const engineer=await browser.newPage();
 await engineer.goto(url);
 await engineer.getByPlaceholder('เช่น admin').fill('engineer');
 await engineer.getByPlaceholder('กรอกรหัสผ่าน').fill('demo123');
 await engineer.getByRole('button',{name:/^เข้าสู่ระบบ/}).click();
 await engineer.locator('.site-option').first().click();
 const engineerOverview=engineer.getByRole('navigation',{name:'มุมมองภาพรวม'});
 assert.deepEqual(await engineerOverview.getByRole('button').allTextContents(),['Service Report']);
 await engineer.getByRole('navigation',{name:'เมนูหลัก'}).getByRole('button',{name:'เครื่องจักร',exact:true}).click();
 const engineerEquipment=engineer.getByRole('navigation',{name:'มุมมองเครื่องจักร'});
 assert.deepEqual(await engineerEquipment.getByRole('button').allTextContents(),['ใบงาน','ใบแจ้งซ่อม']);
 assert.equal(await engineerEquipment.getByRole('button',{name:'ใบงาน',exact:true}).getAttribute('aria-current'),'page');
 console.log('PASS overview navigation, role access, keyboard disclosure, dated WO, calendar filters and mobile agenda');
} finally {await browser.close();}
