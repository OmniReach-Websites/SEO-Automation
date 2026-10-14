import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { S3CompatibleBackupStore } from '../infrastructure/backups/s3-compatible.mjs';

const objects = new Map();
const requests = [];
const fetchImpl = async (url, options = {}) => {
  const parsed = new URL(url);
  requests.push({
    authorization: options.headers?.Authorization,
    method: options.method,
    url: parsed.toString(),
  });
  if (!String(options.headers?.Authorization).startsWith('AWS4-HMAC-SHA256 ')) {
    return new Response('', { status: 403 });
  }
  const key = decodeURIComponent(parsed.pathname.replace('/fixture-bucket/', ''));
  if (options.method === 'PUT') {
    objects.set(key, Buffer.from(options.body));
    return new Response('', { status: 200 });
  }
  if (options.method === 'DELETE') {
    objects.delete(key);
    return new Response(null, { status: 204 });
  }
  if (parsed.searchParams.get('list-type') === '2') {
    const contents = [...objects.entries()]
      .map(
        ([name, value]) =>
          `<Contents><Key>${name}</Key><LastModified>2026-10-13T00:00:00Z</LastModified><ETag>&quot;fixture&quot;</ETag><Size>${value.byteLength}</Size></Contents>`,
      )
      .join('');
    return new Response(`<ListBucketResult>${contents}</ListBucketResult>`, { status: 200 });
  }
  const value = objects.get(key);
  return value ? new Response(value, { status: 200 }) : new Response('', { status: 404 });
};

const root = await mkdtemp(join(tmpdir(), 'omnireach-offsite-backup-'));
try {
  const source = join(root, 'fixture.orbk');
  const target = join(root, 'downloaded.orbk');
  await writeFile(source, 'encrypted fixture payload');
  const store = new S3CompatibleBackupStore({
    accessKeyId: 'fixture-access-key',
    bucket: 'fixture-bucket',
    endpoint: 'https://fixture.r2.example',
    fetchImpl,
    prefix: 'omnireach/production',
    region: 'auto',
    secretAccessKey: 'fixture-secret-key',
  });
  const uploaded = await store.upload(source);
  const listed = await store.list();
  await store.download(uploaded.key, target);
  if (
    listed.length !== 1 ||
    listed[0]?.key !== uploaded.key ||
    (await readFile(target, 'utf8')) !== 'encrypted fixture payload' ||
    requests.some((request) => /fixture-(?:access|secret)-key/u.test(request.url))
  ) {
    throw new Error('S3-compatible off-site backup verification failed');
  }
  await store.remove(uploaded.key);
  if ((await store.list()).length !== 0) throw new Error('Off-site prune verification failed');
  let prefixEscapeRejected = false;
  try {
    await store.remove('another-tenant/fixture.orbk');
  } catch {
    prefixEscapeRejected = true;
  }
  if (!prefixEscapeRejected) throw new Error('Off-site prefix escape was not rejected');
  let objectBudgetRejected = false;
  try {
    await new S3CompatibleBackupStore({
      accessKeyId: 'fixture-access-key',
      bucket: 'fixture-bucket',
      endpoint: 'https://fixture.r2.example',
      fetchImpl,
      maximumObjectBytes: 4,
      prefix: 'omnireach/production',
      region: 'auto',
      secretAccessKey: 'fixture-secret-key',
    }).upload(source);
  } catch {
    objectBudgetRejected = true;
  }
  let requestBudgetRejected = false;
  try {
    await new S3CompatibleBackupStore({
      accessKeyId: 'fixture-access-key',
      bucket: 'fixture-bucket',
      endpoint: 'https://fixture.r2.example',
      fetchImpl,
      maximumRequests: 1,
      prefix: 'omnireach/request-budget',
      region: 'auto',
      secretAccessKey: 'fixture-secret-key',
    }).upload(source);
  } catch {
    requestBudgetRejected = true;
  }
  let totalStorageBudgetRejected = false;
  try {
    await new S3CompatibleBackupStore({
      accessKeyId: 'fixture-access-key',
      bucket: 'fixture-bucket',
      endpoint: 'https://fixture.r2.example',
      fetchImpl,
      maximumTotalBytes: 4,
      prefix: 'omnireach/production',
      region: 'auto',
      secretAccessKey: 'fixture-secret-key',
    }).upload(source);
  } catch {
    totalStorageBudgetRejected = true;
  }
  if (!objectBudgetRejected || !requestBudgetRejected || !totalStorageBudgetRejected) {
    throw new Error('Off-site backup budgets did not fail closed');
  }
  objects.set('omnireach/production/oversized.orbk', Buffer.from('oversized'));
  let streamedDownloadBudgetRejected = false;
  try {
    await new S3CompatibleBackupStore({
      accessKeyId: 'fixture-access-key',
      bucket: 'fixture-bucket',
      endpoint: 'https://fixture.r2.example',
      fetchImpl,
      maximumObjectBytes: 4,
      prefix: 'omnireach/production',
      region: 'auto',
      secretAccessKey: 'fixture-secret-key',
    }).download('omnireach/production/oversized.orbk', join(root, 'oversized.orbk'));
  } catch {
    streamedDownloadBudgetRejected = true;
  }
  let listResponseBudgetRejected = false;
  try {
    await new S3CompatibleBackupStore({
      accessKeyId: 'fixture-access-key',
      bucket: 'fixture-bucket',
      endpoint: 'https://fixture.r2.example',
      fetchImpl,
      maximumListResponseBytes: 8,
      prefix: 'omnireach/production',
      region: 'auto',
      secretAccessKey: 'fixture-secret-key',
    }).list();
  } catch {
    listResponseBudgetRejected = true;
  }
  if (!streamedDownloadBudgetRejected || !listResponseBudgetRejected) {
    throw new Error('Off-site response budgets did not fail closed');
  }
  console.log(
    JSON.stringify({
      awsSignature: true,
      check: 'offsite-backup',
      downloadVerified: true,
      leastPrivilegePrefix: true,
      listVerified: true,
      listResponseBudgetRejected,
      objectBudgetRejected,
      ok: true,
      requestBudgetRejected,
      streamedDownloadBudgetRejected,
      totalStorageBudgetRejected,
      uploadVerified: true,
    }),
  );
} finally {
  await rm(root, { force: true, recursive: true });
}
