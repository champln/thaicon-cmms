// Fresh Demo contexts only; no customer storage or remote writes.
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const module = await import(pathToFileURL(process.argv[2]).href);
const output = path.resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const browser = await (module.default ?? module).chromium.launch({ channel: "chrome", headless: true });
try {
  const errors = [];
  async function open() {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })).newPage();
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("http://127.0.0.1:5181/");
    await page.getByPlaceholder("เช่น admin").fill("admin");
    await page.getByPlaceholder("กรอกรหัสผ่าน").fill("demo123");
    await page.getByRole("button", { name: /^เข้าสู่ระบบ/ }).click();
    await page.getByRole("button", { name: /SITE-001/ }).click();
    await page.locator("nav").getByRole("button", { name: "เครื่องจักร", exact: true }).click();
    return page;
  }
  const page = await open();
  await page.getByLabel("ค้นหาเครื่องจักร", { exact: true }).fill("CR-DP-02");
  assert.equal(await page.locator(".cmms-asset-card").count(), 1);
  await page.locator(".cmms-asset-card").click();
  for (const [label, filename] of [["ประวัติเครื่องจักร Excel", "asset-history-demo.xlsx"], ["ประวัติเครื่องจักร PDF", "asset-history-demo.pdf"]]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    await (await download).saveAs(path.join(output, filename));
    await page.waitForFunction(() => document.querySelector('[aria-label="ส่งออกประวัติเครื่องจักร"]')?.getAttribute("aria-busy") === "false");
  }
  await page.locator(".cmms-drawer").getByRole("button", { name: "ปิด", exact: true }).click();
  for (const [label, filename] of [["ทะเบียนเครื่องจักร Excel", "asset-register-demo.xlsx"], ["ทะเบียนเครื่องจักร PDF", "asset-register-demo.pdf"]]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    await (await download).saveAs(path.join(output, filename));
    await page.waitForFunction(() => document.querySelector('[aria-label="ส่งออกทะเบียนเครื่องจักร"]')?.getAttribute("aria-busy") === "false");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.ok((await page.getByRole("button", { name: "ทะเบียนเครื่องจักร Excel", exact: true }).boundingBox()).height >= 44);
  await page.screenshot({ path: path.join(output, "asset-report-mobile.png"), fullPage: true });
  await page.locator(".cmms-asset-card").click();
  await page.waitForTimeout(500); // Let the existing drawer transition settle.
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator(".cmms-drawer").evaluate(e => e.scrollWidth > e.clientWidth), false);
  assert.ok((await page.getByRole("button", { name: "ประวัติเครื่องจักร Excel", exact: true }).boundingBox()).height >= 44);
  await page.screenshot({ path: path.join(output, "asset-history-mobile.png"), fullPage: true });
  await page.locator(".cmms-drawer").getByRole("button", { name: "ปิด", exact: true }).click();
  const heldPage = await open();
  let entered, release, downloads = 0;
  const enter = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
  heldPage.on("download", () => downloads++);
  await heldPage.route(/\/src\/excel-export\.ts(?:\?|$)/, async route => { entered(); await hold; await route.continue(); });
  await heldPage.getByRole("button", { name: "ทะเบียนเครื่องจักร Excel", exact: true }).click();
  await enter;
  await heldPage.getByLabel("ค้นหาเครื่องจักร", { exact: true }).fill("NO-MATCH");
  release();
  await heldPage.getByText("ข้อมูล ตัวกรอง หรือสิทธิ์ไซต์เปลี่ยนแล้ว กรุณาส่งออกใหม่", { exact: true }).waitFor();
  assert.equal(downloads, 0);
  assert.equal(await heldPage.locator(".cmms-asset-card").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS Demo asset register filtered XLSX/PDF downloads, unknown metadata, mobile no overflow, stale async export cancelled after filter change, no JS errors. Not online JWT evidence.");
} finally { await browser.close(); }
