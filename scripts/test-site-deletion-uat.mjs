import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const [fixturePath, targetConfigPath, evidencePath, playwrightPath] = process.argv.slice(2);
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
const { key } = JSON.parse(await readFile(targetConfigPath, 'utf8'));
const target = 'https://shrvewulyitgonejzcxj.supabase.co';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
assert.equal(fixtures.url, 'https://ddpoeszoedbtibgtqxmu.supabase.co');
assert.notEqual(fixtures.url, target);

async function login(role) {
  const user = fixtures.users.find((entry) => entry.role === role);
  const client = createClient(target, key, options);
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  assert.equal(error, null);
  return { client, user };
}

const { client: admin, user } = await login('admin');
const { client: viewer } = await login('viewer');
const anon = createClient(target, key, options);
const prefix = 'SITE-95' + String(Date.now()).slice(-9);
const mainSite = prefix + '1';
const linkedSite = prefix + '2';
const uiSite = prefix + '3';
const checks = [];

async function addSite(id, active) {
  const result = await admin.from('jobsites').insert({ id, name: 'Synthetic deletion UAT', province: 'Bangkok', site_type: 'test', is_active: active });
  assert.equal(result.error, null);
}

const prepare = (client, id) => client.rpc('prepare_site_deletion', { p_site: id });
const remove = (client, id, backup) => client.rpc('delete_closed_site', { p_site: id, p_backup: backup });
const getBackup = (client, id) => client.rpc('read_site_deletion_backup', { p_backup: id });
const change = (id, values) => admin.from('jobsites').update(values).eq('id', id);
const findSite = async (id) => {
  const { data, error } = await admin.from('jobsites').select('id').eq('id', id).maybeSingle();
  assert.equal(error, null);
  return data;
};

await addSite(mainSite, true);
assert.equal((await prepare(admin, mainSite)).error?.code, 'TS001');
assert.equal((await remove(admin, mainSite, randomUUID())).error?.code, 'TS001');
assert.equal((await admin.from('jobsites').delete().eq('id', mainSite)).error?.code, '42501');
assert.equal((await change(mainSite, { is_active: false })).error, null);
assert.equal((await prepare(viewer, mainSite)).error?.code, '42501');
assert.ok((await prepare(anon, mainSite)).error);
assert.equal((await remove(admin, mainSite, randomUUID())).error?.code, 'TS003');
checks.push('active site, direct DELETE, unauthorized account and missing backup blocked');

const old = await prepare(admin, mainSite);
assert.equal(old.error, null);
assert.equal((await change(mainSite, { name: 'Synthetic deletion UAT updated' })).error, null);
assert.equal((await remove(admin, mainSite, old.data)).error?.code, 'TS003');
const prepared = await prepare(admin, mainSite);
assert.equal(prepared.error, null);
const archived = await getBackup(admin, prepared.data);
assert.equal(archived.error, null);
assert.equal(archived.data.backup.site.id, mainSite);
assert.equal(archived.data.backup.site.is_active, false);
assert.match(archived.data.sha256, /^[a-f0-9]{64}$/);
assert.equal((await getBackup(viewer, prepared.data)).error?.code, '42501');
assert.equal((await remove(viewer, mainSite, prepared.data)).error?.code, '42501');
assert.deepEqual(await findSite(mainSite), { id: mainSite });
checks.push('stale backup rejected and committed backup verified before delete');

await addSite(linkedSite, false);
const beforeReference = await prepare(admin, linkedSite);
assert.equal(beforeReference.error, null);
assert.equal((await remove(admin, linkedSite, prepared.data)).error?.code, 'TS003');
const link = await admin.from('asset_locations').insert({
  id: randomUUID(), jobsite_id: linkedSite, building: 'UAT', floor: '1', room: 'Dependency',
});
assert.equal(link.error, null);
assert.equal((await prepare(admin, linkedSite)).error?.code, 'TS002');
assert.equal((await remove(admin, linkedSite, beforeReference.data)).error?.code, 'TS002');
assert.deepEqual(await findSite(linkedSite), { id: linkedSite });
checks.push('wrong-site backup and new dependent row rejected');

const deletion = await remove(admin, mainSite, prepared.data);
assert.equal(deletion.error, null);
assert.equal(deletion.data, true);
assert.equal(await findSite(mainSite), null);
assert.equal((await remove(admin, mainSite, prepared.data)).data, true);
assert.deepEqual((await getBackup(admin, prepared.data)).data, archived.data);
const log = await admin.rpc('list_site_audit', { p_site: null });
assert.equal(log.error, null);
const deleted = log.data.filter((row) => row.record_id === prepared.data && row.action === 'site_permanently_deleted');
assert.equal(deleted.length, 1);
assert.equal(deleted[0].actor_id, user.id);
assert.equal(deleted[0].entity, mainSite);
checks.push('successful delete, retained backup, named audit actor and idempotent retry');

if (playwrightPath) {
  await addSite(uiSite, false);
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  const port = '15205';
  const url = `http://127.0.0.1:${port}/`;
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'], {
    env: { ...process.env, VITE_SUPABASE_URL: target, VITE_SUPABASE_PUBLISHABLE_KEY: key, VITE_BASE_PATH: '/', VITE_CONTRACT_UAT_DIRECTORY: 'true' },
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Vite startup timeout')), 15000);
      server.once('error', reject);
      server.once('exit', (code) => reject(new Error(`Vite exited ${code}`)));
      server.stdout.on('data', (chunk) => {
        if (chunk.toString().includes(url)) { clearTimeout(timeout); resolve(); }
      });
    });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByPlaceholder('เช่น admin').fill(user.email);
    await page.getByPlaceholder('กรอกรหัสผ่าน').fill(user.password);
    await page.getByRole('button', { name: /^เข้าสู่ระบบ/ }).click();
    await page.getByRole('button', { name: /SITE-901/ }).click();
    await page.getByRole('navigation',{name:'เมนูหลัก'}).getByRole('button', { name: 'จัดการไซต์', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: uiSite });
    await row.getByRole('button', { name: 'ลบถาวร', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'ลบไซต์ถาวร' });
    assert.equal(await dialog.getByRole('button', { name: 'ยืนยันลบถาวร' }).count(), 0);
    await dialog.getByRole('button', { name: 'ตรวจสอบและสำรอง' }).click();
    await dialog.getByText(/สำรองข้อมูลแล้ว/).waitFor();
    const submit = dialog.getByRole('button', { name: 'ยืนยันลบถาวร' });
    assert.equal(await submit.isEnabled(), false);
    await dialog.getByRole('textbox').fill(uiSite);
    await submit.click();
    await dialog.waitFor({ state: 'hidden' });
    await row.waitFor({ state: 'hidden' });
    const panel = page.getByRole('region', { name: 'ประวัติและสำรองข้อมูล' });
    await panel.getByLabel('ขอบเขตประวัติ').selectOption('global');
    const auditRow = panel.getByRole('row').filter({ hasText: uiSite });
    const downloading = page.waitForEvent('download');
    await auditRow.getByRole('button', { name: 'ดาวน์โหลดไฟล์สำรองก่อนลบ' }).click();
    const file = await downloading;
    const snapshot = JSON.parse(await readFile(await file.path(), 'utf8'));
    assert.equal(snapshot.backup.site.id, uiSite);
    assert.equal(await findSite(uiSite), null);
    assert.deepEqual(errors, []);
    checks.push('Chrome confirmed deletion and downloaded archived JSON from system audit');
  } finally {
    await browser?.close();
    server.kill();
  }
}

const evidence = { result: 'pass', project: new URL(target).hostname, date: new Date().toISOString(), checks };
await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
