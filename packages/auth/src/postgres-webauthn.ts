import { randomUUID } from 'node:crypto';

import type { CredentialDeviceType } from '@simplewebauthn/server';

import type { AuthenticationTransactionClient, AuthenticationTransactionPool } from './postgres.ts';
import { roles, type Role } from './roles.ts';
import {
  createWebAuthnUserHandle,
  normalizeWebAuthnHost,
  type WebAuthnCredentialRecord,
  type WebAuthnEnrollmentCompletionInput,
  type WebAuthnEnrollmentRepository,
  type WebAuthnEnrollmentTarget,
  type WebAuthnScopeRecord,
} from './webauthn.ts';

export interface WebAuthnScopeTarget {
  host: string;
  siteId?: string;
  tenantId?: string;
  userId: string;
}

interface ScopeRow extends Record<string, unknown> {
  created_at: Date;
  id: string;
  rp_id: string;
  site_id: string | null;
  tenant_id: string | null;
  user_handle: Uint8Array;
  user_id: string;
}

interface CredentialRow extends Record<string, unknown> {
  backed_up: boolean;
  backup_eligible: boolean;
  created_at: Date;
  credential_id: Uint8Array;
  device_type: string;
  id: string;
  last_used_at: Date | null;
  name: string;
  public_key: Uint8Array;
  revoked_at: Date | null;
  sign_count: string;
  transports: string[];
  verified_at: Date;
}

interface EnrollmentTargetRow extends Record<string, unknown> {
  auth_state_version: string;
  display_name: string;
  email_code_enabled: boolean;
  has_totp: boolean;
  has_webauthn: boolean;
  host: string;
  normalized_email: string;
  password_hash: string;
  role: string;
  scope_id: string | null;
  second_step_requirement: string;
  site_id: string | null;
  tenant_id: string | null;
  user_handle: Uint8Array | null;
  user_id: string;
}

/**
 * Auth Contract v3 exact-RP persistence boundary.
 *
 * Enrollment is the only credential write exposed here and includes recovery rotation,
 * policy activation, session revocation, and audit evidence in one transaction.
 * Standalone assertion updates and management mutations remain intentionally absent:
 * counter/backup updates must commit with session issuance, and rename/revocation must
 * preserve their own session, recovery, and audit invariants.
 */
export class PostgresWebAuthnRepository implements WebAuthnEnrollmentRepository {
  readonly #orapHostname: string;

  constructor(
    private readonly pool: AuthenticationTransactionPool,
    orapHostname: string,
  ) {
    this.#orapHostname = normalizeWebAuthnHost(orapHostname);
  }

  async findScope(target: WebAuthnScopeTarget): Promise<WebAuthnScopeRecord | undefined> {
    const normalized = this.normalizeTarget(target);
    return withWebAuthnTransaction(this.pool, async (client) => {
      const rows = await query<ScopeRow>(client, this.scopeQuery(), this.scopeValues(normalized));
      return rows.rows[0] ? mapScope(rows.rows[0]) : undefined;
    });
  }

  async ensureScope(target: WebAuthnScopeTarget): Promise<WebAuthnScopeRecord | undefined> {
    const normalized = this.normalizeTarget(target);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const scope = await withWebAuthnTransaction(this.pool, async (client) => {
        const existing = await query<ScopeRow>(
          client,
          this.scopeQuery(),
          this.scopeValues(normalized),
        );
        if (existing.rows[0]) return mapScope(existing.rows[0]);

        const userHandle = createWebAuthnUserHandle();
        const inserted = await query<ScopeRow>(
          client,
          `INSERT INTO webauthn_scopes (user_id, tenant_id, site_id, rp_id, user_handle)
           SELECT $1, $2, $3, $4, $5
            WHERE EXISTS (${this.eligibleTargetQuery()})
           ON CONFLICT DO NOTHING
           RETURNING id, user_id, tenant_id, site_id, rp_id, user_handle, created_at`,
          [...this.scopeValues(normalized), userHandle],
        );
        if (inserted.rows[0]) return mapScope(inserted.rows[0]);

        const raced = await query<ScopeRow>(
          client,
          this.scopeQuery(),
          this.scopeValues(normalized),
        );
        return raced.rows[0] ? mapScope(raced.rows[0]) : undefined;
      });
      if (scope) return scope;
    }
    return undefined;
  }

  async listActiveCredentials(target: WebAuthnScopeTarget): Promise<WebAuthnCredentialRecord[]> {
    const normalized = this.normalizeTarget(target);
    return withWebAuthnTransaction(this.pool, async (client) => {
      const result = await query<CredentialRow>(
        client,
        `SELECT credential.id, credential.credential_id, credential.public_key,
                credential.sign_count, credential.transports, credential.device_type,
                credential.backup_eligible, credential.backed_up, credential.name,
                credential.verified_at, credential.last_used_at, credential.revoked_at,
                credential.created_at
           FROM webauthn_credentials credential
           JOIN (${this.scopeQuery()}) scope ON scope.id = credential.scope_id
          WHERE credential.revoked_at IS NULL
          ORDER BY credential.created_at, credential.id`,
        this.scopeValues(normalized),
      );
      return result.rows.map(mapCredential);
    });
  }

  async findActiveCredential(input: {
    credentialId: Uint8Array;
    target: WebAuthnScopeTarget;
  }): Promise<WebAuthnCredentialRecord | undefined> {
    assertCredentialId(input.credentialId);
    const normalized = this.normalizeTarget(input.target);
    return withWebAuthnTransaction(this.pool, async (client) => {
      const result = await query<CredentialRow>(
        client,
        `SELECT credential.id, credential.credential_id, credential.public_key,
                credential.sign_count, credential.transports, credential.device_type,
                credential.backup_eligible, credential.backed_up, credential.name,
                credential.verified_at, credential.last_used_at, credential.revoked_at,
                credential.created_at
           FROM webauthn_credentials credential
           JOIN (${this.scopeQuery()}) scope ON scope.id = credential.scope_id
          WHERE credential.credential_id = $5 AND credential.revoked_at IS NULL`,
        [...this.scopeValues(normalized), input.credentialId],
      );
      return result.rows[0] ? mapCredential(result.rows[0]) : undefined;
    });
  }

  async findEnrollmentTarget(input: {
    host: string;
    now: Date;
    sessionTokenHash: string;
  }): Promise<WebAuthnEnrollmentTarget | undefined> {
    const host = normalizeWebAuthnHost(input.host);
    return withWebAuthnTransaction(this.pool, async (client) => {
      const result = await query<EnrollmentTargetRow>(
        client,
        `WITH target AS (
           SELECT auth_user.id AS user_id, auth_user.normalized_email, auth_user.display_name,
                  credential.password_hash, membership.role, session.tenant_id, session.site_id,
                  session.host, policy.auth_state_version::text,
                  policy.email_code_enabled, policy.second_step_requirement,
                  EXISTS (
                    SELECT 1 FROM mfa_factors factor
                     WHERE factor.user_id = auth_user.id AND factor.kind = 'totp'
                       AND factor.verified_at IS NOT NULL AND factor.revoked_at IS NULL
                  ) AS has_totp,
                  EXISTS (
                    SELECT 1 FROM webauthn_scopes strong_scope
                    JOIN webauthn_credentials strong_credential
                      ON strong_credential.scope_id = strong_scope.id
                     AND strong_credential.revoked_at IS NULL
                   WHERE strong_scope.user_id = auth_user.id
                     AND strong_scope.tenant_id = session.tenant_id
                     AND strong_scope.site_id = session.site_id
                     AND strong_scope.rp_id = session.host
                  ) AS has_webauthn
             FROM sessions session
             JOIN users auth_user ON auth_user.id = session.user_id AND auth_user.status = 'active'
             JOIN credentials credential ON credential.user_id = auth_user.id
             JOIN account_authentication_policies policy ON policy.user_id = auth_user.id
             JOIN memberships membership
               ON membership.user_id = auth_user.id
              AND membership.tenant_id = session.tenant_id
              AND membership.site_id = session.site_id AND membership.active
             JOIN tenants tenant ON tenant.id = membership.tenant_id AND tenant.status = 'active'
             JOIN sites site ON site.tenant_id = membership.tenant_id
              AND site.id = membership.site_id AND site.status = 'active'
             JOIN domains domain ON domain.tenant_id = membership.tenant_id
              AND domain.site_id = membership.site_id AND domain.hostname = session.host
              AND domain.kind = 'admin' AND domain.verification_status = 'verified' AND domain.active
            WHERE session.token_hash = $1 AND session.host = $2 AND $2 <> $3
              AND session.revoked_at IS NULL AND session.expires_at > $4
              AND session.last_seen_at > $4 - interval '10 minutes'
              AND NOT session.recovery_restricted
              AND NOT EXISTS (
                SELECT 1 FROM platform_memberships platform_membership
                 WHERE platform_membership.user_id = auth_user.id AND platform_membership.active
              )
              AND session.authentication_assurance IN ('baseline', 'strong')
              AND session.verified_at > $4 - interval '10 minutes'
           UNION ALL
           SELECT auth_user.id AS user_id, auth_user.normalized_email, auth_user.display_name,
                  credential.password_hash, platform_membership.role,
                  NULL::uuid AS tenant_id, NULL::uuid AS site_id, session.host,
                  policy.auth_state_version::text, policy.email_code_enabled,
                  'required'::text AS second_step_requirement,
                  EXISTS (
                    SELECT 1 FROM mfa_factors factor
                     WHERE factor.user_id = auth_user.id AND factor.kind = 'totp'
                       AND factor.verified_at IS NOT NULL AND factor.revoked_at IS NULL
                  ) AS has_totp,
                  EXISTS (
                    SELECT 1 FROM webauthn_scopes strong_scope
                    JOIN webauthn_credentials strong_credential
                      ON strong_credential.scope_id = strong_scope.id
                     AND strong_credential.revoked_at IS NULL
                   WHERE strong_scope.user_id = auth_user.id
                     AND strong_scope.tenant_id IS NULL AND strong_scope.site_id IS NULL
                     AND strong_scope.rp_id = session.host
                  ) AS has_webauthn
             FROM sessions session
             JOIN users auth_user ON auth_user.id = session.user_id AND auth_user.status = 'active'
             JOIN credentials credential ON credential.user_id = auth_user.id
             JOIN account_authentication_policies policy ON policy.user_id = auth_user.id
             JOIN platform_memberships platform_membership
               ON platform_membership.user_id = auth_user.id AND platform_membership.active
            WHERE session.token_hash = $1 AND session.host = $2 AND $2 = $3
              AND session.revoked_at IS NULL AND session.expires_at > $4
              AND session.last_seen_at > $4 - interval '10 minutes'
              AND NOT session.recovery_restricted
              AND session.verified_at > $4 - interval '10 minutes'
              AND session.authentication_assurance = 'strong'
              AND (EXISTS (
                    SELECT 1 FROM mfa_factors factor
                     WHERE factor.user_id = auth_user.id AND factor.kind = 'totp'
                       AND factor.verified_at IS NOT NULL AND factor.revoked_at IS NULL
                  ) OR EXISTS (
                    SELECT 1 FROM webauthn_scopes strong_scope
                    JOIN webauthn_credentials strong_credential
                      ON strong_credential.scope_id = strong_scope.id
                     AND strong_credential.revoked_at IS NULL
                   WHERE strong_scope.user_id = auth_user.id
                     AND strong_scope.tenant_id IS NULL AND strong_scope.site_id IS NULL
                     AND strong_scope.rp_id = session.host
                  ))
         )
         SELECT target.*, scope.id AS scope_id, scope.user_handle
           FROM target
           LEFT JOIN webauthn_scopes scope
             ON scope.user_id = target.user_id AND scope.rp_id = target.host
            AND scope.tenant_id IS NOT DISTINCT FROM target.tenant_id
            AND scope.site_id IS NOT DISTINCT FROM target.site_id
          LIMIT 2`,
        [input.sessionTokenHash, host, this.#orapHostname, input.now],
      );
      if (result.rows.length !== 1 || !result.rows[0]) return undefined;
      const row = result.rows[0];
      const role = parseRole(row.role);
      if (!role) return undefined;
      const scopeId = row.scope_id ?? randomUUID();
      const userHandle = row.user_handle
        ? new Uint8Array(row.user_handle)
        : createWebAuthnUserHandle();
      const credentials = row.scope_id
        ? await query<Pick<CredentialRow, 'credential_id' | 'transports' | 'revoked_at'>>(
            client,
            `SELECT credential_id, transports, revoked_at
               FROM webauthn_credentials
              WHERE scope_id = $1
              ORDER BY created_at, id`,
            [scopeId],
          )
        : { rows: [] };
      return {
        activeCredentialCount: credentials.rows.filter((credential) => !credential.revoked_at)
          .length,
        authStateVersion: row.auth_state_version,
        createdAt: input.now,
        credentials: credentials.rows.map((credential) => ({
          credentialId: new Uint8Array(credential.credential_id),
          transports: [...credential.transports],
        })),
        displayName: row.display_name,
        emailCodeEnabled: row.email_code_enabled,
        hasTotp: row.has_totp,
        hasWebAuthn: row.has_webauthn,
        host: row.host,
        id: scopeId,
        normalizedEmail: row.normalized_email,
        passwordHash: row.password_hash,
        role,
        rpId: row.host,
        secondStepRequired: row.second_step_requirement === 'required',
        ...(row.site_id ? { siteId: row.site_id } : {}),
        ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
        userHandle,
        userId: row.user_id,
      };
    });
  }

  async completeEnrollment(input: WebAuthnEnrollmentCompletionInput): Promise<boolean> {
    const target = this.normalizeTarget({
      host: input.host,
      ...(input.siteId ? { siteId: input.siteId } : {}),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      userId: input.userId,
    });
    if (!validEnrollmentCompletion(input)) return false;
    return withWebAuthnTransaction(this.pool, async (client) => {
      const account = await query<{
        auth_state_version: string;
        email_code_enabled: boolean;
        password_hash: string;
        second_step_requirement: string;
      }>(
        client,
        `SELECT credential.password_hash, policy.auth_state_version::text,
                policy.email_code_enabled, policy.second_step_requirement
           FROM users auth_user
           JOIN credentials credential ON credential.user_id = auth_user.id
           JOIN account_authentication_policies policy ON policy.user_id = auth_user.id
          WHERE auth_user.id = $1 AND auth_user.status = 'active'
          FOR UPDATE OF auth_user, credential, policy`,
        [target.userId],
      );
      const lockedAccount = account.rows[0];
      if (
        account.rows.length !== 1 ||
        !lockedAccount ||
        lockedAccount.auth_state_version !== input.expectedAuthStateVersion ||
        !input.verifyCredentialState(lockedAccount.password_hash, input.credentialStateDigest)
      ) {
        return false;
      }

      const sessions = await query<{
        authentication_assurance: string;
        site_id: string | null;
        tenant_id: string | null;
        verified_at: Date | null;
      }>(
        client,
        `SELECT tenant_id, site_id, authentication_assurance, verified_at
           FROM sessions
          WHERE token_hash = $1 AND user_id = $2 AND host = $3
            AND revoked_at IS NULL AND expires_at > $4
            AND last_seen_at > $4 - interval '10 minutes'
            AND NOT recovery_restricted
          FOR UPDATE`,
        [input.sessionTokenHash, target.userId, target.host, input.now],
      );
      const session = sessions.rows[0];
      if (
        sessions.rows.length !== 1 ||
        !session ||
        (session.tenant_id ?? undefined) !== target.tenantId ||
        (session.site_id ?? undefined) !== target.siteId
      ) {
        return false;
      }

      const authorization = target.tenantId
        ? await query<{ role: string }>(
            client,
            `SELECT membership.role
               FROM memberships membership
               JOIN tenants tenant
                 ON tenant.id = membership.tenant_id AND tenant.status = 'active'
               JOIN sites site
                 ON site.tenant_id = membership.tenant_id
                AND site.id = membership.site_id AND site.status = 'active'
               JOIN domains domain
                 ON domain.tenant_id = membership.tenant_id
                AND domain.site_id = membership.site_id
                AND domain.hostname = $4 AND domain.kind = 'admin'
                AND domain.verification_status = 'verified' AND domain.active
              WHERE membership.user_id = $1 AND membership.tenant_id = $2
                AND membership.site_id = $3 AND membership.active
                AND NOT EXISTS (
                  SELECT 1 FROM platform_memberships platform_membership
                   WHERE platform_membership.user_id = membership.user_id
                     AND platform_membership.active
                )
              FOR UPDATE OF membership, tenant, site, domain`,
            [target.userId, target.tenantId, target.siteId, target.host],
          )
        : await query<{ role: string }>(
            client,
            `SELECT role
               FROM platform_memberships
              WHERE user_id = $1 AND active AND $2 = $3
              FOR UPDATE`,
            [target.userId, target.host, this.#orapHostname],
          );
      const role = authorization.rows[0] ? parseRole(authorization.rows[0].role) : undefined;
      if (
        authorization.rows.length !== 1 ||
        !role ||
        (target.tenantId
          ? !role.startsWith('customer_')
          : !role.startsWith('platform_') && role !== 'staff')
      ) {
        return false;
      }

      const factors = await query<{ id: string }>(
        client,
        `SELECT id
           FROM mfa_factors
          WHERE user_id = $1 AND kind = 'totp'
            AND verified_at IS NOT NULL AND revoked_at IS NULL
          FOR UPDATE`,
        [target.userId],
      );
      const credentialRows = await query<{ credential_id: Uint8Array; revoked_at: Date | null }>(
        client,
        `SELECT webauthn_credential.credential_id, webauthn_credential.revoked_at
           FROM webauthn_scopes webauthn_scope
           JOIN webauthn_credentials webauthn_credential
             ON webauthn_credential.scope_id = webauthn_scope.id
          WHERE webauthn_scope.user_id = $1 AND webauthn_scope.rp_id = $2
            AND webauthn_scope.tenant_id IS NOT DISTINCT FROM $3::uuid
            AND webauthn_scope.site_id IS NOT DISTINCT FROM $4::uuid
          FOR UPDATE OF webauthn_credential`,
        [target.userId, target.host, target.tenantId ?? null, target.siteId ?? null],
      );
      const hasTotp = factors.rows.length > 0;
      const hasWebAuthn = credentialRows.rows.some((credential) => !credential.revoked_at);
      const verifiedRecently = Boolean(
        session.verified_at && session.verified_at > new Date(input.now.getTime() - 10 * 60_000),
      );
      const assuranceAllowed = target.tenantId
        ? verifiedRecently && ['baseline', 'strong'].includes(session.authentication_assurance)
        : verifiedRecently &&
          (hasTotp || hasWebAuthn) &&
          session.authentication_assurance === 'strong';
      if (
        !assuranceAllowed ||
        (!lockedAccount.email_code_enabled && !hasTotp && !hasWebAuthn) ||
        credentialRows.rows.filter((credential) => !credential.revoked_at).length >= 10
      ) {
        return false;
      }

      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended(encode($1, 'hex'), 0))`, [
        input.credentialId,
      ]);
      const duplicate = await query<{ id: string }>(
        client,
        `SELECT webauthn_credential.id
           FROM webauthn_credentials webauthn_credential
           JOIN webauthn_scopes webauthn_scope
             ON webauthn_scope.id = webauthn_credential.scope_id
          WHERE webauthn_scope.rp_id = $1 AND webauthn_credential.credential_id = $2
          LIMIT 1`,
        [target.host, input.credentialId],
      );
      if (duplicate.rows.length !== 0) return false;

      const existingScope = await query<ScopeRow>(
        client,
        `SELECT id, user_id, tenant_id, site_id, rp_id, user_handle, created_at
           FROM webauthn_scopes
          WHERE user_id = $1 AND rp_id = $2
            AND tenant_id IS NOT DISTINCT FROM $3::uuid
            AND site_id IS NOT DISTINCT FROM $4::uuid
          FOR UPDATE`,
        [target.userId, target.host, target.tenantId ?? null, target.siteId ?? null],
      );
      const scope = existingScope.rows[0];
      if (
        (scope &&
          (scope.id !== input.scopeId ||
            !Buffer.from(scope.user_handle).equals(Buffer.from(input.userHandle)))) ||
        existingScope.rows.length > 1
      ) {
        return false;
      }
      if (!scope) {
        await client.query(
          `INSERT INTO webauthn_scopes
             (id, user_id, tenant_id, site_id, rp_id, user_handle, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            input.scopeId,
            target.userId,
            target.tenantId ?? null,
            target.siteId ?? null,
            target.host,
            input.userHandle,
            input.now,
          ],
        );
      }

      await client.query(
        `INSERT INTO webauthn_credentials
           (scope_id, credential_id, public_key, sign_count, transports, device_type,
            backup_eligible, backed_up, name, verified_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10)`,
        [
          input.scopeId,
          input.credentialId,
          input.publicKey,
          input.signCount,
          input.transports,
          input.deviceType,
          input.backupEligible,
          input.backedUp,
          input.credentialName,
          input.now,
        ],
      );
      const revokedCodes = await query<{ id: string }>(
        client,
        `UPDATE account_recovery_codes
            SET revoked_at = $2
          WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL
          RETURNING id`,
        [target.userId, input.now],
      );
      const nextSet = await query<{ set_version: number }>(
        client,
        `SELECT COALESCE(max(set_version), 0)::integer + 1 AS set_version
           FROM account_recovery_codes
          WHERE user_id = $1`,
        [target.userId],
      );
      await client.query(
        `INSERT INTO account_recovery_codes (user_id, set_version, code_hash, created_at)
         SELECT $1, $2, code_hash, $4
           FROM unnest($3::text[]) AS code_hash`,
        [target.userId, nextSet.rows[0]?.set_version ?? 1, input.recoveryCodeHashes, input.now],
      );
      await client.query(
        `UPDATE account_authentication_policies
            SET second_step_requirement = 'required', preferred_method = 'webauthn',
                updated_at = $2
          WHERE user_id = $1`,
        [target.userId, input.now],
      );
      const revokedSessions = await query<{ id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = $2, revoke_reason = 'webauthn-enrollment'
          WHERE user_id = $1 AND revoked_at IS NULL
          RETURNING id`,
        [target.userId, input.now],
      );
      await client.query(
        `INSERT INTO audit_events
           (tenant_id, site_id, actor_id, action, trace_id, target_type, target_id, metadata)
         VALUES ($1, $2, $3, 'auth.webauthn.enrolled', $4, 'user', $3, $5::jsonb)`,
        [
          target.tenantId ?? null,
          target.siteId ?? null,
          target.userId,
          input.traceId,
          JSON.stringify({
            backupEligible: input.backupEligible,
            deviceType: input.deviceType,
            recoveryCodesIssued: input.recoveryCodeHashes.length,
            recoveryCodesRevoked: revokedCodes.rows.length,
            sessionsRevoked: revokedSessions.rows.length,
          }),
        ],
      );
      return true;
    });
  }

  private eligibleTargetQuery(): string {
    return `SELECT 1
              FROM users auth_user
             WHERE auth_user.id = $1 AND auth_user.status = 'active'
               AND (
                 ($2::uuid IS NULL AND $3::uuid IS NULL
                   AND $4 = '${this.#orapHostname.replaceAll("'", "''")}'
                   AND EXISTS (
                     SELECT 1 FROM platform_memberships platform_membership
                      WHERE platform_membership.user_id = auth_user.id
                        AND platform_membership.active
                   ))
                 OR
                 ($2::uuid IS NOT NULL AND $3::uuid IS NOT NULL
                   AND $4 <> '${this.#orapHostname.replaceAll("'", "''")}'
                   AND EXISTS (
                     SELECT 1
                       FROM memberships membership
                       JOIN sites site
                         ON site.tenant_id = membership.tenant_id
                        AND site.id = membership.site_id
                        AND site.status = 'active'
                       JOIN tenants tenant
                         ON tenant.id = membership.tenant_id AND tenant.status = 'active'
                       JOIN domains domain
                         ON domain.tenant_id = membership.tenant_id
                        AND domain.site_id = membership.site_id
                        AND domain.hostname = $4
                        AND domain.kind = 'admin'
                        AND domain.verification_status = 'verified'
                        AND domain.active
                      WHERE membership.user_id = auth_user.id
                        AND membership.tenant_id = $2 AND membership.site_id = $3
                        AND membership.active
                   ))
               )`;
  }

  private scopeQuery(): string {
    return `SELECT scope.id, scope.user_id, scope.tenant_id, scope.site_id,
                   scope.rp_id, scope.user_handle, scope.created_at
              FROM webauthn_scopes scope
             WHERE scope.user_id = $1
               AND scope.tenant_id IS NOT DISTINCT FROM $2::uuid
               AND scope.site_id IS NOT DISTINCT FROM $3::uuid
               AND scope.rp_id = $4
               AND EXISTS (${this.eligibleTargetQuery()})`;
  }

  private scopeValues(target: WebAuthnScopeTarget): unknown[] {
    return [target.userId, target.tenantId ?? null, target.siteId ?? null, target.host];
  }

  private normalizeTarget(target: WebAuthnScopeTarget): WebAuthnScopeTarget {
    const host = normalizeWebAuthnHost(target.host);
    if (Boolean(target.tenantId) !== Boolean(target.siteId)) {
      throw new Error('WebAuthn customer scope requires tenant and site');
    }
    if (host === this.#orapHostname && (target.tenantId || target.siteId)) {
      throw new Error('ORAP WebAuthn scope cannot be tenant-bound');
    }
    if (host !== this.#orapHostname && (!target.tenantId || !target.siteId)) {
      throw new Error('Customer WebAuthn scope must be tenant-bound');
    }
    return { ...target, host };
  }
}

async function withWebAuthnTransaction<T>(
  pool: AuthenticationTransactionPool,
  operation: (client: AuthenticationTransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_auth');
    await client.query(`SELECT set_config('app.authentication_contract_version', '3', true)`);
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

async function query<T extends Record<string, unknown>>(
  client: AuthenticationTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}

function mapScope(row: ScopeRow): WebAuthnScopeRecord {
  return {
    createdAt: row.created_at,
    id: row.id,
    rpId: row.rp_id,
    ...(row.site_id ? { siteId: row.site_id } : {}),
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    userHandle: new Uint8Array(row.user_handle),
    userId: row.user_id,
  };
}

function mapCredential(row: CredentialRow): WebAuthnCredentialRecord {
  const signCount = Number(row.sign_count);
  assertCounter(signCount);
  const deviceType = parseDeviceType(row.device_type);
  return {
    backedUp: row.backed_up,
    backupEligible: row.backup_eligible,
    createdAt: row.created_at,
    credentialId: new Uint8Array(row.credential_id),
    deviceType,
    id: row.id,
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
    name: row.name,
    publicKey: new Uint8Array(row.public_key),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    signCount,
    transports: [...row.transports],
    verifiedAt: row.verified_at,
  };
}

function assertCredentialId(credentialId: Uint8Array): void {
  if (credentialId.byteLength < 1 || credentialId.byteLength > 1023) {
    throw new Error('Invalid WebAuthn credential ID');
  }
}

function assertCounter(counter: number): void {
  if (!Number.isSafeInteger(counter) || counter < 0 || counter > 4_294_967_295) {
    throw new Error('Invalid WebAuthn signature counter');
  }
}

function parseDeviceType(value: string): CredentialDeviceType {
  if (value === 'singleDevice' || value === 'multiDevice') return value;
  throw new Error('Invalid persisted WebAuthn device type');
}

function parseRole(value: string): Role | undefined {
  return roles.find((role) => role === value);
}

function validEnrollmentCompletion(input: WebAuthnEnrollmentCompletionInput): boolean {
  const isUuid = (value: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
  const allowedTransports = new Set([
    'ble',
    'cable',
    'hybrid',
    'internal',
    'nfc',
    'smart-card',
    'usb',
  ]);
  return Boolean(
    isUuid(input.userId) &&
    isUuid(input.scopeId) &&
    Boolean(input.tenantId) === Boolean(input.siteId) &&
    (!input.tenantId || isUuid(input.tenantId)) &&
    (!input.siteId || isUuid(input.siteId)) &&
    /^[1-9][0-9]*$/u.test(input.expectedAuthStateVersion) &&
    /^[a-f0-9]{64}$/u.test(input.credentialStateDigest) &&
    /^[a-f0-9]{64}$/u.test(input.sessionTokenHash) &&
    input.userHandle.byteLength === 64 &&
    input.credentialId.byteLength >= 1 &&
    input.credentialId.byteLength <= 1023 &&
    input.publicKey.byteLength >= 1 &&
    input.publicKey.byteLength <= 4096 &&
    Number.isSafeInteger(input.signCount) &&
    input.signCount >= 0 &&
    input.signCount <= 4_294_967_295 &&
    input.credentialName === input.credentialName.trim() &&
    input.credentialName.length >= 1 &&
    input.credentialName.length <= 80 &&
    !/[\u0000-\u001f\u007f]/u.test(input.credentialName) &&
    input.transports.length <= 8 &&
    new Set(input.transports).size === input.transports.length &&
    input.transports.every((transport) => allowedTransports.has(transport)) &&
    (input.deviceType === 'multiDevice') === input.backupEligible &&
    (!input.backedUp || input.backupEligible) &&
    input.recoveryCodeHashes.length === 10 &&
    input.recoveryCodeHashes.every((digest) => /^[a-f0-9]{64}$/u.test(digest)) &&
    new Set(input.recoveryCodeHashes).size === input.recoveryCodeHashes.length &&
    input.traceId.length >= 1 &&
    input.traceId.length <= 128,
  );
}
