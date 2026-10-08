// Actual local JWT, fresh viewer fixture; existing synthetic linked records read only.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const target=path.resolve(process.argv[2]),output=path.resolve(process.argv[4]);
assert.match(await readFile(path.join(target,"supabase/config.toml"),"utf8"),/project_id = "thaicon-tor-local"/);
await mkdir(output,{recursive:true});
const status=spawnSync("npx.cmd",["--yes","supabase@2.119.0","status","--workdir",target,"--output","json"],{shell:true,encoding:"utf8"});
assert.equal(status.status,0);
const keys=JSON.parse(status.stdout);assert.equal(keys.API_URL,"http://127.0.0.1:55681");
const selected=spawnSync("docker",["exec","supabase_db_thaicon-tor-local","psql","-U","postgres","-d","postgres","-Atq","-c",
 "select r.id from public.repair_requests r join public.service_reports s on s.id=r.service_report_id and s.jobsite_id=r.jobsite_id and s.asset_id=r.asset_id join public.work_orders w on w.id=s.work_order_id and w.jobsite_id=s.jobsite_id and w.asset_id=s.asset_id where r.jobsite_id='SITE-907' limit 1;"],{encoding:"utf8"});
assert.equal(selected.status,0);const repairId=selected.stdout.trim();assert.match(repairId,/^RR-[a-z0-9-]+$/i);
const operator=createClient(keys.API_URL,keys.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const email=`history_${randomUUID()}@example.invalid`,password=randomUUID()+"Aa1!";
const user=await operator.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username:"history_"+randomUUID().slice(0,8)}});
assert.equal(user.error,null);
assert.equal((await operator.from("user_jobsites").insert({user_id:user.data.user.id,jobsite_id:"SITE-907"})).error,null);
const module=await import(pathToFileURL(process.argv[3]).href);
let server,browser;
try {
 server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","15185","--strictPort"],{env:{...process.env,VITE_SUPABASE_URL:keys.API_URL,VITE_SUPABASE_PUBLISHABLE_KEY:keys.ANON_KEY,VITE_BASE_PATH:"/"},stdio:"ignore"});
 let ready=false;for(let i=0;i<50;i++){assert.equal(server.exitCode,null);try{if((await fetch("http://127.0.0.1:15185/")).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);
 browser=await(module.default??module).chromium.launch({channel:"chrome",headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.goto("http://127.0.0.1:15185/");await page.getByPlaceholder("เช่น admin").fill(email);await page.getByPlaceholder("กรอกรหัสผ่าน").fill(password);
 await page.getByRole("button",{name:/^เข้าสู่ระบบ/}).click();await page.getByRole("button",{name:/SITE-907/}).click();
 await page.locator("nav").getByRole("button",{name:"รายงาน",exact:true}).click();
 const section=page.getByRole("region",{name:"ประวัติและเอกสารเชื่อมโยงของไซต์"});
 await section.getByLabel("ค้นหาเอกสาร",{exact:true}).fill(repairId);
 await section.getByText("ใบงาน 0 ใบ • Service Report 0 ใบ • ใบแจ้งซ่อม 1 ใบ",{exact:true}).waitFor();
 await section.locator("summary").filter({hasText:"เส้นทางใบแจ้งซ่อม"}).click();
 assert.equal(await section.getByText(/พบ นอกตัวกรอง/).count(),2);
 for(const[label,file]of[["ประวัติไซต์ Excel","site-history-online.xlsx"],["ประวัติไซต์ PDF","site-history-online.pdf"]]){
  const download=page.waitForEvent("download");await section.getByRole("button",{name:label,exact:true}).click();await(await download).saveAs(path.join(output,file));
  await section.locator('[aria-busy="false"]').waitFor();
 }
 // A failure of the independent WO source must withhold this combined report,
 // even when the maintenance source succeeded.
 await page.route("**/rest/v1/work_orders?*",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({message:"Synthetic unavailable"})}));
 await page.reload();await page.getByRole("button",{name:/SITE-907/}).click();await page.locator("nav").getByRole("button",{name:"รายงาน",exact:true}).click();
 await section.getByRole("alert").filter({hasText:"ยังโหลดประวัติของไซต์ไม่ครบ"}).waitFor();
 assert.equal(await section.getByRole("button",{name:"ประวัติไซต์ Excel",exact:true}).isDisabled(),true);
 assert.equal(await section.locator("details").count(),0);
 assert.deepEqual(errors,[]);
 console.log("PASS actual User JWT site history: selected repair + verified same-site/machine SR/WO outside filter; XLSX/PDF; independent WO503 hides combined data and disables exports; no gate changes");
} finally {
 if(browser)await browser.close();
 if(server){server.kill();await new Promise(r=>server.exitCode!==null?r():server.once("exit",r));}
}
