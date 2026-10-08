// Synthetic browser PDF: prove every long text character is drawn inside page
// bounds, then render the saved PDF separately for visual QA.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const module=await import(pathToFileURL(process.argv[2]).href),{chromium}=module.default??module;
const output=path.resolve(process.argv[3]);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:"chrome",headless:true});
try{
  const page=await browser.newPage();await page.goto("http://127.0.0.1:5181/");
  const download=page.waitForEvent("download",{timeout:15000});
  const result=await page.evaluate(async()=>{
    const draws=[];const original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){if(x===390)draws.push({text:String(text),y});return original.call(this,text,x,y,...rest);};
    const {downloadMaintenancePdf}=await import("/src/pdf-export.ts");
    const value=("เหตุผลการแก้ไขวัสดุและหลักฐานเดิมต้องคงอยู่ ".repeat(110)).slice(0,4000)+" END-LONG-REASON";
    await downloadMaintenancePdf({filename:"pdf-long-text-check.pdf",documentTitle:"ตรวจข้อความยาว",documentNumber:"WO-00000000-0000-4000-8000-000000000001",subtitle:"ไซต์ทดสอบ — ข้อมูลจำลองเท่านั้น",sections:[{label:"เหตุผลยกเลิก",value}]});
    CanvasRenderingContext2D.prototype.fillText=original;
    return{expected:value.replace(/\s/g,""),drawn:draws.map(d=>d.text).join("").replace(/\s/g,""),inBounds:draws.every(d=>d.y>=80&&d.y<1644),lines:draws.length};
  });
  assert.equal(result.drawn,result.expected);assert.equal(result.inBounds,true);assert.ok(result.lines>45);
  await(await download).saveAs(path.join(output,"pdf-long-text-check.pdf"));
  console.log(`PASS: all long Thai text including end sentinel drawn within page bounds (${result.lines} lines); saved PDF for visual QA`);
}finally{await browser.close();}
