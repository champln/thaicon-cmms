// Fresh headless context; no user browser, credentials or URL logging.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { syntheticPhoto } from './synthetic-photo.mjs';
export async function checkPdfPhotos(playwrightPath, output, signedUrl) {
  const png=syntheticPhoto;
  const server=createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');
    if(req.url==='/photo.png'){res.setHeader('Content-Type','image/png');res.end(png);}
    else{res.statusCode=404;res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const module=await import(pathToFileURL(playwrightPath).href),{chromium}=module.default??module;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    await mkdir(output,{recursive:true});
    const page=await browser.newPage();await page.goto('http://127.0.0.1:5181/');
    for(const [label,src] of [['cors',url+'/photo.png'],...(signedUrl?[['signed-storage',signedUrl]]:[])]) {
      const download=page.waitForEvent('download',{timeout:20000});
      const draws=await page.evaluate(async({src,label})=>{
        const {downloadMaintenancePdf}=await import('/src/pdf-export.ts');
        let drawn=0;const original=CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage=function(...args){drawn++;return original.apply(this,args);};
        try{await downloadMaintenancePdf({filename:`pdf-photo-${label}.pdf`,documentTitle:'ตรวจภาพหลักฐาน',documentNumber:'SYNTHETIC-ONLY',subtitle:'ภาพทดสอบ ไม่ใช่ข้อมูลลูกค้า',sections:[],photos:[{name:'ภาพหลักฐานทดสอบ',dataUrl:src}]});}
        finally{CanvasRenderingContext2D.prototype.drawImage=original;}
        return drawn;
      },{src,label});
      assert.ok(draws>=1);
      await(await download).saveAs(path.join(output,`pdf-photo-${label}.pdf`));
      console.log(`PASS: ${label} photo draws into downloadable PDF without canvas taint`);
    }
    let downloads=0;page.on('download',()=>downloads++);
    const message=await page.evaluate(async src=>{
      const {downloadMaintenancePdf}=await import('/src/pdf-export.ts');
      try{await downloadMaintenancePdf({filename:'must-not-exist.pdf',documentTitle:'Missing',documentNumber:'Test',subtitle:'Test',sections:[],photos:[{name:'Missing',dataUrl:src}]});return '';}
      catch(error){return error.message;}
    },url+'/missing.png');
    assert.match(message,/โหลดภาพหลักฐานไม่สำเร็จ/);assert.equal(downloads,0);
    console.log('PASS: missing photo rejects export with reload/retry guidance; no incomplete PDF downloaded');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
