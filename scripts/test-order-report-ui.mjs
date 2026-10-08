// Fresh Demo contexts only. No user browser state or Supabase writes.
// Usage: node scripts/test-order-report-ui.mjs <playwright-module> <output-dir>
import { pathToFileURL } from "node:url";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const module = await import(pathToFileURL(process.argv[2]).href);
const output = path.resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const browser = await (module.default ?? module).chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:5181/");
  await page.getByPlaceholder("เช่น admin").fill("admin");
  await page.getByPlaceholder("กรอกรหัสผ่าน").fill("demo123");
  await page.getByRole("button", { name: /^เข้าสู่ระบบ/ }).click();
  await page.getByRole("button", { name: /SITE-001/ }).click();
  await page.locator("nav").getByRole("button", { name: "ใบงาน", exact: true }).click();
  await page.getByRole("button", { name: "สร้างใบงาน", exact: true }).click();
  const modal = page.locator(".cmms-modal");
  await modal.getByLabel("ชื่องาน", { exact: true }).fill("=REPORT-UI-LITERAL");
  await modal.getByLabel("กำหนดเสร็จ", { exact: true }).fill("Display label only");
  await modal.getByLabel("วันและเวลากำหนดเสร็จ (เวลาไทย)", { exact: true }).fill("2026-10-07T16:00");
  await modal.getByRole("button", { name: "สร้างใบงาน", exact: true }).click();
  await page.getByLabel("ค้นหาใบงาน", { exact: true }).fill("=REPORT-UI-LITERAL");
  await page.getByRole("row").filter({ hasText: "=REPORT-UI-LITERAL" }).waitFor();
  for (const [label, filename] of [["รายงานใบงาน Excel", "order-summary.xlsx"], ["รายงานใบงาน PDF", "order-summary.pdf"]]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    await (await download).saveAs(path.join(output, filename));
    await page.getByRole("button", { name: label, exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector('[aria-label="ส่งออกรายงานใบงานตามตัวกรอง"]')?.getAttribute("aria-busy")?.includes("true"));
  }
  const excel = await readFile(path.join(output, "order-summary.xlsx")), pdf = await readFile(path.join(output, "order-summary.pdf"));
  assert.equal(excel.subarray(0, 2).toString(), "PK");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500); // Allow the existing responsive sidebar transition to settle.
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(output, "order-report-mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: Demo structured Bangkok due input, filtered report XLSX/PDF downloads, literal title, mobile no overflow, no JS errors. Not actual-JWT online evidence.");
} finally { await browser.close(); }
