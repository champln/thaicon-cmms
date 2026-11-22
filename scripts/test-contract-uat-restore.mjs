import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { capture, login, readArchive, sha256, sourceUrl } from './backup-contract-uat.mjs';

const target = 'https://shrvewulyitgonejzcxj.supabase.co';
const [archivePath, backupConfigPath, targetConfigPath, fixturePath, evidencePath] = process.argv.slice(2);
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function rpc(client, name, params) {
  const { data, error } = await client.rpc(name, params).abortSignal(AbortSignal.timeout(120000));
  if (error) throw new Error(`${name} failed (${error.code})${['P0001','21000'].includes(error.code) ? ': ' + error.message : ''}`);
  return data;
}

async function verifyFiles(client, files, objects, upload) {
  for (const file of files) {
    const object = objects.find((item) => item.bucket === file.bucket && item.path === file.path);
    const bytes = Buffer.from(file.base64, 'base64');
    assert.ok(object && bytes.length === object.metadata.size && sha256(bytes) === file.sha256, 'Archive file integrity');
    const bucket = client.storage.from(file.bucket);
    let restored = await bucket.download(file.path);
    if (upload && restored.error) {
      const result = await bucket.upload(file.path, bytes, {
        contentType: object.metadata.mimetype,
        cacheControl: object.metadata.cacheControl?.replace(/^max-age=/, '') || '3600',
        metadata: object.userMetadata ?? undefined,
      });
      if (result.error) throw new Error(`Restore Storage upload failed (${result.error.statusCode})`);
      restored = await bucket.download(file.path);
    }
    assert.ok(!restored.error, 'Restore Storage download');
    assert.ok(sha256(Buffer.from(await restored.data.arrayBuffer())) === file.sha256, 'Restored file SHA-256');
  }
}

function fingerprint(name, rows) {
  if (name !== 'auth.users') return sha256(rows);
  const accounts = JSON.parse(rows).map(({ last_sign_in_at, updated_at, ...account }) => account);
  return sha256(JSON.stringify(accounts));
}

async function main() {
  if (![archivePath, backupConfigPath, targetConfigPath, fixturePath, evidencePath].every((path) => path && isAbsolute(path))) {
    throw new Error('Supply absolute archive, private config, fixture and evidence paths');
  }
  const [backupConfig, targetConfig, fixtures] = await Promise.all([backupConfigPath, targetConfigPath, fixturePath].map(readJson));
  assert.ok(backupConfig.url === sourceUrl && fixtures.url === sourceUrl && target !== sourceUrl, 'Isolated project guard');
  const archive = await readArchive(archivePath, backupConfig);
  const users = Object.fromEntries(fixtures.users.map((user) => [user.role, user]));
  const admin = users.admin;
  const anon = createClient(target, targetConfig.key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (!process.argv.includes('--verify-only') && !process.argv.includes('--files-only')) {
    const denied = await anon.rpc('uat_restore_stage', { p_token: 'invalid', p_position: 0, p_contents: '' });
    assert.equal(denied.error?.code, '42501', 'Restore token gate');
    const payload = Buffer.from(JSON.stringify({ tables: archive.snapshot.tables, files: archive.snapshot.objects })).toString('base64');
    const chunkSize = 250000;
    const count = Math.ceil(payload.length / chunkSize);
    for (let index = 0; index < count; index++) {
      await rpc(anon, 'uat_restore_stage', {
        p_token: targetConfig.token, p_position: index, p_contents: payload.slice(index * chunkSize, (index + 1) * chunkSize),
      });
    }
    const restored = await rpc(anon, 'uat_restore_apply', { p_token: targetConfig.token, p_chunks: count, p_operator: admin.id });
    assert.equal(restored, Object.keys(archive.snapshot.tables).length);
  }

  const operator = await login(target, targetConfig.key, admin.email, admin.password);
  await verifyFiles(operator, archive.files, archive.snapshot.objects, !process.argv.includes('--verify-only'));
  const snapshot = await capture(operator);
  const tables = Object.entries(archive.snapshot.tables);
  let storageRestoreLogs = 0;
  for (const [name, rows] of tables) {
    const actual = snapshot.tables[name];
    if (name === 'private.site_audit_log') {
      const originals = JSON.parse(rows);
      const restoredLogs = JSON.parse(actual);
      const restoredById = new Map(restoredLogs.map((row) => [row.event_id, row]));
      for (const row of originals) {
        assert.deepEqual(restoredById.get(row.event_id), row, 'Original audit event');
        restoredById.delete(row.event_id);
      }
      storageRestoreLogs = restoredById.size;
      assert.equal(storageRestoreLogs, archive.files.length);
      assert.ok([...restoredById.values()].every((row) =>
        row.entity === 'objects' && row.action === 'insert'));
      continue;
    }
    if (typeof actual !== 'string' || fingerprint(name, actual) !== fingerprint(name, rows)) {
      const expectedRows = JSON.parse(rows);
      const actualRows = JSON.parse(actual ?? '[]');
      const fields = [...new Set(expectedRows.flatMap((row, index) => Object.keys(row).filter(
        (key) => JSON.stringify(row[key]) !== JSON.stringify(actualRows[index]?.[key]))))];
      throw new Error(`Restored table fingerprint: ${name} (${expectedRows.length} expected, ${actualRows.length} restored; fields: ${fields.join(', ')})`);
    }
  }
  const bucketConfig = (buckets) => buckets.map(({ id, public: visible, file_size_limit, allowed_mime_types }) =>
    ({ id, visible, file_size_limit, allowed_mime_types }));
  assert.deepEqual(bucketConfig(snapshot.buckets), bucketConfig(archive.snapshot.buckets));
  assert.equal(snapshot.objects.length, archive.files.length);

  const [viewer, foreign, observer] = await Promise.all(['viewer', 'foreign', 'observer'].map((role) =>
    login(target, targetConfig.key, users[role].email, users[role].password)));
  for (const client of [anon, viewer, foreign, observer]) {
    assert.ok((await client.rpc('capture_cmms_backup')).error, 'Ordinary users cannot capture the backup');
  }
  const ownSiteFiles = archive.files.filter((file) => file.path.startsWith('SITE-901/'));
  assert.ok(ownSiteFiles.length, 'Expected SITE-901 test files');
  for (const file of ownSiteFiles) {
    for (const client of [anon, foreign]) {
      assert.ok((await client.storage.from(file.bucket).download(file.path)).error, 'Cross-site Storage download denied');
    }
  }
  const deliveries = JSON.parse(archive.snapshot.tables['private.contract_deliveries']);
  const issued = deliveries.filter((record) => record.jobsite_id === 'SITE-901');
  assert.ok(issued.length, 'Expected test deliveries');
  const listed = await rpc(viewer, 'list_contract_deliveries', { p_site: 'SITE-901' });
  assert.equal(listed.length, issued.length);
  for (const record of issued) {
    for (const format of ['pdf', 'xlsx']) {
      const args = { p_site: record.jobsite_id, p_id: record.id, p_format: format };
      const restoredFile = await rpc(viewer, 'read_contract_delivery_file', args);
      assert.ok(sha256(Buffer.from(restoredFile, 'base64')) === sha256(Buffer.from(record[format].slice(2), 'hex')),
        `Restored issued ${format} SHA-256`);
      assert.equal((await foreign.rpc('read_contract_delivery_file', args)).error?.code, '42501');
      assert.ok((await anon.rpc('read_contract_delivery_file', args)).error);
    }
  }
  const approvals = JSON.parse(archive.snapshot.tables['private.contract_accepted_evidence']);
  const result = {
    result: 'pass', source: new URL(sourceUrl).hostname, target: new URL(target).hostname,
    capturedAt: archive.capturedAt, verifiedAt: new Date().toISOString(), tables: tables.length,
    files: archive.files.length, logins: 4, issuedPdfExcelPairs: issued.length, acceptedEvidenceRows: approvals.length,
    crossSiteAndAnonymousAccess: 'denied for reports and Storage', unauthorizedBackup: 'denied', storageRestoreLogs,
  };
  await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
