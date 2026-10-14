import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  copyOffServer,
  createEncryptedBackup,
  restoreEncryptedBackup,
  selectRetention,
  verifyEncryptedBackup,
} from '../infrastructure/backups/backup.mjs';

const root = await mkdtemp(join(tmpdir(), 'omnireach-backup-fixture-'));
try {
  const db = join(root, 'fictional.dump');
  const media = join(root, 'fictional-media');
  await writeFile(db, 'fictional logical database dump');
  await mkdir(join(media, 'site-a', 'images'), { recursive: true });
  await writeFile(
    join(media, 'site-a', 'images', 'hero.json'),
    '{"site":"fictional","asset":"hero"}',
  );
  const backup = await createEncryptedBackup({
    createdAt: new Date('2026-10-10T00:00:00Z'),
    destinationRoot: join(root, 'local'),
    encryptionKeyHex: 'cd'.repeat(32),
    inputPaths: [db, media],
    kind: 'daily',
  });
  const offServer = await copyOffServer(backup.backupPath, join(root, 'off-server'));
  const verified = await verifyEncryptedBackup({
    backupPath: offServer,
    encryptionKeyHex: 'cd'.repeat(32),
  });
  const restored = await restoreEncryptedBackup({
    backupPath: offServer,
    destinationRoot: join(root, 'restore-isolated'),
    encryptionKeyHex: 'cd'.repeat(32),
  });
  if (
    (await readFile(join(root, 'restore-isolated', 'fictional.dump'), 'utf8')) !==
      'fictional logical database dump' ||
    (await readFile(
      join(root, 'restore-isolated', 'fictional-media', 'site-a', 'images', 'hero.json'),
      'utf8',
    )) !== '{"site":"fictional","asset":"hero"}' ||
    restored.files.length !== 2
  )
    throw new Error('Isolated restore mismatch');
  let wrongKeyRejected = false;
  try {
    await restoreEncryptedBackup({
      backupPath: offServer,
      destinationRoot: join(root, 'wrong-key'),
      encryptionKeyHex: 'ef'.repeat(32),
    });
  } catch {
    wrongKeyRejected = true;
  }
  const envelope = await readFile(offServer);
  const corrupt = join(root, 'corrupt.orbk');
  const corruptBytes = Buffer.from(envelope);
  corruptBytes[corruptBytes.length - 1] ^= 0xff;
  await writeFile(corrupt, corruptBytes);
  const truncated = join(root, 'truncated.orbk');
  await writeFile(truncated, envelope.subarray(0, Math.max(1, envelope.length - 16)));
  let corruptRejected = false;
  let truncatedRejected = false;
  try {
    await restoreEncryptedBackup({
      backupPath: corrupt,
      destinationRoot: join(root, 'corrupt-restore'),
      encryptionKeyHex: 'cd'.repeat(32),
    });
  } catch {
    corruptRejected = true;
  }
  try {
    await restoreEncryptedBackup({
      backupPath: truncated,
      destinationRoot: join(root, 'truncated-restore'),
      encryptionKeyHex: 'cd'.repeat(32),
    });
  } catch {
    truncatedRejected = true;
  }
  const dailyPoints = Array.from({ length: 12 }, (_, index) => ({
    active: index === 11,
    complete: true,
    createdAt: new Date(Date.UTC(2026, 9, 10 - index)).toISOString(),
    hold: index === 10,
    id: `daily-${index}`,
    kind: 'daily',
  }));
  const weeklyPoints = Array.from({ length: 7 }, (_, index) => ({
    active: false,
    complete: true,
    createdAt: new Date(Date.UTC(2026, 9, 10 - index * 7)).toISOString(),
    hold: false,
    id: `weekly-${index}`,
    kind: 'weekly',
  }));
  const points = [...dailyPoints, ...weeklyPoints];
  const retention = selectRetention(points, new Date('2026-10-10T12:00:00Z'));
  const customRetention = selectRetention(points, new Date('2026-10-10T12:00:00Z'), {
    daily: 3,
    weekly: 2,
  });
  let sourceLimitRejected = false;
  try {
    await createEncryptedBackup({
      createdAt: new Date('2026-10-10T00:00:00Z'),
      destinationRoot: join(root, 'over-limit'),
      encryptionKeyHex: 'cd'.repeat(32),
      inputPaths: [db],
      kind: 'daily',
      maximumSourceBytes: 1,
    });
  } catch {
    sourceLimitRejected = true;
  }
  let archiveLimitRejected = false;
  try {
    await verifyEncryptedBackup({
      backupPath: offServer,
      encryptionKeyHex: 'cd'.repeat(32),
      maximumArchiveBytes: 1,
    });
  } catch {
    archiveLimitRejected = true;
  }
  let restoredSourceLimitRejected = false;
  try {
    await verifyEncryptedBackup({
      backupPath: offServer,
      encryptionKeyHex: 'cd'.repeat(32),
      maximumSourceBytes: 1,
    });
  } catch {
    restoredSourceLimitRejected = true;
  }
  let nonemptyRestoreRejected = false;
  try {
    await restoreEncryptedBackup({
      backupPath: offServer,
      destinationRoot: join(root, 'restore-isolated'),
      encryptionKeyHex: 'cd'.repeat(32),
    });
  } catch {
    nonemptyRestoreRejected = true;
  }
  if (
    verified.files.length !== 2 ||
    !wrongKeyRejected ||
    !corruptRejected ||
    !truncatedRejected ||
    !nonemptyRestoreRejected ||
    retention.keep.length !== 13 ||
    customRetention.keep.length !== 7 ||
    !sourceLimitRejected ||
    !archiveLimitRejected ||
    !restoredSourceLimitRejected ||
    retention.prune.includes('daily-11') ||
    retention.prune.includes('daily-10')
  )
    throw new Error('Backup safety/retention verification failed');
  console.log(
    JSON.stringify({
      check: 'backup-harness',
      archiveLimitRejected,
      dailyWeeklyPoints: retention.keep.length,
      corruptRejected,
      encrypted: true,
      isolatedRestore: true,
      nestedMediaRestored: true,
      nonemptyRestoreRejected,
      offServer: true,
      ok: true,
      sourceLimitRejected,
      restoredSourceLimitRejected,
      truncatedRejected,
      wrongKeyRejected,
    }),
  );
} finally {
  await rm(root, { force: true, recursive: true });
}
