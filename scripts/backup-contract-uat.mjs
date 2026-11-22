import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export const sourceUrl = 'https://ddpoeszoedbtibgtqxmu.supabase.co';
const header = Buffer.from('THAICON-UAT-BACKUP-1\n');
const migrationsDir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const limit = 100 * 1024 * 1024;

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function login(url, key, email, password) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('UAT Auth sign-in failed');
  return client;
}

export async function capture(client) {
  const { data, error } = await client.rpc('capture_cmms_backup').abortSignal(AbortSignal.timeout(120000));
  if (error || !data?.tables || !Array.isArray(data.objects)) {
    throw new Error(`Database snapshot failed (${error?.code ?? 'invalid response'})`);
  }
  return data;
}

function loadKey(config) {
  if (!/^[0-9a-f]{64}$/i.test(config.encryptionKey ?? '')) throw new Error('Missing 256-bit backup key');
  return Buffer.from(config.encryptionKey, 'hex');
}

function seal(archive, config) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadKey(config), nonce);
  cipher.setAAD(header);
  const content = Buffer.concat([cipher.update(JSON.stringify(archive), 'utf8'), cipher.final()]);
  return Buffer.concat([header, nonce, cipher.getAuthTag(), content]);
}

export async function readArchive(path, config) {
  const bytes = await readFile(path);
  const offset = header.length;
  if (!bytes.subarray(0, offset).equals(header)) throw new Error('Unsupported backup format');
  const cipher = createDecipheriv('aes-256-gcm', loadKey(config), bytes.subarray(offset, offset + 12));
  cipher.setAAD(header);
  cipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  const archive = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(offset + 28)), cipher.final()]));
  if (archive.source !== sourceUrl) throw new Error('Unexpected backup source');
  return archive;
}

async function backup(config) {
  if (config.url !== sourceUrl || !isAbsolute(config.outputDir ?? '')) {
    throw new Error('Backup requires the approved source UAT and an absolute output directory');
  }
  loadKey(config);
  const client = await login(config.url, config.key, config.email, config.password);
  const capturedAt = new Date().toISOString();
  const snapshot = await capture(client);
  const snapshotJson = JSON.stringify(snapshot);
  let size = Buffer.byteLength(snapshotJson);
  if (size > limit) throw new Error('UAT snapshot exceeds the 100 MiB runner limit');
  const files = [];
  for (const object of snapshot.objects) {
    const expectedSize = object.metadata?.size;
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || size + expectedSize > limit) {
      throw new Error('Invalid size or UAT snapshot exceeds the 100 MiB runner limit');
    }
    const result = await client.storage.from(object.bucket).download(object.path);
    if (result.error) throw new Error('Storage download failed');
    const bytes = Buffer.from(await result.data.arrayBuffer());
    if (bytes.length !== expectedSize) throw new Error('Storage size changed during capture');
    size += bytes.length;
    files.push({ bucket: object.bucket, path: object.path, sha256: sha256(bytes), base64: bytes.toString('base64') });
  }
  const refresh = await capture(client);
  if (JSON.stringify([snapshot.buckets, snapshot.objects]) !== JSON.stringify([refresh.buckets, refresh.objects])) {
    throw new Error('Storage inventory changed during capture. Retry the backup.');
  }
  const migrations = {};
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    migrations[file] = { sha256: sha256(sql), sql };
  }
  await mkdir(config.outputDir, { recursive: true });
  const filename = `cmms-${capturedAt.replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.cmmsbak`;
  const path = join(config.outputDir, filename);
  try {
    await writeFile(`${path}.partial`, seal({ source: sourceUrl, capturedAt, snapshot, files, migrations }, config), { flag: 'wx', mode: 0o600 });
    await rename(`${path}.partial`, path);
  } catch (error) {
    await unlink(`${path}.partial`).catch(() => {});
    throw error;
  }
  console.log(JSON.stringify({ filename, capturedAt, tables: Object.keys(snapshot.tables).length, files: files.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2] || !isAbsolute(process.argv[2])) throw new Error('Supply an absolute private configuration path');
    await backup(JSON.parse(await readFile(process.argv[2], 'utf8')));
  } catch (error) {
    const message = error instanceof SyntaxError ? 'Invalid file format' : error.message;
    console.error(`Backup failed: ${message}`);
    process.exitCode = 1;
  }
}
