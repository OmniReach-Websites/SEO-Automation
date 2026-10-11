import { createHash, randomBytes } from 'node:crypto';

export interface OwnerBootstrapClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface OwnerBootstrapToken {
  expiresAt: Date;
  token: string;
}

export async function createOwnerBootstrapToken(
  client: OwnerBootstrapClient,
  now = new Date(),
): Promise<OwnerBootstrapToken> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(now.getTime() + 30 * 60_000);

  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      'omnireach-owner-bootstrap',
    ]);
    const memberships = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM platform_memberships`,
    );
    if (memberships.rows[0]?.count !== '0') {
      throw new Error(
        'A platform membership already exists; owner bootstrap is permanently closed',
      );
    }

    const current = await client.query<{ consumed_at: Date | null; expires_at: Date }>(
      `SELECT expires_at, consumed_at FROM owner_bootstrap WHERE singleton FOR UPDATE`,
    );
    const existing = current.rows[0];
    if (existing?.consumed_at) {
      throw new Error('The owner bootstrap token has already been consumed');
    }
    if (existing && existing.expires_at > now) {
      throw new Error('An unexpired owner bootstrap token already exists');
    }

    await client.query(
      `INSERT INTO owner_bootstrap (singleton, token_hash, expires_at)
       VALUES (true, $1, $2)
       ON CONFLICT (singleton) DO UPDATE
         SET token_hash = EXCLUDED.token_hash,
             expires_at = EXCLUDED.expires_at,
             consumed_at = NULL,
             consumed_by = NULL,
             created_at = now()`,
      [tokenHash, expiresAt],
    );
    await client.query('COMMIT');
    return { expiresAt, token };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
