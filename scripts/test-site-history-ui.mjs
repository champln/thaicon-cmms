// Synthetic state only in a fresh Demo context. No customer browser or DB.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const module = await import(pathToFileURL(process.argv[2]).href), output = path.resolve(process.argv[3]);
await mkdir(output,{recursive:true});
const browser=await(module.default??module).chromium.launch({channel:"chrome",headless:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.goto("http://127.0.0.1:15181/");
 await page.getByPlaceholder("เช่น admin").fill("admin");await page.getByPlaceholder("กรอกรหัสผ่าน").fill("demo123");
 await page.getByRole("button",{name:/^เข้าสู่ระบบ/}).click();await page.getByRole("button",{name:/SITE-001/}).click();
 await page.evaluate(async()=>{
  const {buildDemoMaintenanceState}=await import("/src/maintenance.ts");
  const maintenance=JSON.parse(localStorage.getItem("thaicon-cmms-maintenance-v3")||"null")??buildDemoMaintenanceState();
  const sr={...maintenance.serviceReports[0],id:"SR-HISTORY-TEST",jobsiteId:"SITE-001",assetId:"CR-DP-02",workOrderId:"WO-HISTORY-TEST",serviceDate:"2026-10-07",workPerformed:"HISTORY-TEST service",status:"approved",quantity:3,attachments:[]};
  const rr={...maintenance.repairRequests[0],id:"RR-HISTORY-TEST",jobsiteId:"SITE-001",assetId:"CR-DP-02",serviceReportId:sr.id,requestedDate:"2026-10-08",title:"HISTORY-TEST repair"};
  maintenance.serviceReports.push(sr);maintenance.repairRequests.push(rr);
  localStorage.setItem("thaicon-cmms-maintenance-v3",JSON.stringify(maintenance));
  const key="thaicon-cmms-demo-operations-v1",operations=JSON.parse(localStorage.getItem(key));
  operations.workOrders.push({...operations.workOrders[0],id:"WO-HISTORY-TEST",jobsiteId:"SITE-001",assetId:"CR-DP-02",title:"HISTORY-TEST job",createdAt:"2026-10-05T17:00:00Z"});
  localStorage.setItem(key,JSON.stringify(operations));
 });
 await page.reload();await page.locator("nav").getByRole("button",{name:"รายงาน",exact:true}).click();
 const section=page.getByRole("region",{name:"ประวัติและเอกสารเชื่อมโยงของไซต์"});
 await section.getByLabel("ค้นหาเอกสาร",{exact:true}).fill("HISTORY-TEST");
 await section.getByText("ใบงาน 1 ใบ • Service Report 1 ใบ • ใบแจ้งซ่อม 1 ใบ",{exact:true}).waitFor({timeout:5000}).catch(async error=>{console.error(await section.innerText());throw error;});
 for(const[label,file]of[["ประวัติไซต์ Excel","site-history-demo.xlsx"],["ประวัติไซต์ PDF","site-history-demo.pdf"]]){
  const download=page.waitForEvent("download");await section.getByRole("button",{name:label,exact:true}).click();await(await download).saveAs(path.join(output,file));
  await section.locator('[aria-busy="false"]').waitFor();
 }
 await section.getByLabel("ประวัติตั้งแต่วันที่").fill("2026-10-08");
 await section.getByLabel("ประวัติถึงวันที่").fill("2026-10-08");
 await section.getByText("ใบงาน 0 ใบ • Service Report 0 ใบ • ใบแจ้งซ่อม 1 ใบ",{exact:true}).waitFor();
 await section.locator("summary").filter({hasText:"เส้นทางใบแจ้งซ่อม"}).click();
 assert.equal(await section.getByText(/พบ นอกตัวกรอง/).count(),2);
 const filtered=page.waitForEvent("download");await section.getByRole("button",{name:"ประวัติไซต์ Excel",exact:true}).click();await(await filtered).saveAs(path.join(output,"site-history-filtered.xlsx"));
 await section.getByLabel("ประวัติถึงวันที่").fill("2026-10-07");await section.getByRole("alert").waitFor();
 assert.equal(await section.getByRole("button",{name:"ประวัติไซต์ Excel",exact:true}).isDisabled(),true);
 await section.getByRole("button",{name:"ล้างตัวกรองประวัติ",exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.ok((await section.getByRole("button",{name:"ประวัติไซต์ Excel",exact:true}).boundingBox()).height>=44);
 await section.scrollIntoViewIfNeeded();await section.screenshot({path:path.join(output,"site-history-mobile.png")});
 const heldContext=await browser.newContext(),heldPage=await heldContext.newPage();
 await heldPage.goto("http://127.0.0.1:15181/");
 await heldPage.getByPlaceholder("เช่น admin").fill("admin");await heldPage.getByPlaceholder("กรอกรหัสผ่าน").fill("demo123");
 await heldPage.getByRole("button",{name:/^เข้าสู่ระบบ/}).click();await heldPage.getByRole("button",{name:/SITE-001/}).click();
 await heldPage.locator("nav").getByRole("button",{name:"รายงาน",exact:true}).click();
 const heldSection=heldPage.getByRole("region",{name:"ประวัติและเอกสารเชื่อมโยงของไซต์"});
 let entered,release,downloads=0;
 const enter=new Promise(r=>{entered=r;}),hold=new Promise(r=>{release=r;});
 heldPage.on("download",()=>downloads++);
 await heldPage.route(/\/src\/excel-export\.ts(?:\?|$)/,async route=>{entered();await hold;await route.continue();});
 await heldSection.getByRole("button",{name:"ประวัติไซต์ Excel",exact:true}).click();await enter;
 await heldSection.getByLabel("ค้นหาเอกสาร",{exact:true}).fill("NO-MATCH");
 release();await heldSection.getByText("ข้อมูล ตัวกรอง หรือสิทธิ์ไซต์เปลี่ยนแล้ว กรุณาส่งออกใหม่",{exact:true}).waitFor();
 assert.equal(downloads,0);
 assert.deepEqual(errors,[]);
 console.log("PASS site history Demo: separate counts, linked chain, filtered external references, invalid range blocks export, XLSX/PDF, mobile and no JS errors");
} finally {await browser.close();}
