import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresBackupRecords } from '../../infrastructure/backups/postgres-records.mjs';

const envelopeHash = 'ab'.repeat(32);

describe('PostgreSQL backup status records', () => {
  it('records a completed backup through the restricted worker role', async () => {
    const { client, pool, query } = fakePool((text) => {
      if (text.includes('SELECT id FROM backup_records')) return { rows: [] };
      if (text.includes('INSERT INTO backup_records')) return { rows: [{ id: 'backup-1' }] };
      return { rows: [] };
    });
    const records = new PostgresBackupRecords({ pool });

    await expect(records.recordComplete(completeRecord())).resolves.toBe('backup-1');

    expect(query.mock.calls.map(([text]) => text)).toContain('SET LOCAL ROLE omnireach_worker');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO backup_records'),
      expect.arrayContaining([envelopeHash, 'r2://bucket/omnireach/backup.orbk']),
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('updates the existing envelope record idempotently', async () => {
    const { pool, query } = fakePool((text) => {
      if (text.includes('SELECT id FROM backup_records')) return { rows: [{ id: 'backup-1' }] };
      if (text.includes('UPDATE backup_records')) return { rows: [] };
      return { rows: [] };
    });
    const records = new PostgresBackupRecords({ pool });

    await expect(records.recordComplete(completeRecord())).resolves.toBe('backup-1');

    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO backup_records'),
      expect.anything(),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'complete'"),
      expect.arrayContaining(['backup-1', 'r2://bucket/omnireach/backup.orbk']),
    );
  });

  it('records restore drills and marks only eligible backups as pruned', async () => {
    const { pool, query } = fakePool((text) => {
      if (text.includes('restore_tested_at')) return { rows: [{ id: 'backup-1' }] };
      if (text.includes('SET verified_at')) return { rows: [{ id: 'backup-1' }] };
      if (text.includes('off_server_pruned_at = CASE')) return { rows: [{ id: 'backup-1' }] };
      return { rows: [] };
    });
    const records = new PostgresBackupRecords({ pool });
    const restoredAt = new Date('2026-10-14T12:00:00.000Z');

    await expect(records.recordRestoreTest(envelopeHash, restoredAt)).resolves.toBe('backup-1');
    await expect(records.recordVerification(envelopeHash, restoredAt)).resolves.toBe('backup-1');
    await expect(records.recordPruned(envelopeHash, 'offsite')).resolves.toBe('backup-1');
    await expect(records.reportFailure('integrity_verification_failed')).resolves.toBeUndefined();
    await expect(records.resolveFailureAlert()).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledWith(expect.stringContaining('restore_tested_at'), [
      envelopeHash,
      restoredAt,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('NOT active AND NOT hold'), [
      envelopeHash,
      'offsite',
    ]);
    expect(query).toHaveBeenCalledWith('SELECT record_backup_alert($1::varchar(100))', [
      'integrity_verification_failed',
    ]);
    expect(query).toHaveBeenCalledWith('SELECT record_backup_alert(NULL::varchar(100))');
  });

  it('rolls back and rejects malformed status metadata', async () => {
    const { pool, query } = fakePool(() => ({ rows: [] }));
    const records = new PostgresBackupRecords({ pool });

    await expect(
      records.recordComplete({ ...completeRecord(), envelopeHash: 'not-a-checksum' }),
    ).rejects.toThrow('envelope hash is invalid');
    await expect(
      records.recordComplete({
        ...completeRecord(),
        manifest: {
          fileCount: 1,
          filename: 'customer-private-name.txt',
          formatVersion: 1,
          sourceBytes: 20,
        } as never,
      }),
    ).rejects.toThrow('status manifest is invalid');
    expect(query).not.toHaveBeenCalled();
  });
});

function completeRecord() {
  return {
    byteSize: 1_024,
    createdAt: new Date('2026-10-14T00:00:00.000Z'),
    envelopeHash,
    keyVersion: 1,
    kind: 'daily' as const,
    manifest: { fileCount: 1, formatVersion: 1 as const, sourceBytes: 20 },
    offServerCopiedAt: new Date('2026-10-14T00:05:00.000Z'),
    offServerRef: 'r2://bucket/omnireach/backup.orbk',
    storageRef: '/opt/backups/omnireach/backup.orbk',
    verifiedAt: new Date('2026-10-14T00:02:00.000Z'),
  };
}

function fakePool(result: (text: string, values?: unknown[]) => { rows: unknown[] }) {
  const query = vi.fn(async (text: string, values?: unknown[]) => result(text, values));
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { client, pool, query };
}
