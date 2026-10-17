import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {default:pw}=await import(pathToFileURL(process.argv[2]).href);
const browser=await pw.chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:15181/');
 await page.getByPlaceholder('เช่น admin').fill('admin');await page.getByPlaceholder('กรอกรหัสผ่าน').fill('demo123');
 await page.getByRole('button',{name:/^เข้าสู่ระบบ/}).click();await page.getByRole('button',{name:/SITE-001/}).click();
 await page.locator('.work-calendar').waitFor();
 await page.evaluate(()=>{
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const key of Object.keys(localStorage)) {
   let state;try{state=JSON.parse(localStorage.getItem(key));}catch{continue;}
   if(Array.isArray(state?.workOrders)) {const o=state.workOrders[0];if(o){o.jobsiteId='SITE-001';o.dueAt=day+'T10:00:00+07:00';o.title='Calendar synthetic check';localStorage.setItem(key,JSON.stringify(state));}}
  }
 });
 await page.reload();
 const calendar=page.locator('.work-calendar');
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
 await page.setViewportSize({width:390,height:844});
 assert.equal(await calendar.locator('.calendar-grid-wrap').isVisible(),false);
 assert.equal(await calendar.locator('.calendar-agenda').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 console.log('PASS calendar: dated WO, open detail, filters, views, navigation, mobile agenda; isolated data only');
} finally {await browser.close();}
