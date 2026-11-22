import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const config=JSON.parse(await readFile(process.argv[3],'utf8'));
const output=process.argv[4];
assert.equal(config.url,'https://ddpoeszoedbtibgtqxmu.supabase.co');
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const admin=config.users.find(user=>user.role==='admin');
const viewer=config.users.find(user=>user.role==='viewer');
async function login(user){
  const client=createClient(config.url,config.key,opts);
  const {data,error}=await client.auth.signInWithPassword({email:user.email,password:user.password});
  assert.ok(data.session && !error,error?.message);
  return client;
}
const [owner,reader]=await Promise.all([login(admin),login(viewer)]);
const anon=createClient(config.url,config.key,opts);
const fixture='SITE-93'+String(Date.now()).slice(-8);
const {error:created}=await owner.from('jobsites').insert({id:fixture,name:'UAT audit fixture',province:'Bangkok',site_type:'test'});
assert.equal(created,null);
const {error:changed}=await owner.from('jobsites').update({name:'UAT audit modified',is_active:false}).eq('id',fixture);
assert.equal(changed,null);
const {error:remove}=await owner.from('jobsites').delete().eq('id',fixture);
assert.equal(remove?.code,'42501');
const fixtureLog=await owner.rpc('list_site_audit',{p_site:fixture});
assert.equal(fixtureLog.error,null);
assert.deepEqual(fixtureLog.data.map(row=>row.action),['update','insert']);
assert.deepEqual(fixtureLog.data[0].changed_fields,['is_active','name']);
assert.ok(fixtureLog.data.every(row=>row.actor_id===admin.id && row.jobsite_id===fixture));
assert.equal((await reader.rpc('list_site_audit',{p_site:'SITE-901'})).error?.code,'42501');
assert.equal((await reader.rpc('list_site_audit',{p_site:null})).error?.code,'42501');
assert.equal((await reader.rpc('begin_site_backup',{p_site:'SITE-901'})).error?.code,'42501');
assert.ok((await anon.rpc('begin_site_backup',{p_site:'SITE-901'})).error);

const url='http://127.0.0.1:15196/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','15196','--strictPort'],{
  env:{...process.env,VITE_SUPABASE_URL:config.url,VITE_SUPABASE_PUBLISHABLE_KEY:config.key,VITE_BASE_PATH:'/',VITE_CONTRACT_UAT_DIRECTORY:'true'},
});
let browser;
try {
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Vite startup timeout')),15000);
    server.once('error',reject);
    server.once('exit',code=>reject(Error('Vite exited '+code)));
    server.stdout.on('data',chunk=>{if(chunk.toString().includes(url)){clearTimeout(timeout);resolve();}});
  });
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({acceptDownloads:true});
  const page=await context.newPage();
  page.setDefaultTimeout(15000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.getByPlaceholder('เช่น admin').fill(admin.email);
  await page.getByPlaceholder('กรอกรหัสผ่าน').fill(admin.password);
  await page.getByRole('button',{name:/^เข้าสู่ระบบ/}).click();
  await page.getByRole('button',{name:/SITE-901/}).click();
  await page.getByRole('navigation',{name:'เมนูหลัก'}).getByRole('button',{name:'จัดการไซต์',exact:true}).click();
  const panel=page.getByRole('region',{name:'ประวัติและสำรองข้อมูล'});
  const start=panel.getByRole('button',{name:'ดาวน์โหลดไฟล์สำรองไซต์นี้'});
  const pending=page.waitForEvent('download',{timeout:30000});
  await start.click();
  const file=await pending;
  await mkdir(output,{recursive:true});
  const filePath=path.join(output,'site-901.private.json');
  await file.saveAs(filePath);
  const bytes=await readFile(filePath);
  const bundle=JSON.parse(bytes);
  assert.equal(bundle.site,'SITE-901');
  assert.equal(bundle.format,'thaicon-site-backup-v1');
  assert.deepEqual(bundle.tables.jobsites.map(row=>row.id),['SITE-901']);
  for(const rows of Object.values(bundle.tables)) assert.ok(rows.every(row=>!('jobsite_id' in row)||row.jobsite_id==='SITE-901'));
  assert.ok(!bytes.includes(Buffer.from(fixture)));
  assert.ok(bundle.tables.contract_deliveries.length>0 && bundle.tables.contract_deliveries.every(row=>row.pdf.startsWith('\\x255044462d')));
  assert.ok(bundle.files.length>0);
  for(const photo of bundle.files){
    assert.ok(photo.path.startsWith('SITE-901/'));
    const content=Buffer.from(photo.base64,'base64');
    assert.equal(content.length,photo.bytes);
    assert.equal(createHash('sha256').update(content).digest('hex'),photo.sha256);
  }
  assert.ok(bundle.tables.service_report_attachments.every(row=>bundle.files.some(file=>file.path===row.storage_path)));
  const contacts=await owner.rpc('list_site_audit',{p_site:'SITE-901'});
  assert.equal(contacts.error,null);
  const backupEvents=contacts.data.filter(row=>row.record_id===bundle.id);
  assert.deepEqual(backupEvents.map(row=>row.action),['backup_prepared','backup_started']);
  assert.ok(backupEvents.every(row=>row.actor_id===admin.id));
  const sha256=createHash('sha256').update(bytes).digest('hex');
  await panel.getByText('SHA-256 '+sha256,{exact:true}).waitFor();
  let failedDownload=false;
  page.on('download',()=>{failedDownload=true;});
  await page.route(url=>url.origin===config.url && url.pathname.startsWith('/storage/v1/object/') &&
    url.pathname.includes('/service-report-photos/'),route=>route.abort());
  await start.click();
  await panel.getByRole('alert').getByText('ดาวน์โหลดรูปแนบไม่ครบ กรุณาลองสำรองอีกครั้ง',{exact:true}).waitFor();
  assert.equal(failedDownload,false);
  const interrupted=await owner.rpc('list_site_audit',{p_site:'SITE-901'});
  assert.equal(interrupted.error,null);
  const newest=interrupted.data.find(row=>row.entity==='site_backup');
  assert.equal(newest.action,'backup_started');
  assert.ok(!interrupted.data.some(row=>row.record_id===newest.record_id && row.action==='backup_prepared'));
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'results.json'),JSON.stringify({
    site:bundle.site,id:bundle.id,sha256,bytes:bytes.length,tableCount:Object.keys(bundle.tables).length,
    photoCount:bundle.files.length,deliveryCount:bundle.tables.contract_deliveries.length,
    checks:['Admin create/update audit with actual actor','Direct delete denied','Non-admin backup and audit denied',
      'Chrome download','Other site excluded','All photo hashes and metadata matched','Archived PDF bytes included','Backup requested/prepared logged',
      'Interrupted photo download produces no file or prepared receipt'],
  },null,2));
  console.log('PASS site audit and downloaded backup',bundle.site,Object.keys(bundle.tables).length,bundle.files.length,sha256);
} finally {
  await browser?.close();
  server.kill();
}
