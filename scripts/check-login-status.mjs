import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { default: pw } = await import(pathToFileURL(process.argv[2]).href);
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
const out = '../../outputs/login-status-20261009';
await mkdir(out, { recursive: true });
try {
  for (const width of [390, 768, 1440, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    await page.goto(process.argv[3] || 'http://127.0.0.1:15190/');
    await page.locator('.access-server-status.online').waitFor();
    await page.locator('.access-database-status.demo').waitFor();
    assert.match(await page.locator('.access-database-status').textContent(), /ไม่ได้เชื่อมฐานข้อมูล/);
    assert.equal(await page.locator('h1').textContent(), 'ระบบติดตามงานซ่อมบำรุง');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${out}/${width}.png`, fullPage: true });
    if (width === 390) {
      await page.route('**/web-status.json?*', route => route.fulfill({ status: 503, body: 'Unavailable' }));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.locator('.access-server-status.offline').waitFor();
      await page.unroute('**/web-status.json?*');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.locator('.access-server-status.online').waitFor();
      await context.setOffline(true);
      await page.locator('.access-server-status.offline').waitFor();
      await context.setOffline(false);
      await page.locator('.access-server-status.online').waitFor();
    }
    await context.close();
  }
  console.log('PASS: four responsive viewports, HTTP failure, offline and recovery');
} finally { await browser.close(); }
