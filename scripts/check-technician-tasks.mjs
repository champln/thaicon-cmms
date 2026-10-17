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
  await page.getByRole('button', { name: 'ใบงาน', exact: true }).click();
  await page.getByRole('region', { name: 'งานของฉัน' }).waitFor();
  await page.evaluate(() => {
    const key = 'thaicon-cmms-demo-operations-v1';
    const state = JSON.parse(localStorage.getItem(key));
    const base = state.workOrders[0];
    state.workOrders = [
      { ...base, id: 'WO-MINE', title: 'Technician browser test', jobsiteId: 'SITE-001', assigneeId: 'USR-ENG-001', status: 'รอตรวจรับ', dueAt: new Date(Date.now()-60000).toISOString() },
      { ...base, id: 'WO-OTHER', jobsiteId: 'SITE-001', assigneeId: 'other', status: 'กำลังดำเนินการ' },
      { ...base, id: 'WO-OUTSIDE', jobsiteId: 'SITE-002', assigneeId: 'USR-ENG-001', status: 'กำลังดำเนินการ' },
    ];
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole('button', { name: 'ใบงาน', exact: true }).click();
  const panel = page.getByRole('region', { name: 'งานของฉัน' });
  await panel.getByRole('button', { name: /WO-MINE/ }).waitFor();
  assert.equal(await panel.locator('.technician-task-list li').count(), 1);
  for (const name of ['เกินกำหนด', 'รอตรวจรับ']) {
    await panel.getByRole('button', { name: new RegExp(name+' 1') }).click();
    assert.equal(await panel.locator('.technician-task-list li').count(), 1);
  }
  await panel.getByRole('button', { name: /WO-MINE/ }).click();
  await page.locator('.cmms-drawer.order').waitFor();
  await page.keyboard.press('Escape');
  await mkdir('../../outputs/technician-tasks', { recursive: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(500); // Allow the existing responsive sidebar transition to finish before screenshots.
    await panel.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `../../outputs/technician-tasks/${width}.png` });
  }
  console.log('PASS technician task filters, canonical assignment/site isolation, existing drawer, 3 viewport widths (isolated Demo)');
} finally { await browser.close(); }
