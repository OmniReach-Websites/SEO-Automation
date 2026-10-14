import pg from 'pg';

export class PostgresBackupRecords {
  #ownsPool;
  #pool;

  constructor(options) {
    if (options?.pool) {
      this.#pool = options.pool;
      this.#ownsPool = false;
      return;
    }
    if (typeof options?.databaseUrl !== 'string' || !options.databaseUrl) {
      throw new Error('Backup status database configuration is incomplete');
    }
    this.#pool = new pg.Pool({ connectionString: options.databaseUrl, max: 1 });
    this.#ownsPool = true;
  }

  async close() {
    if (this.#ownsPool) await this.#pool.end();
  }

  async recordComplete(input) {
    const manifest = validateRecord(input);
    return this.#transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        input.envelopeHash,
      ]);
      const existing = await client.query(
        `SELECT id FROM backup_records WHERE envelope_hash = $1 ORDER BY created_at DESC LIMIT 1`,
        [input.envelopeHash],
      );
      if (existing.rows[0]?.id) {
        await client.query(
          `UPDATE backup_records
              SET state = 'complete', storage_ref = $2, off_server_ref = $3,
                  key_version = $4, byte_size = $5, manifest = $6::jsonb,
                  verified_at = $7, off_server_copied_at = $8, error_code = NULL,
                  local_pruned_at = NULL, off_server_pruned_at = NULL
            WHERE id = $1`,
          [
            existing.rows[0].id,
            input.storageRef,
            input.offServerRef ?? null,
            input.keyVersion,
            input.byteSize,
            JSON.stringify(manifest),
            input.verifiedAt,
            input.offServerCopiedAt ?? null,
          ],
        );
        return existing.rows[0].id;
      }
      const inserted = await client.query(
        `INSERT INTO backup_records
           (kind, state, storage_ref, off_server_ref, envelope_hash, key_version,
            byte_size, manifest, created_at, verified_at, off_server_copied_at)
         VALUES ($1, 'complete', $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         RETURNING id`,
        [
          input.kind,
          input.storageRef,
          input.offServerRef ?? null,
          input.envelopeHash,
          input.keyVersion,
          input.byteSize,
          JSON.stringify(manifest),
          input.createdAt,
          input.verifiedAt,
          input.offServerCopiedAt ?? null,
        ],
      );
      if (!inserted.rows[0]?.id) throw new Error('Backup status record was not created');
      return inserted.rows[0].id;
    });
  }

  async recordRestoreTest(envelopeHash, restoredAt) {
    validateHash(envelopeHash);
    return this.#transaction(async (client) => {
      const result = await client.query(
        `UPDATE backup_records
            SET restore_tested_at = $2
          WHERE id = (SELECT id FROM backup_records
                       WHERE envelope_hash = $1 AND state = 'complete'
                       ORDER BY created_at DESC LIMIT 1)
          RETURNING id`,
        [envelopeHash, restoredAt],
      );
      if (!result.rows[0]?.id) throw new Error('Restored backup status record was not found');
      return result.rows[0].id;
    });
  }

  async recordVerification(envelopeHash, verifiedAt) {
    validateHash(envelopeHash);
    return this.#transaction(async (client) => {
      const result = await client.query(
        `UPDATE backup_records
            SET verified_at = $2, error_code = NULL
          WHERE id = (SELECT id FROM backup_records
                       WHERE envelope_hash = $1 AND state = 'complete'
                       ORDER BY created_at DESC LIMIT 1)
          RETURNING id`,
        [envelopeHash, verifiedAt],
      );
      if (!result.rows[0]?.id) throw new Error('Verified backup status record was not found');
      return result.rows[0].id;
    });
  }

  async reportFailure(errorCode) {
    if (!BACKUP_ERROR_CODES.has(errorCode)) throw new Error('Backup failure code is invalid');
    return this.#transaction(async (client) => {
      await client.query('SELECT record_backup_alert($1::varchar(100))', [errorCode]);
    });
  }

  async resolveFailureAlert() {
    return this.#transaction(async (client) => {
      await client.query('SELECT record_backup_alert(NULL::varchar(100))');
    });
  }

  async recordPruned(envelopeHash, source) {
    validateHash(envelopeHash);
    if (!['local', 'offsite'].includes(source)) throw new Error('Backup prune source is invalid');
    return this.#transaction(async (client) => {
      const result = await client.query(
        `UPDATE backup_records
            SET local_pruned_at = CASE WHEN $2 = 'local' THEN now() ELSE local_pruned_at END,
                off_server_pruned_at = CASE WHEN $2 = 'offsite' THEN now() ELSE off_server_pruned_at END,
                state = CASE
                  WHEN (local_pruned_at IS NOT NULL OR $2 = 'local')
                   AND (off_server_ref IS NULL OR off_server_pruned_at IS NOT NULL OR $2 = 'offsite')
                  THEN 'pruned'
                  ELSE state
                END
          WHERE envelope_hash = $1 AND state = 'complete' AND NOT active AND NOT hold
          RETURNING id`,
        [envelopeHash, source],
      );
      return result.rows[0]?.id;
    });
  }

  async #transaction(operation) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE omnireach_worker');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const BACKUP_ERROR_CODES = new Set([
  'backup_failed',
  'backup_resource_limit',
  'database_dump_failed',
  'integrity_verification_failed',
  'offsite_transfer_failed',
]);

function validateRecord(input) {
  validateHash(input.envelopeHash);
  if (!['daily', 'weekly'].includes(input.kind)) throw new Error('Backup record kind is invalid');
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1) {
    throw new Error('Backup record size is invalid');
  }
  if (!Number.isInteger(input.keyVersion) || input.keyVersion < 1) {
    throw new Error('Backup key version is invalid');
  }
  for (const value of [input.storageRef, input.offServerRef].filter(Boolean)) {
    if (typeof value !== 'string' || value.length > 500) {
      throw new Error('Backup storage reference is invalid');
    }
  }
  const manifest = input.manifest;
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    Object.keys(manifest).sort().join(',') !== 'fileCount,formatVersion,sourceBytes' ||
    manifest.formatVersion !== 1 ||
    !Number.isSafeInteger(manifest.fileCount) ||
    manifest.fileCount < 1 ||
    !Number.isSafeInteger(manifest.sourceBytes) ||
    manifest.sourceBytes < 0
  ) {
    throw new Error('Backup status manifest is invalid');
  }
  return {
    fileCount: manifest.fileCount,
    formatVersion: 1,
    sourceBytes: manifest.sourceBytes,
  };
}

function validateHash(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Backup envelope hash is invalid');
  }
}
