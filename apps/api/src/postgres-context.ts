import { digestToken, roles, type Role } from '@omnireach/auth';
import {
  normalizeHostname,
  withAuthTransaction,
  type AdminActor,
  type TenantTransactionPool,
} from '@omnireach/tenant';
import type { FastifyRequest } from 'fastify';

import type { CustomerPrincipal } from './customer-routes.ts';
import type { ContactSiteContext } from './contact-routes.ts';
import { readCookie } from './request-auth.ts';

export interface ContextQueryPool {
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<unknown>;
    release(): void;
  }>;
}

interface CustomerContextRow extends Record<string, unknown> {
  editor_publish_grant: boolean;
  role: string;
  site_id: string;
  tenant_id: string;
  user_id: string;
}

interface PlatformContextRow extends Record<string, unknown> {
  role: string;
  user_id: string;
}

export class PostgresRequestContextResolver {
  readonly #orapHostname: string;

  constructor(
    private readonly pool: ContextQueryPool,
    orapHostname: string,
  ) {
    this.#orapHostname = normalizeHostname(orapHostname);
  }

  async customer(request: FastifyRequest): Promise<CustomerPrincipal | undefined> {
    const token = readCookie(request, '__Host-omnireach_session');
    if (!token) return undefined;
    const hostname = normalizeHostname(request.hostname);
    const result = await this.authQuery<CustomerContextRow>(
      `SELECT s.user_id, s.tenant_id, s.site_id, m.role,
              COALESCE((m.permissions ->> 'content.publish')::boolean, false) AS editor_publish_grant
         FROM sessions s
         JOIN users u ON u.id = s.user_id AND u.status = 'active'
         JOIN memberships m
           ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id AND m.site_id = s.site_id AND m.active
         JOIN domains d
           ON d.tenant_id = s.tenant_id AND d.site_id = s.site_id
          AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
        WHERE s.token_hash = $1 AND s.host = $2 AND d.hostname = $2
          AND s.revoked_at IS NULL AND s.expires_at > now()
        LIMIT 2`,
      [digestToken(token), hostname],
    );
    if (result.rows.length !== 1) return undefined;
    const row = result.rows[0];
    const role = parseRole(row?.role);
    if (!row || !role || !role.startsWith('customer_')) return undefined;
    return {
      editorPublishGrant: row.editor_publish_grant,
      role,
      siteId: row.site_id,
      tenantId: row.tenant_id,
      traceId: String(request.id),
      userId: row.user_id,
    };
  }

  async contact(request: FastifyRequest): Promise<ContactSiteContext | undefined> {
    const hostname = normalizeHostname(request.hostname);
    const result = await this.authQuery<{ site_id: string; tenant_id: string }>(
      `SELECT d.tenant_id, d.site_id
         FROM domains d
         JOIN sites s ON s.tenant_id = d.tenant_id AND s.id = d.site_id
        WHERE d.hostname = $1 AND d.kind = 'public' AND d.active
          AND d.verification_status = 'verified' AND s.status = 'active'
        LIMIT 2`,
      [hostname],
    );
    if (result.rows.length !== 1) return undefined;
    const row = result.rows[0];
    return row
      ? { allowedOrigin: `https://${hostname}`, siteId: row.site_id, tenantId: row.tenant_id }
      : undefined;
  }

  async platform(request: FastifyRequest): Promise<AdminActor | undefined> {
    const token = readCookie(request, '__Host-omnireach_session');
    if (!token || normalizeHostname(request.hostname) !== this.#orapHostname) return undefined;
    const result = await this.authQuery<PlatformContextRow>(
      `SELECT s.user_id, pm.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id AND u.status = 'active'
         JOIN platform_memberships pm ON pm.user_id = s.user_id AND pm.active
        WHERE s.token_hash = $1 AND s.host = $2
          AND s.tenant_id IS NULL AND s.site_id IS NULL
          AND s.revoked_at IS NULL AND s.expires_at > now()
        LIMIT 2`,
      [digestToken(token), this.#orapHostname],
    );
    if (result.rows.length !== 1) return undefined;
    const row = result.rows[0];
    const role = parseRole(row?.role);
    if (!row || !role || !['platform_owner', 'platform_admin', 'staff'].includes(role)) {
      return undefined;
    }
    return { id: row.user_id, role, traceId: String(request.id) };
  }

  private async authQuery<T extends Record<string, unknown>>(
    text: string,
    values: unknown[],
  ): Promise<{ rows: T[] }> {
    return withAuthTransaction(this.pool as TenantTransactionPool, async (client) => {
      return (await client.query(text, values)) as { rows: T[] };
    });
  }
}

function parseRole(value: string | undefined): Role | undefined {
  return roles.find((role) => role === value);
}
