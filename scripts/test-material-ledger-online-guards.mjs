import {openGroupedSection} from './open-grouped-section.mjs';
// Isolated local Auth/JWT only. Never points to Production or modifies customer rows.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const target=path.resolve(process.argv[2]);
assert.match(await readFile(path.join(target,"supabase/config.toml"),"utf8"),/project_id = "thaicon-tor-local"/);
const status=spawnSync("npx.cmd",["--yes","supabase@2.119.0","status","--workdir",target,"--output","json"],{shell:true,encoding:"utf8"});
assert.equal(status.status,0);
const keys=JSON.parse(status.stdout);assert.equal(keys.API_URL,"http://127.0.0.1:55681");
const operator=createClient(keys.API_URL,keys.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const material=await operator.from("work_order_materials").select("work_order_id").eq("jobsite_id","SITE-907").limit(1).single();
assert.ok(!material.error && material.data);
const order=await operator.from("work_orders").select("title").eq("id",material.data.work_order_id).single();
assert.ok(!order.error && order.data);
const email=`ledger_guard_${randomUUID()}@example.invalid`,password=randomUUID()+"Aa1!";
const account=await operator.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username:"ledger_"+randomUUID().slice(0,8)}});
assert.ok(!account.error && account.data.user);
const userId=account.data.user.id;
async function assign() { const r=await operator.from("user_jobsites").upsert({user_id:userId,jobsite_id:"SITE-907"});assert.equal(r.error,null); }
await assign();
const module=await import(pathToFileURL(process.argv[3]).href);
let browser,server;
try {
 server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","15184","--strictPort"],{env:{...process.env,VITE_SUPABASE_URL:keys.API_URL,VITE_SUPABASE_PUBLISHABLE_KEY:keys.ANON_KEY,VITE_BASE_PATH:"/"},stdio:"ignore"});
 let ready=false;
 for(let n=0;n<50;n++){assert.equal(server.exitCode,null);try{if((await fetch("http://127.0.0.1:15184/")).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
 assert.ok(ready);
 browser=await(module.default??module).chromium.launch({channel:"chrome",headless:true});
 const context=await browser.newContext(),page=await context.newPage();
 const errors=[];let downloads=0;
 page.on("pageerror",e=>errors.push(e.message));page.on("download",()=>downloads++);
 await page.goto("http://127.0.0.1:15184/");
 await page.getByPlaceholder("เช่น admin").fill(email);await page.getByPlaceholder("กรอกรหัสผ่าน").fill(password);
 await page.getByRole("button",{name:/^เข้าสู่ระบบ/}).click();await page.getByRole("button",{name:/SITE-907/}).click();
 await openGroupedSection(page, "ใบงาน");
 await page.getByLabel("ค้นหาใบงาน",{exact:true}).fill(order.data.title);
 let fail=true;
 await page.route("**/rest/v1/work_order_materials?*",route=>fail?route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({message:"Synthetic outage"})}):route.continue());
 await page.getByRole("button",{name:"รายงานวัสดุ Excel",exact:true}).click();
 await page.locator('[aria-label="ส่งออกรายงานวัสดุตามตัวกรองใบงาน"]').getByRole("alert").waitFor();
 assert.equal(downloads,0);
 assert.equal(await page.getByRole("button",{name:"รายงานวัสดุ Excel",exact:true}).isEnabled(),true);
 fail=false;
 const recovered=page.waitForEvent("download");
 await page.getByRole("button",{name:"รายงานวัสดุ Excel",exact:true}).click();await recovered;
 await page.waitForFunction(()=>document.querySelector('[aria-label="ส่งออกรายงานวัสดุตามตัวกรองใบงาน"]')?.getAttribute("aria-busy")==="false");
 assert.equal(downloads,1);
 let checks=0;
 await page.route("**/rest/v1/rpc/material_ledger_context",async route=>{
  if(++checks===2){const revoked=await operator.from("user_jobsites").delete().eq("user_id",userId).eq("jobsite_id","SITE-907");assert.equal(revoked.error,null);}
  await route.continue();
 });
 await page.getByRole("button",{name:"รายงานวัสดุ Excel",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"ไม่มีสิทธิ์อ่านรายงานวัสดุ"}).waitFor();
 assert.equal(downloads,1);
 assert.equal(checks,2);
 assert.deepEqual(errors,[]);
 console.log("PASS actual-JWT: child503 yields no file and explicit retry recovers; real site assignment revoked after child reads -> final server403 blocks file; no Demo fallback");
} finally {
 await assign(); // Restore only this newly-created synthetic tester's access.
 if(browser)await browser.close();
 if(server){server.kill();await new Promise(r=>server.exitCode!==null?r():server.once("exit",r));}
}
