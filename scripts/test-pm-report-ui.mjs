// Fresh Demo browser only. No remote writes or customer browser storage.
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const module = await import(pathToFileURL(process.argv[2]).href);
const output = path.resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const browser = await (module.default ?? module).chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:5181/");
  await page.getByPlaceholder("เช่น admin").fill("admin");
  await page.getByPlaceholder("กรอกรหัสผ่าน").fill("demo123");
  await page.getByRole("button", { name: /^เข้าสู่ระบบ/ }).click();
  await page.getByRole("button", { name: /SITE-001/ }).click();
  await page.locator("nav").getByRole("button", { name: "รายงาน", exact: true }).click();
  await page.getByRole("heading", { name: "สรุป Plan เทียบ Actual", exact: true }).waitFor();
  await page.getByLabel("เดือน", { exact: true }).selectOption("10");
  assert.equal(await page.locator(".maint-report-kpis").getByText("ไม่ประเมิน", { exact: true }).count(), 1);
  for (const [label, filename] of [["ดาวน์โหลด Excel", "pm-performance.xlsx"], ["ดาวน์โหลด PDF", "pm-performance.pdf"]]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    await (await download).saveAs(path.join(output, filename));
    await page.waitForFunction(() => document.querySelector('[aria-label="ส่งออกรายงาน PM"]')?.getAttribute("aria-busy") === "false");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(output, "pm-report-mobile.png"), fullPage: true });
  await page.getByLabel("เดือน", { exact: true }).selectOption("all");
  assert.equal(await page.locator(".maint-report-kpis").getByText("ไม่ประเมิน", { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  // Hold first dynamic export import in a separate context, then change filters.
  // No customer browser data touched; the old model must never emit a file.
  const delayedPage = await (await browser.newContext({ acceptDownloads: true })).newPage();
  delayedPage.on("pageerror", e => errors.push(e.message));
  await delayedPage.goto("http://127.0.0.1:5181/");
  await delayedPage.getByPlaceholder("เช่น admin").fill("admin");
  await delayedPage.getByPlaceholder("กรอกรหัสผ่าน").fill("demo123");
  await delayedPage.getByRole("button", { name: /^เข้าสู่ระบบ/ }).click();
  await delayedPage.getByRole("button", { name: /SITE-001/ }).click();
  await delayedPage.locator("nav").getByRole("button", { name: "รายงาน", exact: true }).click();
  let enter, release, downloads = 0;
  const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
  delayedPage.on("download", () => downloads++);
  await delayedPage.route(/\/src\/excel-export\.ts(?:\?|$)/, async route => { enter(); await held; await route.continue(); });
  await delayedPage.getByRole("button", { name: "ดาวน์โหลด Excel", exact: true }).click();
  await entered;
  await delayedPage.getByLabel("เดือน", { exact: true }).selectOption("10");
  release();
  await delayedPage.getByText("ข้อมูล ตัวกรอง หรือขอบเขตเปลี่ยนแล้ว กรุณาส่งออกรายงานใหม่", { exact: true }).waitFor();
  await delayedPage.waitForTimeout(300);
  assert.equal(downloads, 0);
  assert.deepEqual(errors, []);
  console.log("PASS Demo PM monthly scope, non-assessed percentage, XLSX/PDF downloads, year reset, mobile overflow, delayed export cancelled after filter change, no JS errors. Not actual-JWT evidence.");
} finally { await browser.close(); }
