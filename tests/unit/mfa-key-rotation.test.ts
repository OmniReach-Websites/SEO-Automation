import {
  createVersionedSecretKeyring,
  decryptMfaSecret,
  encryptMfaSecret,
  PostgresMfaKeyRotator,
  type MfaKeyRotationClient,
  type MfaKeyRotationPool,
} from '@omnireach/auth';
import { describe, expect, it, vi } from 'vitest';

const oldKey = 'fictional-dedicated-mfa-key-material-0001';
const newKey = 'fictional-dedicated-mfa-key-material-0002';
const keyring = createVersionedSecretKeyring({
  activeVersion: 2,
  keys: { 1: oldKey, 2: newKey },
});

function poolFor(handler: (query: string, values: unknown[] | undefined) => Promise<unknown>): {
  pool: MfaKeyRotationPool;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(handler);
  const client = { query, release: vi.fn() } as unknown as MfaKeyRotationClient;
  return { pool: { connect: vi.fn(async () => client) }, query };
}

describe('MFA encryption key rotation', () => {
  it('re-encrypts old-version factors atomically with the active key', async () => {
    const original = encryptMfaSecret('JBSWY3DPEHPK3PXP', oldKey);
    let replacement: Uint8Array | undefined;
    const { pool, query } = poolFor(async (statement, values) => {
      if (statement.includes('SELECT id, encrypted_secret, key_version')) {
        return {
          rows: [{ encrypted_secret: original, id: 'factor-a', key_version: 1 }],
        };
      }
      if (statement.includes('UPDATE mfa_factors')) {
        replacement = values?.[1] as Uint8Array;
        return { rowCount: 1, rows: [] };
      }
      if (statement.includes('WHERE key_version <> $1')) {
        return { rows: [{ count: 0 }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresMfaKeyRotator(pool, keyring).rotateBatch('CHG-rotation-001', 25),
    ).resolves.toEqual({
      activeVersion: 2,
      remaining: 0,
      rotated: 1,
    });
    expect(replacement).toBeDefined();
    expect(decryptMfaSecret(replacement ?? new Uint8Array(), newKey)).toBe('JBSWY3DPEHPK3PXP');
    expect(Buffer.from(replacement ?? []).includes(Buffer.from('JBSWY3DPEHPK3PXP'))).toBe(false);
    expect(query.mock.calls.some(([statement]) => String(statement).includes('COMMIT'))).toBe(true);
    expect(
      query.mock.calls.some(
        ([statement, values]) =>
          String(statement).includes('INSERT INTO audit_events') &&
          (values as unknown[] | undefined)?.[1] === 'CHG-rotation-001',
      ),
    ).toBe(true);
  });

  it('rolls back without writing when a referenced old key is unavailable', async () => {
    const missingVersion = encryptMfaSecret('JBSWY3DPEHPK3PXP', oldKey);
    const activeOnly = createVersionedSecretKeyring({ activeVersion: 2, keys: { 2: newKey } });
    const { pool, query } = poolFor(async (statement) => {
      if (statement.includes('SELECT id, encrypted_secret, key_version')) {
        return {
          rows: [{ encrypted_secret: missingVersion, id: 'factor-a', key_version: 1 }],
        };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresMfaKeyRotator(pool, activeOnly).rotateBatch('CHG-rotation-002'),
    ).rejects.toThrow('missing version 1');
    expect(
      query.mock.calls.some(([statement]) => String(statement).includes('UPDATE mfa_factors')),
    ).toBe(false);
    expect(query.mock.calls.some(([statement]) => String(statement).includes('ROLLBACK'))).toBe(
      true,
    );
  });

  it('blocks retirement while durable MFA or outbox references remain', async () => {
    let countQuery = 0;
    const { pool } = poolFor(async (statement) => {
      if (statement.includes('AS retired')) return { rows: [{ retired: false }] };
      if (statement.includes('count(*)::integer')) {
        countQuery += 1;
        return { rows: [{ count: countQuery === 1 ? 2 : 1 }] };
      }
      return { rows: [] };
    });

    await expect(new PostgresMfaKeyRotator(pool, keyring).retirementReport(1)).resolves.toEqual({
      activeVersion: 2,
      canRetire: false,
      mfaFactorReferences: 2,
      pendingDeliveryReferences: 1,
      retired: false,
      version: 1,
      waitForEphemeralBootstrapSeconds: 600,
    });
  });

  it('atomically retires an unreferenced inactive key and records non-secret audit evidence', async () => {
    let retirementReads = 0;
    const { pool, query } = poolFor(async (statement) => {
      if (statement.includes('SELECT EXISTS')) {
        retirementReads += 1;
        return { rows: [{ retired: retirementReads > 1 }] };
      }
      if (statement.includes('count(*)::integer')) return { rows: [{ count: 0 }] };
      if (statement.includes('SELECT retire_mfa_encryption_key')) {
        return { rows: [{ retired: true }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresMfaKeyRotator(pool, keyring).retireKey(1, 'CHG-retire-001'),
    ).resolves.toEqual({
      activeVersion: 2,
      canRetire: false,
      mfaFactorReferences: 0,
      pendingDeliveryReferences: 0,
      retired: true,
      version: 1,
      waitForEphemeralBootstrapSeconds: 600,
    });
    const lockCall = query.mock.calls.find(([statement]) =>
      String(statement).includes('pg_advisory_xact_lock'),
    );
    expect(lockCall?.[1]).toEqual([1_331_980_113, 1]);
    expect(
      query.mock.calls.some(
        ([statement, values]) =>
          String(statement).includes('SELECT retire_mfa_encryption_key') &&
          (values as unknown[] | undefined)?.[2] === 'CHG-retire-001' &&
          !JSON.stringify(values).includes(oldKey),
      ),
    ).toBe(true);
  });

  it('refuses retirement when the locked recheck finds references or the version is active', async () => {
    const { pool, query } = poolFor(async (statement) => {
      if (statement.includes('AS retired')) return { rows: [{ retired: false }] };
      if (statement.includes('FROM mfa_factors')) return { rows: [{ count: 1 }] };
      if (statement.includes('password_recovery_delivery_outbox')) return { rows: [{ count: 0 }] };
      return { rows: [] };
    });
    const rotator = new PostgresMfaKeyRotator(pool, keyring);

    await expect(rotator.retireKey(1, 'CHG-retire-002')).rejects.toThrow(
      'still has durable references',
    );
    await expect(rotator.retireKey(2, 'CHG-retire-003')).rejects.toThrow(
      'active MFA encryption key cannot be retired',
    );
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).includes('SELECT retire_mfa_encryption_key'),
      ),
    ).toBe(false);
  });

  it('rejects unsafe versions and change identifiers before database access', async () => {
    const { pool, query } = poolFor(async () => ({ rows: [] }));
    const rotator = new PostgresMfaKeyRotator(pool, keyring);

    await expect(rotator.retireKey(2_147_483_648, 'CHG-retire-004')).rejects.toThrow(
      'version is invalid',
    );
    await expect(rotator.retireKey(1, 'contains spaces')).rejects.toThrow('change ID is invalid');
    await expect(rotator.rotateBatch('x')).rejects.toThrow('change ID is invalid');
    expect(query).not.toHaveBeenCalled();
  });
});
