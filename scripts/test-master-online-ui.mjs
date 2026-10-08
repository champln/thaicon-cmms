// Isolated synthetic fixtures only; no Production or feature-gate changes.
// Usage: node scripts/test-master-online-ui.mjs <isolated-dir> <playwright-module> <output-dir>
import { spawn, spawnSync } from "node:child_process";
import { randomUUID, randomInt } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const target = path.resolve(process.argv[2]), output = path.resolve(process.argv[4]);
assert.match(await readFile(path.join(target, "supabase/config.toml"), "utf8"), /project_id = "thaicon-tor-local"/);
await mkdir(output, { recursive: true });
const status = spawnSync("npx.cmd", ["--yes", "supabase@2.119.0", "status", "--workdir", target, "--output", "json"], { shell: true, encoding: "utf8" });
assert.equal(status.status, 0);
const keys = JSON.parse(status.stdout);
assert.equal(keys.API_URL, "http://127.0.0.1:55681");
const container = "supabase_db_thaicon-tor-local";
assert.equal(spawnSync("docker", ["inspect", container, "--format", "{{.Name}}"], { encoding: "utf8" }).stdout.trim(), "/" + container);
function sql(input) {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], { input, encoding: "utf8" });
  if (result.status !== 0) throw Error("Isolated SQL fixture failed");
  return result.stdout.trim();
}
const operator = createClient(keys.API_URL, keys.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomUUID().slice(0, 8), site = "SITE-" + randomInt(1000000, 9999999);
const email = `master_${suffix}@example.invalid`, password = randomUUID() + "Aa1!";
const created = await operator.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: "master_" + suffix, display_name: "Master pagination fixture" } });
assert.equal(created.error, null);
const userId = created.data.user.id;
sql(`insert into public.jobsites(id,name,province,site_type) values('${site}','Master pagination ${suffix}','Test','Test');
  insert into public.user_jobsites(user_id,jobsite_id) values('${userId}','${site}');
  insert into public.assets(id,jobsite_id,name,asset_type,location)
    select 'MP-${suffix}-'||lpad(n::text,4,'0'),'${site}','Pagination Asset '||lpad(n::text,4,'0'),'AC','Test' from generate_series(0,1000) n;
  insert into public.asset_locations(id,jobsite_id,building,floor,room)
    select gen_random_uuid(),'${site}','Building','1',lpad(n::text,4,'0') from generate_series(0,1000) n;`);
sql(`update public.assets set manufacturer='Fixture Manufacturer',model='=MODEL-LITERAL',serial_number='SN-FINAL-1000' where jobsite_id='${site}' and id='MP-${suffix}-1000';`);
let server, browser;
try {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5183", "--strictPort"], {
    env: { ...process.env, VITE_SUPABASE_URL: keys.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: keys.ANON_KEY, VITE_BASE_PATH: "/" }, stdio: "ignore",
  });
  let ready = false;
  for (let n = 0; n < 50; n++) {
    if (server.exitCode !== null) throw Error("Separate Vite exited");
    try { if ((await fetch("http://127.0.0.1:5183/")).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready);
  const module = await import(pathToFileURL(process.argv[3]).href);
  browser = await (module.default ?? module).chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  let fail = true, hold = false, release = () => {}, intercepted = () => {};
  let held = new Promise(resolve => { intercepted = resolve; });
  const pagesSeen = { assets: new Set(), asset_locations: new Set() };
  await page.route("**/rest/v1/assets?**", async route => {
    const start = Number(new URL(route.request().url()).searchParams.get("offset") ?? 0);
    pagesSeen.assets.add(start);
    if (start === 200 && hold) { intercepted(); await new Promise(resolve => { release = resolve; }); }
    if (start === 200 && fail) await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Synthetic later page outage"}' });
    else await route.continue();
  });
  page.on("request", request => {
    if (request.url().includes("/rest/v1/asset_locations?")) pagesSeen.asset_locations.add(Number(new URL(request.url()).searchParams.get("offset") ?? 0));
  });
  await page.goto("http://127.0.0.1:5183/");
  await page.getByPlaceholder("เช่น admin").fill(email);
  await page.getByPlaceholder("กรอกรหัสผ่าน").fill(password);
  await page.getByRole("button", { name: /^เข้าสู่ระบบ/ }).click();
  await page.getByRole("button", { name: "ลองโหลดอีกครั้ง", exact: true }).waitFor();
  assert.equal(await page.locator(".site-option").count(), 0);
  assert.equal(await page.locator(".cmms-asset-card").count(), 0);
  await page.screenshot({ path: path.join(output, "master-later-page-unavailable.png"), fullPage: true });
  fail = false;
  await page.getByRole("button", { name: "ลองโหลดอีกครั้ง", exact: true }).click();
  const siteOption = page.getByRole("button", { name: new RegExp(site) });
  await siteOption.waitFor();
  assert.equal(await siteOption.locator("dd").nth(0).innerText(), "1001");
  assert.equal(await siteOption.locator("dd").nth(1).innerText(), "—");
  assert.equal(await siteOption.locator("dd").nth(2).innerText(), "—");
  assert.ok(pagesSeen.assets.has(1000) && pagesSeen.asset_locations.has(1000));
  await siteOption.click();
  await page.locator("nav").getByRole("button", { name: "เครื่องจักร", exact: true }).click();
  await page.getByPlaceholder("ค้นหารหัส ชื่อ รุ่น Serial หรือตำแหน่ง").fill("Pagination Asset 1000");
  await page.locator(".cmms-asset-card").filter({ hasText: "MP-" + suffix + "-1000" }).waitFor();
  await page.locator(".cmms-asset-card").click();
  for (const [label, filename] of [["ประวัติเครื่องจักร Excel", "asset-history-online.xlsx"], ["ประวัติเครื่องจักร PDF", "asset-history-online.pdf"]]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    await (await download).saveAs(path.join(output, filename));
    await page.waitForFunction(() => document.querySelector('[aria-label="ส่งออกประวัติเครื่องจักร"]')?.getAttribute("aria-busy") === "false");
  }
  await page.locator(".cmms-drawer").getByRole("button", { name: "ปิด", exact: true }).click();
  for (const [label, filename] of [["ทะเบียนเครื่องจักร Excel", "asset-register-online.xlsx"], ["ทะเบียนเครื่องจักร PDF", "asset-register-online.pdf"]]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    await (await download).saveAs(path.join(output, filename));
    await page.waitForFunction(() => document.querySelector('[aria-label="ส่งออกทะเบียนเครื่องจักร"]')?.getAttribute("aria-busy") === "false");
  }
  await page.screenshot({ path: path.join(output, "master-final-page-search.png"), fullPage: true });
  // Failure after a confirmed load must not replace it with empty-success data.
  fail = true;
  await page.reload();
  await page.getByRole("button", { name: "ลองโหลดอีกครั้ง", exact: true }).waitFor();
  assert.equal(await page.locator(".site-option").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(output, "master-recovery-mobile.png"), fullPage: true });
  // A response arriving after logout cannot restore cached identity/site data.
  fail = false; hold = true;
  held = new Promise(resolve => { intercepted = resolve; });
  await page.getByRole("button", { name: "ลองโหลดอีกครั้ง", exact: true }).click();
  await held;
  await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await page.getByRole("heading", { name: "เข้าสู่ระบบ", exact: true }).waitFor();
  hold = false; release();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".site-option").count(), 0);
  assert.equal(await page.getByRole("heading", { name: "เข้าสู่ระบบ", exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log("PASS: actual JWT 1001 assets/locations; final-page search; later-page failure withheld; retry confirmed counts/unknown metrics; mobile recovery; late reply after logout discarded. Synthetic fixtures retained; gates untouched.");
} catch (error) {
  console.error("FAIL master UI:", error.message);
  throw error;
} finally {
  await browser?.close();
  server?.kill();
  operator.realtime.disconnect();
}
