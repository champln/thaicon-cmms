// Read-only fresh Demo contexts, checking computed typography and page overflow.
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const mod=await import(pathToFileURL(process.argv[2]).href),out=path.resolve(process.argv[3]);
await mkdir(out,{recursive:true});
const browser=await(mod.default??mod).chromium.launch({channel:"chrome",headless:true}),results=[];
try{
 for(const width of [1440,768,390,1920]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
  await page.goto("http://127.0.0.1:15181/");
  await page.getByPlaceholder("เช่น admin").fill("admin");await page.getByPlaceholder("กรอกรหัสผ่าน").fill("demo123");
  await page.getByRole("button",{name:/^เข้าสู่ระบบ/}).click();await page.getByRole("button",{name:/SITE-001/}).click();
  const items=await page.locator("nav button").allTextContents();
  for(let i=0;i<items.length;i++){
   // Responsive sidebar is off-canvas; use the app's actual navigation handler.
   await page.locator("nav button").nth(i).evaluate(e=>e.click());
   await page.waitForTimeout(180);
   const metrics=await page.evaluate(()=>{
    const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden";
    const texts=[...document.querySelectorAll("main p,main td,main label,main input,main select")].filter(visible);
    const small=texts.filter(e=>parseFloat(getComputedStyle(e).fontSize)<16).map(e=>({tag:e.tagName,class:e.className,size:getComputedStyle(e).fontSize,text:e.textContent.slice(0,55)}));
    const overflow=document.documentElement.scrollWidth>innerWidth+1;
    const wide=overflow?[...document.querySelectorAll("main *")].filter(visible).filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width})): [];
    return {overflow,small,wide};
   });
   results.push({width,page:items[i].trim(),...metrics});
   if(/ภาพรวม|ใบงาน|เครื่องจักร|รายงาน/.test(items[i]))await page.screenshot({path:path.join(out,width+"-"+i+".png"),fullPage:false});
  }
  await page.locator("nav button").nth(1).evaluate(e=>e.click());
  await page.locator(".wo-export-panel summary").click();
  assert.equal(await page.getByRole("button",{name:"รายงานใบงาน Excel",exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Expanded exports overflow");
  await page.locator(".wo-export-panel summary").click();
  await page.getByRole("button",{name:"สร้างใบงาน",exact:true}).click();
  const modal=page.locator(".cmms-modal");
  await modal.waitFor();
  await page.waitForTimeout(400); // Allow the existing modal entrance transition to settle.
  const formMetrics=await modal.evaluate(e=>({
   overflow:e.scrollWidth>e.clientWidth+1,
   small:[...e.querySelectorAll("input,select,textarea,label")].filter(n=>parseFloat(getComputedStyle(n).fontSize)<16).map(n=>n.tagName)
  }));
  results.push({width,page:"Work order create dialog",...formMetrics});
  await page.screenshot({path:path.join(out,width+"-form.png"),fullPage:false});
  await context.close();
 }
 await writeFile(path.join(out,"metrics.json"),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
 assert.equal(results.some(r=>r.overflow),false,"Page overflow");
 assert.equal(results.some(r=>r.small.length),false,"Body content below16px");
}finally{await browser.close();}
