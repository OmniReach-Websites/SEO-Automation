import { domainToASCII } from 'node:url';

import { roles, type Role } from './roles.ts';
import type {
  AuthenticationRepository,
  LoginTarget,
  MfaFactorRecord,
  SessionRecord,
} from './service.ts';

interface LoginRow extends Record<string, unknown> {
  blocked_until: Date | null;
  host: string;
  password_hash: string;
  role: string;
  site_id: string | null;
  tenant_id: string | null;
  user_id: string;
}

export interface AuthenticationTransactionClient {
  query(query: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

export interface AuthenticationTransactionPool {
  connect(): Promise<AuthenticationTransactionClient>;
}

export class PostgresAuthenticationRepository implements AuthenticationRepository {
  readonly #orapHostname: string;

  constructor(
    private readonly pool: AuthenticationTransactionPool,
    orapHostname: string,
  ) {
    this.#orapHostname = normalizeHost(orapHostname);
  }

  async acceptInvitation(input: {
    displayName: string;
    host: string;
    now: Date;
    passwordHash: string;
    verifyExistingPassword(passwordHash: string): Promise<boolean>;
    tokenHash: string;
    traceId: string;
  }): Promise<LoginTarget | undefined> {
    const host = normalizeHost(input.host);
    return withAuthTransaction(this.pool, async (client) => {
      const invitation = await query<{
        id: string;
        normalized_email: string;
        role: string;
        site_id: string;
        tenant_id: string;
      }>(
        client,
        `SELECT i.id, i.normalized_email, i.role, i.tenant_id, i.site_id
           FROM customer_invitations i
           JOIN sites s ON s.tenant_id = i.tenant_id AND s.id = i.site_id AND s.status = 'active'
           JOIN tenants t ON t.id = i.tenant_id AND t.status = 'active'
           JOIN domains d
             ON d.tenant_id = i.tenant_id AND d.site_id = i.site_id
            AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
          WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
            AND i.expires_at > $2 AND d.hostname = $3
          FOR UPDATE OF i`,
        [input.tokenHash, input.now, host],
      );
      if (invitation.rows.length !== 1 || !invitation.rows[0]) return undefined;
      const invited = invitation.rows[0];
      const role = parseRole(invited.role);
      if (!role || !role.startsWith('customer_')) return undefined;
      const existing = await query<{ id: string; password_hash: string; status: string }>(
        client,
        `SELECT u.id, u.status, c.password_hash
           FROM users u
           JOIN credentials c ON c.user_id = u.id
          WHERE u.normalized_email = $1
          LIMIT 2`,
        [invited.normalized_email],
      );
      if (existing.rows.length > 1) return undefined;
      const existingUser = existing.rows[0];
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `site-seat:${invited.site_id}`,
      ]);
      const capacity = requiredRow(
        await query<{
          active_memberships: number;
          customer_seat_limit: number;
          existing_membership: boolean;
          pending_other: number;
        }>(
          client,
          `SELECT p.customer_seat_limit,
                  (SELECT count(*)::integer FROM memberships m
                    WHERE m.tenant_id = s.tenant_id AND m.site_id = s.site_id AND m.active)
                    AS active_memberships,
                  (SELECT count(*)::integer FROM customer_invitations other
                    WHERE other.tenant_id = s.tenant_id AND other.site_id = s.site_id
                      AND other.id <> $3 AND other.accepted_at IS NULL
                      AND other.revoked_at IS NULL AND other.expires_at > $4
                      AND p.pending_invitations_count_as_seats) AS pending_other,
                  EXISTS (SELECT 1 FROM memberships existing
                    WHERE existing.tenant_id = s.tenant_id AND existing.site_id = s.site_id
                      AND existing.user_id = $5 AND existing.active) AS existing_membership
             FROM subscriptions s JOIN plans p ON p.id = s.plan_id AND p.active
            WHERE s.tenant_id = $1 AND s.site_id = $2
              AND (s.status = 'active' OR
                   (s.status IN ('past_due','cancelled') AND s.grace_ends_at >= $4))
            FOR UPDATE OF s`,
          [invited.tenant_id, invited.site_id, invited.id, input.now, existingUser?.id ?? null],
        ),
        'Active subscription seat entitlement was not found',
      );
      const requestedSeat = capacity.existing_membership ? 0 : 1;
      if (
        capacity.active_memberships + capacity.pending_other + requestedSeat >
        capacity.customer_seat_limit
      ) {
        return undefined;
      }
      let user: { id: string };
      let sessionPasswordHash = input.passwordHash;
      if (existingUser) {
        if (
          existingUser.status !== 'active' ||
          !(await input.verifyExistingPassword(existingUser.password_hash))
        ) {
          return undefined;
        }
        user = existingUser;
        sessionPasswordHash = existingUser.password_hash;
      } else {
        user = requiredRow(
          await query<{ id: string }>(
            client,
            `INSERT INTO users (normalized_email, display_name) VALUES ($1, $2) RETURNING id`,
            [invited.normalized_email, input.displayName],
          ),
          'Invited user creation failed',
        );
        await client.query(
          `INSERT INTO credentials (user_id, password_hash, password_changed_at)
           VALUES ($1, $2, $3)`,
          [user.id, input.passwordHash, input.now],
        );
      }
      await client.query(
        `INSERT INTO memberships (tenant_id, site_id, user_id, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, site_id, user_id) DO UPDATE
           SET role = EXCLUDED.role, active = true, updated_at = now()`,
        [invited.tenant_id, invited.site_id, user.id, role],
      );
      await client.query(`UPDATE customer_invitations SET accepted_at = $1 WHERE id = $2`, [
        input.now,
        invited.id,
      ]);
      await insertAudit(client, {
        action: 'customer.invitation.accepted',
        actorId: user.id,
        metadata: { existingAccount: Boolean(existingUser), host, invitationId: invited.id, role },
        siteId: invited.site_id,
        targetId: invited.id,
        targetType: 'customer_invitation',
        tenantId: invited.tenant_id,
        traceId: input.traceId,
      });
      return {
        host,
        passwordHash: sessionPasswordHash,
        role,
        siteId: invited.site_id,
        tenantId: invited.tenant_id,
        userId: user.id,
      };
    });
  }

  async findLoginTarget(input: {
    host: string;
    normalizedEmail: string;
  }): Promise<LoginTarget | undefined> {
    const host = normalizeHost(input.host);
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<LoginRow>(
        client,
        `WITH customer_target AS (
           SELECT u.id AS user_id, c.password_hash, c.blocked_until, m.role,
                  m.tenant_id, m.site_id, d.hostname AS host
             FROM users u
             JOIN credentials c ON c.user_id = u.id
             JOIN memberships m ON m.user_id = u.id AND m.active
             JOIN sites st ON st.id = m.site_id AND st.tenant_id = m.tenant_id AND st.status = 'active'
             JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
             JOIN domains d ON d.site_id = m.site_id AND d.tenant_id = m.tenant_id
              AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
            WHERE u.normalized_email = $1 AND u.status = 'active' AND d.hostname = $2
         ), platform_target AS (
           SELECT u.id AS user_id, c.password_hash, c.blocked_until, pm.role,
                  NULL::uuid AS tenant_id, NULL::uuid AS site_id, $2::text AS host
             FROM users u
             JOIN credentials c ON c.user_id = u.id
             JOIN platform_memberships pm ON pm.user_id = u.id AND pm.active
            WHERE u.normalized_email = $1 AND u.status = 'active' AND $2 = $3
         )
         SELECT * FROM customer_target
         UNION ALL
         SELECT * FROM platform_target
         LIMIT 2`,
        [input.normalizedEmail, host, this.#orapHostname],
      );
      if (result.rows.length !== 1) return undefined;
      const row = result.rows[0];
      const role = parseRole(row?.role);
      if (!row || !role) return undefined;
      return {
        ...(row.blocked_until ? { blockedUntil: row.blocked_until } : {}),
        host: row.host,
        passwordHash: row.password_hash,
        role,
        ...(row.site_id ? { siteId: row.site_id } : {}),
        ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
        userId: row.user_id,
      };
    });
  }

  async findMfaFactor(userId: string): Promise<MfaFactorRecord | undefined> {
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{
        encrypted_secret: Buffer;
        id: string;
        key_version: number;
      }>(
        client,
        `SELECT id, encrypted_secret, key_version
           FROM mfa_factors
          WHERE user_id = $1 AND kind = 'totp' AND verified_at IS NOT NULL AND revoked_at IS NULL
          LIMIT 2`,
        [userId],
      );
      if (result.rows.length !== 1) return undefined;
      const row = result.rows[0];
      return row
        ? { encryptedSecret: row.encrypted_secret, id: row.id, keyVersion: row.key_version }
        : undefined;
    });
  }

  async clearLoginFailures(userId: string): Promise<void> {
    await withAuthTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE credentials
            SET failed_attempts = 0, blocked_until = NULL, updated_at = now()
          WHERE user_id = $1`,
        [userId],
      );
    });
  }

  async recordLoginFailure(input: {
    host: string;
    traceId: string;
    userId: string;
  }): Promise<void> {
    await withAuthTransaction(this.pool, async (client) => {
      const result = await query<{ blocked_until: Date | null; failed_attempts: number }>(
        client,
        `UPDATE credentials
            SET failed_attempts = failed_attempts + 1,
                blocked_until = CASE
                  WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
                  ELSE blocked_until
                END,
                updated_at = now()
          WHERE user_id = $1
          RETURNING failed_attempts, blocked_until`,
        [input.userId],
      );
      const failure = result.rows[0];
      await insertAudit(client, {
        action: 'auth.login.failed',
        actorId: input.userId,
        metadata: {
          failedAttempts: failure?.failed_attempts ?? null,
          host: normalizeHost(input.host),
          locked: Boolean(failure?.blocked_until),
        },
        targetId: input.userId,
        targetType: 'user',
        traceId: input.traceId,
      });
    });
  }

  async createSession(input: {
    expiresAt: Date;
    host: string;
    siteId?: string;
    tenantId?: string;
    tokenHash: string;
    traceId: string;
    userId: string;
    authenticationMethod: 'mfa' | 'password';
  }): Promise<void> {
    if (Boolean(input.siteId) !== Boolean(input.tenantId)) {
      throw new Error('Session tenant and site scope must be provided together');
    }
    await withAuthTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO sessions (user_id, tenant_id, site_id, host, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.userId,
          input.tenantId ?? null,
          input.siteId ?? null,
          normalizeHost(input.host),
          input.tokenHash,
          input.expiresAt,
        ],
      );
      await insertAudit(client, {
        action: 'auth.login.succeeded',
        actorId: input.userId,
        metadata: {
          authenticationMethod: input.authenticationMethod,
          host: normalizeHost(input.host),
        },
        ...(input.siteId ? { siteId: input.siteId } : {}),
        targetId: input.userId,
        targetType: 'user',
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        traceId: input.traceId,
      });
      if (input.authenticationMethod === 'mfa') {
        await insertAudit(client, {
          action: 'auth.mfa.verified',
          actorId: input.userId,
          metadata: { host: normalizeHost(input.host) },
          ...(input.siteId ? { siteId: input.siteId } : {}),
          targetId: input.userId,
          targetType: 'user',
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          traceId: input.traceId,
        });
      }
    });
  }

  async createPasswordRecovery(input: {
    expiresAt: Date;
    normalizedEmail: string;
    traceId: string;
    tokenHash: string;
  }): Promise<{ normalizedEmail: string } | undefined> {
    return withAuthTransaction(this.pool, async (client) => {
      const user = await query<{ normalized_email: string; user_id: string }>(
        client,
        `SELECT id AS user_id, normalized_email
           FROM users
          WHERE normalized_email = $1 AND status = 'active'
          LIMIT 2`,
        [input.normalizedEmail],
      );
      if (user.rows.length !== 1 || !user.rows[0]) return undefined;
      await client.query(
        `UPDATE password_recovery_tokens
            SET used_at = now()
          WHERE user_id = $1 AND used_at IS NULL`,
        [user.rows[0].user_id],
      );
      await client.query(
        `INSERT INTO password_recovery_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.rows[0].user_id, input.tokenHash, input.expiresAt],
      );
      await insertAudit(client, {
        action: 'auth.password_recovery.requested',
        actorId: user.rows[0].user_id,
        targetId: user.rows[0].user_id,
        targetType: 'user',
        traceId: input.traceId,
      });
      return { normalizedEmail: user.rows[0].normalized_email };
    });
  }

  async completePasswordRecovery(input: {
    newPasswordHash: string;
    now: Date;
    traceId: string;
    tokenHash: string;
  }): Promise<boolean> {
    return withAuthTransaction(this.pool, async (client) => {
      const token = await query<{ id: string; user_id: string }>(
        client,
        `SELECT id, user_id
           FROM password_recovery_tokens
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
          FOR UPDATE`,
        [input.tokenHash, input.now],
      );
      if (token.rows.length !== 1 || !token.rows[0]) return false;
      const credential = await query<{ user_id: string }>(
        client,
        `UPDATE credentials
            SET password_hash = $1, password_changed_at = $2, failed_attempts = 0,
                blocked_until = NULL, updated_at = $2
          WHERE user_id = $3
          RETURNING user_id`,
        [input.newPasswordHash, input.now, token.rows[0].user_id],
      );
      if (credential.rows.length !== 1) return false;
      await client.query(`UPDATE password_recovery_tokens SET used_at = $1 WHERE id = $2`, [
        input.now,
        token.rows[0].id,
      ]);
      await client.query(
        `UPDATE sessions
            SET revoked_at = $1, revoke_reason = 'password-recovery'
          WHERE user_id = $2 AND revoked_at IS NULL`,
        [input.now, token.rows[0].user_id],
      );
      await insertAudit(client, {
        action: 'auth.password_recovery.completed',
        actorId: token.rows[0].user_id,
        metadata: { sessionsRevoked: true },
        targetId: token.rows[0].user_id,
        targetType: 'user',
        traceId: input.traceId,
      });
      return true;
    });
  }

  async findSessionOwner(tokenHash: string): Promise<{ userId: string } | undefined> {
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{ user_id: string }>(
        client,
        `SELECT user_id FROM sessions
          WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
          LIMIT 2`,
        [tokenHash],
      );
      return result.rows.length === 1 && result.rows[0]
        ? { userId: result.rows[0].user_id }
        : undefined;
    });
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{
        created_at: Date;
        expires_at: Date;
        host: string;
        id: string;
        last_seen_at: Date;
      }>(
        client,
        `SELECT id, host, created_at, last_seen_at, expires_at
           FROM sessions
          WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
          ORDER BY last_seen_at DESC`,
        [userId],
      );
      return result.rows.map((row) => ({
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        host: row.host,
        id: row.id,
        lastSeenAt: row.last_seen_at,
      }));
    });
  }

  async revokeSession(input: {
    currentUserId: string;
    now: Date;
    sessionId: string;
    traceId: string;
  }): Promise<boolean> {
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{ id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = $1, revoke_reason = 'user-revoked'
          WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL
          RETURNING id`,
        [input.now, input.sessionId, input.currentUserId],
      );
      if (result.rows.length !== 1) return false;
      await insertAudit(client, {
        action: 'auth.session.revoked',
        actorId: input.currentUserId,
        metadata: { revokeReason: 'user-revoked' },
        targetId: input.sessionId,
        targetType: 'session',
        traceId: input.traceId,
      });
      return true;
    });
  }

  async revokeSessionByToken(input: {
    now: Date;
    tokenHash: string;
    traceId: string;
  }): Promise<void> {
    await withAuthTransaction(this.pool, async (client) => {
      const revoked = await query<{ id: string; user_id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = $1, revoke_reason = 'logout'
          WHERE token_hash = $2 AND revoked_at IS NULL
          RETURNING id, user_id`,
        [input.now, input.tokenHash],
      );
      if (revoked.rows[0]) {
        await insertAudit(client, {
          action: 'auth.logout',
          actorId: revoked.rows[0].user_id,
          metadata: { revokeReason: 'logout' },
          targetId: revoked.rows[0].id,
          targetType: 'session',
          traceId: input.traceId,
        });
      }
    });
  }

  async useRecoveryCode(input: {
    codeHash: string;
    factorId: string;
    now: Date;
  }): Promise<boolean> {
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{ id: string }>(
        client,
        `UPDATE mfa_recovery_codes
            SET used_at = $1
          WHERE factor_id = $2 AND code_hash = $3 AND used_at IS NULL
          RETURNING id`,
        [input.now, input.factorId, input.codeHash],
      );
      return result.rows.length === 1;
    });
  }

  async verifyOwnerBootstrap(input: { now: Date; tokenHash: string }): Promise<boolean> {
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{ singleton: boolean }>(
        client,
        `SELECT singleton FROM owner_bootstrap
          WHERE singleton AND token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
          LIMIT 1`,
        [input.tokenHash, input.now],
      );
      return result.rows.length === 1;
    });
  }

  async completeOwnerBootstrap(input: {
    displayName: string;
    encryptedMfaSecret: Uint8Array;
    keyVersion: number;
    normalizedEmail: string;
    now: Date;
    passwordHash: string;
    recoveryCodeHashes: string[];
    traceId: string;
    tokenHash: string;
  }): Promise<boolean> {
    return withAuthTransaction(this.pool, async (client) => {
      const bootstrap = await query<{ singleton: boolean }>(
        client,
        `SELECT singleton FROM owner_bootstrap
          WHERE singleton AND token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
          FOR UPDATE`,
        [input.tokenHash, input.now],
      );
      if (bootstrap.rows.length !== 1) return false;
      const existing = await query<{ count: string }>(
        client,
        `SELECT count(*)::text AS count FROM platform_memberships`,
        [],
      );
      if (existing.rows[0]?.count !== '0') return false;
      const user = await query<{ id: string }>(
        client,
        `INSERT INTO users (normalized_email, display_name)
         VALUES ($1, $2)
         RETURNING id`,
        [input.normalizedEmail, input.displayName],
      );
      if (!user.rows[0]) throw new Error('Owner user creation failed');
      await client.query(
        `INSERT INTO credentials (user_id, password_hash, password_changed_at)
         VALUES ($1, $2, $3)`,
        [user.rows[0].id, input.passwordHash, input.now],
      );
      await client.query(
        `INSERT INTO platform_memberships (user_id, role)
         VALUES ($1, 'platform_owner')`,
        [user.rows[0].id],
      );
      const factor = await query<{ id: string }>(
        client,
        `INSERT INTO mfa_factors
           (user_id, kind, encrypted_secret, key_version, verified_at)
         VALUES ($1, 'totp', $2, $3, $4)
         RETURNING id`,
        [user.rows[0].id, Buffer.from(input.encryptedMfaSecret), input.keyVersion, input.now],
      );
      if (!factor.rows[0]) throw new Error('Owner MFA creation failed');
      await client.query(
        `INSERT INTO mfa_recovery_codes (factor_id, code_hash)
         SELECT $1, unnest($2::text[])`,
        [factor.rows[0].id, input.recoveryCodeHashes],
      );
      await client.query(
        `UPDATE owner_bootstrap
            SET consumed_at = $1, consumed_by = $2
          WHERE singleton`,
        [input.now, user.rows[0].id],
      );
      await insertAudit(client, {
        action: 'auth.owner_bootstrap.completed',
        actorId: user.rows[0].id,
        metadata: { mfaConfigured: true },
        targetId: user.rows[0].id,
        targetType: 'user',
        traceId: input.traceId,
      });
      return true;
    });
  }
}

interface AuthAuditInput {
  action: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
  siteId?: string;
  targetId?: string;
  targetType?: string;
  tenantId?: string;
  traceId: string;
}

async function insertAudit(
  client: AuthenticationTransactionClient,
  input: AuthAuditInput,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (tenant_id, site_id, actor_id, action, trace_id, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      input.tenantId ?? null,
      input.siteId ?? null,
      input.actorId ?? null,
      input.action,
      input.traceId,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function query<T extends Record<string, unknown>>(
  client: AuthenticationTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}

async function withAuthTransaction<T>(
  pool: AuthenticationTransactionPool,
  operation: (client: AuthenticationTransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_auth');
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

function parseRole(value: string | undefined): Role | undefined {
  return roles.find((role) => role === value);
}

function normalizeHost(value: string): string {
  if (!value || /[\s/@]/u.test(value)) throw new Error('Invalid authentication host');
  const hostname = new URL(`https://${value}`).hostname.replace(/\.$/u, '');
  const ascii = domainToASCII(hostname).toLowerCase();
  if (!ascii || ascii.length > 253 || !/^[a-z0-9.-]+$/u.test(ascii)) {
    throw new Error('Invalid authentication host');
  }
  return ascii;
}

function requiredRow<T extends Record<string, unknown>>(result: { rows: T[] }, message: string): T {
  if (!result.rows[0]) throw new Error(message);
  return result.rows[0];
}
