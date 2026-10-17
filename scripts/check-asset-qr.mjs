import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { default: pw } = await import(pathToFileURL(process.argv[2]).href);
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
const base = process.argv[3] || 'http://127.0.0.1:15181/';
async function login(page, username = 'admin') {
  await page.getByPlaceholder('เช่น admin').fill(username);
  await page.getByPlaceholder('กรอกรหัสผ่าน').fill('demo123');
  await page.getByRole('button', { name: /^เข้าสู่ระบบ/ }).click();
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(base); await login(page);
  await page.getByRole('button', { name: /SITE-001/ }).click();
  await page.getByRole('button', { name: 'เครื่องจักร', exact: true }).click();
  await page.locator('.cmms-asset-card').first().click();
  const qr = page.getByRole('region', { name: 'QR เครื่องจักร' });
  await qr.locator('img').waitFor();
  const link = await qr.getByLabel('ลิงก์เครื่องจักร').inputValue();
  assert.equal(new URL(link).origin, new URL(base).origin);
  const download = page.waitForEvent('download');
  await qr.getByRole('link', { name: 'ดาวน์โหลด QR' }).click();
  assert.match((await download).suggestedFilename(), /^asset-qr-.*\.png$/);
  await mkdir('../../outputs/asset-qr-20261009', { recursive: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await qr.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `../../outputs/asset-qr-20261009/${width}.png` });
  }
  for (const scenario of ['valid', 'site-denied', 'missing', 'engineer']) {
    const context = await browser.newContext();
    const p = await context.newPage();
    const url = new URL(link);
    if (scenario === 'site-denied') url.hash = 'asset?site=not-authorized&id=test';
    if (scenario === 'missing') url.hash = 'asset?site=SITE-001&id=not-found';
    await p.goto(url.href);
    assert.equal(await p.locator('.cmms-drawer').count(), 0);
    await login(p, scenario === 'engineer' ? 'engineer' : 'admin');
    if (scenario === 'valid') {
      await p.getByRole('region', { name: 'QR เครื่องจักร' }).locator('img').waitFor();
      assert.equal(await p.getByLabel('ลิงก์เครื่องจักร').inputValue(), link);
    } else if (scenario === 'missing') {
      await p.getByRole('alert').filter({ hasText: 'ไม่พบเครื่องจักรจากลิงก์' }).waitFor();
      assert.equal(await p.locator('.cmms-drawer').count(), 0);
    } else {
      await p.getByText('เปิดเครื่องจักรไม่ได้', { exact: true }).waitFor();
      assert.equal(await p.locator('.cmms-drawer').count(), 0);
      await p.getByRole('button', { name: 'กลับสู่ระบบ', exact: true }).click();
      await p.getByRole('button', { name: /SITE-/ }).first().waitFor();
    }
    await context.close();
  }
  console.log('PASS QR PNG download, login destination, denied site/role, missing asset, 3 responsive widths; isolated Demo only');
} finally { await browser.close(); }
