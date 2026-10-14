import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEncryptedBackup } from '../../infrastructure/backups/backup.mjs';
import { backupErrorCode, runBackupCli } from '../../infrastructure/backups/backup-cli.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('backup operational safety', () => {
  it('maps raw failures to fixed non-secret alert classes', () => {
    expect(backupErrorCode(new Error('pg_dump exited 2 with credentials redacted'), 'backup')).toBe(
      'database_dump_failed',
    );
    expect(backupErrorCode(new Error('Off-site request failed'), 'backup')).toBe(
      'offsite_transfer_failed',
    );
    expect(backupErrorCode(new Error('Backup authentication failed'), 'verify')).toBe(
      'integrity_verification_failed',
    );
    expect(backupErrorCode(new Error('Secret-shaped unexpected detail'), 'backup')).toBe(
      'backup_failed',
    );
  });

  it('requires an audit log for applied pruning and records manual deletion intent and completion', async () => {
    const fixture = await backupFixture(8);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(
      runBackupCli([
        'prune',
        '--root',
        fixture.backups,
        '--daily',
        '7',
        '--weekly',
        '4',
        '--apply',
        '--authorization-ref',
        'owner-approved-test',
      ]),
    ).rejects.toThrow('Applied pruning requires --audit-log');

    const result = await runBackupCli([
      'prune',
      '--root',
      fixture.backups,
      '--daily',
      '7',
      '--weekly',
      '4',
      '--apply',
      '--authorization-ref',
      'owner-approved-test',
      '--audit-log',
      fixture.audit,
    ]);
    expect(result).toMatchObject({ applied: true, mode: 'manual' });
    expect(result.prune).toHaveLength(1);
    const prunedId = result.prune?.[0];
    if (!prunedId) throw new Error('Expected one pruned backup identifier');
    const audit = (await readFile(fixture.audit, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(audit.map(({ phase }) => phase)).toEqual(['requested', 'completed']);
    expect(audit.every(({ envelopeHash }) => /^[a-f0-9]{64}$/u.test(String(envelopeHash)))).toBe(
      true,
    );
    await expect(stat(join(fixture.backups, `${prunedId}.orbk`))).rejects.toThrow();
  });

  it('allows only the approved 3-daily/1-weekly automatic retention policy', async () => {
    const fixture = await backupFixture(8);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(
      runBackupCli([
        'prune',
        '--root',
        fixture.backups,
        '--daily',
        '3',
        '--weekly',
        '2',
        '--apply',
        '--automated-retention',
        '--audit-log',
        fixture.audit,
      ]),
    ).rejects.toThrow('approved 3-daily/1-weekly policy');

    const result = await runBackupCli([
      'prune',
      '--root',
      fixture.backups,
      '--daily',
      '3',
      '--weekly',
      '1',
      '--apply',
      '--automated-retention',
      '--audit-log',
      fixture.audit,
    ]);
    expect(result).toMatchObject({ applied: true, mode: 'automatic' });
  });

  it('fails closed for production filesystem and database restore targets', async () => {
    const fixture = await backupFixture(1, 'postgres.dump');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const backupPath = join(fixture.backups, `${fixture.ids[0]}.orbk`);
    const productionRoot = join(fixture.root, 'production');

    await expect(
      runBackupCli(
        [
          'restore-to-disposable',
          '--path',
          backupPath,
          '--destination',
          join(productionRoot, 'nested'),
          '--key-file',
          fixture.key,
          '--confirm-isolated',
          'RESTORE',
        ],
        { OMNIREACH_ENV: 'production', OMNIREACH_PRODUCTION_ROOTS: productionRoot },
      ),
    ).rejects.toThrow('overlaps a configured production root');

    const databaseUrl = join(fixture.root, 'database-url');
    await writeFile(databaseUrl, 'postgresql://fixture:fixture@postgres:5432/omnireach', {
      mode: 0o600,
    });
    await expect(
      runBackupCli(
        [
          'restore-to-disposable',
          '--path',
          backupPath,
          '--destination',
          join(fixture.root, 'isolated-restore'),
          '--key-file',
          fixture.key,
          '--database-url-file',
          databaseUrl,
          '--confirm-isolated',
          'RESTORE',
        ],
        {
          OMNIREACH_ENV: 'production',
          OMNIREACH_PRODUCTION_DATABASE_TARGETS: 'postgres:5432/omnireach',
          OMNIREACH_PRODUCTION_ROOTS: productionRoot,
        },
      ),
    ).rejects.toThrow('overlaps a configured production database');
  });
});

async function backupFixture(count: number, sourceName = 'content.txt') {
  const root = await mkdtemp(join(tmpdir(), 'omnireach-backup-operations-'));
  temporaryRoots.push(root);
  const backups = join(root, 'backups');
  const source = join(root, sourceName);
  const key = join(root, 'backup-key');
  const audit = join(root, 'deletion-audit.jsonl');
  await writeFile(source, 'synthetic backup content');
  await writeFile(key, 'ab'.repeat(32), { mode: 0o600 });
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const backup = await createEncryptedBackup({
      createdAt: new Date(Date.UTC(2026, 9, 14 - index)),
      destinationRoot: backups,
      encryptionKeyHex: 'ab'.repeat(32),
      inputPaths: [source],
      kind: 'daily',
    });
    ids.push(backup.id);
  }
  return { audit, backups, ids, key, root };
}
