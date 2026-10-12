import type { CredentialDeviceType } from '@simplewebauthn/server';

import type { AuthenticationTransactionClient, AuthenticationTransactionPool } from './postgres.ts';
import {
  createWebAuthnUserHandle,
  normalizeWebAuthnHost,
  type WebAuthnCredentialRecord,
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

/**
 * Inert Auth Contract v3 persistence boundary.
 *
 * Credential writes are intentionally absent. Enrollment/revocation must revoke
 * sessions and write audit evidence in the same transaction; assertion counter updates
 * must commit in the same transaction as session issuance. Those mutations belong to
 * the later route/service slices and must not be reconstructed from these read methods.
 */
export class PostgresWebAuthnRepository {
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
