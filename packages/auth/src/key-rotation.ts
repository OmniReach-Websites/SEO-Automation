import {
  activeSecretKey,
  decryptMfaSecret,
  encryptMfaSecret,
  maximumMfaKeyVersion,
  secretKeyForVersion,
  type VersionedSecretKeyring,
} from './secrets.ts';

const retirementAdvisoryLockNamespace = 1_331_980_113;

export interface MfaKeyRotationClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rowCount?: number | null; rows: Row[] }>;
  release(): void;
}

export interface MfaKeyRotationPool {
  connect(): Promise<MfaKeyRotationClient>;
}

export interface MfaKeyRotationBatchResult {
  activeVersion: number;
  remaining: number;
  rotated: number;
}

export interface MfaKeyRetirementReport {
  activeVersion: number;
  canRetire: boolean;
  mfaFactorReferences: number;
  pendingDeliveryReferences: number;
  retired: boolean;
  version: number;
  waitForEphemeralBootstrapSeconds: number;
}

export interface MfaKeyRetirementResult extends MfaKeyRetirementReport {
  retired: true;
}

interface FactorRow extends Record<string, unknown> {
  encrypted_secret: Uint8Array;
  id: string;
  key_version: number;
}

/**
 * Re-encrypts durable TOTP factors in small, atomic batches. Old keys remain
 * readable until a separate retirement check proves that no durable rows refer
 * to them. The 10-minute wait in the report covers the maximum Redis owner-
 * bootstrap TTL, whose encrypted state is intentionally ephemeral.
 */
export class PostgresMfaKeyRotator {
  constructor(
    private readonly pool: MfaKeyRotationPool,
    private readonly keyring: VersionedSecretKeyring,
  ) {}

  async rotateBatch(changeId: string, batchSize = 100): Promise<MfaKeyRotationBatchResult> {
    assertChangeId(changeId);
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0 || batchSize > 1_000) {
      throw new Error('MFA key rotation batch size must be between 1 and 1000');
    }
    const activeKey = activeSecretKey(this.keyring);
    return this.transaction(async (client) => {
      const factors = await client.query<FactorRow>(
        `SELECT id, encrypted_secret, key_version
           FROM mfa_factors
          WHERE key_version <> $1
          ORDER BY id
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [activeKey.keyVersion, batchSize],
      );

      for (const factor of factors.rows) {
        const previousKey = secretKeyForVersion(this.keyring, factor.key_version);
        if (!previousKey) {
          throw new Error(`MFA key rotation is missing version ${factor.key_version}`);
        }
        const plaintext = decryptMfaSecret(factor.encrypted_secret, previousKey);
        const replacement = encryptMfaSecret(plaintext, activeKey.keyMaterial);
        const updated = await client.query(
          `UPDATE mfa_factors
              SET encrypted_secret = $2, key_version = $3
            WHERE id = $1 AND key_version = $4`,
          [factor.id, Buffer.from(replacement), activeKey.keyVersion, factor.key_version],
        );
        if (updated.rowCount !== 1) throw new Error('MFA key rotation lost a concurrent update');
      }

      const remaining = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM mfa_factors
          WHERE key_version <> $1`,
        [activeKey.keyVersion],
      );
      const result = {
        activeVersion: activeKey.keyVersion,
        remaining: remaining.rows[0]?.count ?? 0,
        rotated: factors.rows.length,
      };
      await insertRotationAudit(client, {
        action: 'auth.mfa_encryption_key.rotation_batch',
        changeId,
        metadata: result,
      });
      return result;
    });
  }

  async retirementReport(version: number): Promise<MfaKeyRetirementReport> {
    assertKeyVersion(version);
    const activeKey = activeSecretKey(this.keyring);
    return this.transaction(async (client) => {
      return readRetirementReport(client, activeKey.keyVersion, version);
    });
  }

  /**
   * Atomically retires an inactive key version. The advisory lock is shared with
   * database write guards, closing the gap between the zero-reference check and
   * the durable retirement record. A process holding a stale keyring therefore
   * fails closed if it later tries to write ciphertext under this version.
   */
  async retireKey(version: number, changeId: string): Promise<MfaKeyRetirementResult> {
    assertKeyVersion(version);
    assertChangeId(changeId);
    const activeKey = activeSecretKey(this.keyring);
    if (version === activeKey.keyVersion) {
      throw new Error('The active MFA encryption key cannot be retired');
    }
    if (!secretKeyForVersion(this.keyring, version)) {
      throw new Error('The MFA encryption key to retire is not present in the keyring');
    }

    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
        retirementAdvisoryLockNamespace,
        version,
      ]);
      const report = await readRetirementReport(client, activeKey.keyVersion, version);
      if (report.retired) throw new Error('MFA encryption key version is already retired');
      if (!report.canRetire) {
        throw new Error('MFA encryption key version still has durable references');
      }

      const retired = await client.query<{ retired: boolean }>(
        `SELECT retire_mfa_encryption_key($1, $2, $3) AS retired`,
        [version, activeKey.keyVersion, changeId],
      );
      if (!retired.rows[0]?.retired) {
        throw new Error('MFA encryption key version still has durable references');
      }
      const recorded = await readRetirementReport(client, activeKey.keyVersion, version);
      if (!recorded.retired) throw new Error('MFA encryption key retirement was not recorded');
      return { ...recorded, canRetire: false, retired: true };
    });
  }

  private async transaction<T>(
    operation: (client: MfaKeyRotationClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE omnireach_auth');
      await client.query(`SELECT set_config('app.authentication_contract_version', '2', true)`);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function readRetirementReport(
  client: MfaKeyRotationClient,
  activeVersion: number,
  version: number,
): Promise<MfaKeyRetirementReport> {
  const retirement = await client.query<{ retired: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM mfa_encryption_key_retirements WHERE key_version = $1
     ) AS retired`,
    [version],
  );
  const factors = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
       FROM mfa_factors
      WHERE key_version = $1`,
    [version],
  );
  const deliveries = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
       FROM password_recovery_delivery_outbox
      WHERE encryption_key_version = $1
        AND encrypted_token IS NOT NULL
        AND status IN ('queued', 'processing')`,
    [version],
  );
  const mfaFactorReferences = factors.rows[0]?.count ?? 0;
  const pendingDeliveryReferences = deliveries.rows[0]?.count ?? 0;
  const retired = retirement.rows[0]?.retired ?? false;
  return {
    activeVersion,
    canRetire:
      !retired &&
      version !== activeVersion &&
      mfaFactorReferences === 0 &&
      pendingDeliveryReferences === 0,
    mfaFactorReferences,
    pendingDeliveryReferences,
    retired,
    version,
    waitForEphemeralBootstrapSeconds: 600,
  };
}

async function insertRotationAudit(
  client: MfaKeyRotationClient,
  input: { action: string; changeId: string; metadata: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (action, reason, trace_id, target_type, metadata)
     VALUES ($1, $2, $2, 'mfa_encryption_key', $3::jsonb)`,
    [input.action, input.changeId, JSON.stringify(input.metadata)],
  );
}

function assertKeyVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version <= 0 || version > maximumMfaKeyVersion) {
    throw new Error('MFA key retirement version is invalid');
  }
}

function assertChangeId(changeId: string): void {
  if (
    changeId.length < 3 ||
    changeId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(changeId)
  ) {
    throw new Error('MFA key rotation change ID is invalid');
  }
}
