import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { default: pw } = await import(pathToFileURL(process.argv[2]).href);
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(process.argv[3] || 'http://127.0.0.1:15181/');
  await page.getByPlaceholder('เช่น admin').fill('engineer');
  await page.getByPlaceholder('กรอกรหัสผ่าน').fill('demo123');
  await page.getByRole('button', { name: /^เข้าสู่ระบบ/ }).click();
  await page.getByRole('button', { name: /SITE-001/ }).click();
  await page.getByRole('button', { name: /แจ้งเตือนใบงาน/ }).waitFor();
  await page.evaluate(() => {
    const key = 'thaicon-cmms-demo-operations-v1';
    const state = JSON.parse(localStorage.getItem(key));
    state.workOrders = [{ ...state.workOrders[0], id: 'WO-NOTICE', title: 'Notification browser test', jobsiteId: 'SITE-001', assigneeId: 'USR-ENG-001', assignedAt: new Date().toISOString(), status: 'กำลังดำเนินการ', dueAt: new Date(Date.now()-60000).toISOString() }];
    localStorage.setItem(key,JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole('button', { name: 'แจ้งเตือนใบงาน ยังไม่อ่าน 2 รายการ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'แจ้งเตือนใบงาน', exact: true });
  await dialog.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }).first().click();
  await page.getByRole('button', { name: 'แจ้งเตือนใบงาน ยังไม่อ่าน 1 รายการ', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(),0);
  await page.reload();
  await page.getByRole('button', { name: 'แจ้งเตือนใบงาน ยังไม่อ่าน 1 รายการ', exact: true }).click();
  await dialog.getByText('อ่านแล้ว', { exact: true }).waitFor();
  await mkdir('../../outputs/work-notifications',{recursive:true});
  for (const width of [390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`../../outputs/work-notifications/${width}.png`});
  }
  await dialog.getByRole('button',{name:'เปิดใบงาน',exact:true}).first().click();
  await page.locator('.cmms-drawer.order').waitFor();
  console.log('PASS notifications: unread count, persistent Demo receipt, Escape, drawer, 3 widths; isolated storage only');
} finally { await browser.close(); }
