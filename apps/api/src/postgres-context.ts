import {
  digestToken,
  isRegisteredOrapCapability,
  roles,
  type OrapAssignmentGrant,
  type OrapAuthorizationState,
  type Role,
} from '@omnireach/auth';
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
  authentication_assurance: string;
  authorization_version: number;
  grants: unknown;
  membership_id: string;
  role: string;
  user_id: string;
  verified_at: Date;
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
    if (hostname === this.#orapHostname) return undefined;
    const result = await this.authSessionQuery<CustomerContextRow>(
      `SELECT s.user_id, s.tenant_id, s.site_id, m.role,
              COALESCE((m.permissions ->> 'content.publish')::boolean, false) AS editor_publish_grant
         FROM sessions s
         JOIN users u ON u.id = s.user_id AND u.status = 'active'
         JOIN memberships m
           ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id AND m.site_id = s.site_id AND m.active
         LEFT JOIN account_authentication_policies ap ON ap.user_id = s.user_id
         JOIN domains d
           ON d.tenant_id = s.tenant_id AND d.site_id = s.site_id
          AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
        WHERE s.token_hash = $1 AND s.host = $2 AND d.hostname = $2
          AND NOT s.recovery_restricted
          AND (
            COALESCE(ap.second_step_requirement, 'optional') = 'optional'
            OR (
              s.authentication_assurance IN ('baseline', 'strong')
              AND s.verified_at IS NOT NULL
            )
          )
          AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.last_seen_at > now() - interval '30 minutes'
        LIMIT 2`,
      [digestToken(token), hostname],
      (rows) => {
        const role = parseRole(rows[0]?.role);
        return rows.length === 1 && Boolean(role?.startsWith('customer_'));
      },
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
    if (hostname === this.#orapHostname) return undefined;
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
    return this.platformWithToken(request, token);
  }

  async platformGoogleCallback(request: FastifyRequest): Promise<AdminActor | undefined> {
    const token = readCookie(request, '__Secure-omnireach_google_oauth');
    return this.platformWithToken(request, token);
  }

  private async platformWithToken(
    request: FastifyRequest,
    token: string | undefined,
  ): Promise<AdminActor | undefined> {
    if (!token || normalizeHostname(request.hostname) !== this.#orapHostname) return undefined;
    const result = await this.authSessionQuery<PlatformContextRow>(
      `SELECT s.user_id, s.authentication_assurance, s.verified_at,
              pm.role, osm.id AS membership_id,
              osm.authorization_version,
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'assignmentId', assignment.id,
                    'permissionKeys', COALESCE((
                      SELECT jsonb_agg(permission.permission_key ORDER BY permission.permission_key)
                        FROM staff_role_permissions permission
                        JOIN permission_definitions definition
                          ON definition.key = permission.permission_key
                         AND definition.deprecated_at IS NULL
                         AND NOT definition.is_owner_only
                       WHERE permission.role_version_id = assignment.role_version_id
                    ), '[]'::jsonb),
                    'portfolio', EXISTS (
                      SELECT 1 FROM staff_resource_scopes scope
                       WHERE scope.assignment_id = assignment.id
                         AND scope.scope_type = 'platform'
                    ),
                    'tenantIds', COALESCE((
                      SELECT jsonb_agg(DISTINCT scope.tenant_id::text)
                        FROM staff_resource_scopes scope
                       WHERE scope.assignment_id = assignment.id
                         AND scope.scope_type IN ('tenant','site')
                         AND scope.tenant_id IS NOT NULL
                    ), '[]'::jsonb),
                    'siteIds', COALESCE((
                      SELECT jsonb_agg(DISTINCT scope.site_id::text)
                        FROM staff_resource_scopes scope
                       WHERE scope.assignment_id = assignment.id
                         AND scope.scope_type = 'site'
                         AND scope.site_id IS NOT NULL
                    ), '[]'::jsonb)
                  ) ORDER BY assignment.assigned_at, assignment.id
                )
                  FROM staff_role_assignments assignment
                  JOIN staff_roles role
                    ON role.id = assignment.role_id AND role.active
                  JOIN staff_role_versions role_version
                    ON role_version.id = assignment.role_version_id
                   AND role_version.role_id = assignment.role_id
                 WHERE assignment.staff_membership_id = osm.id
                   AND assignment.active
              ), '[]'::jsonb) AS grants
         FROM sessions s
         JOIN users u ON u.id = s.user_id AND u.status = 'active'
         JOIN platform_memberships pm ON pm.user_id = s.user_id AND pm.active
         JOIN orap_staff_memberships osm
           ON osm.user_id = s.user_id AND osm.status = 'active'
          AND osm.identity_kind = pm.role
        WHERE s.token_hash = $1 AND s.host = $2
          AND s.tenant_id IS NULL AND s.site_id IS NULL
          AND NOT s.recovery_restricted
          AND s.authentication_assurance IN ('baseline', 'strong')
          AND s.verified_at IS NOT NULL
          AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.last_seen_at > now() - interval '30 minutes'
        LIMIT 2`,
      [digestToken(token), this.#orapHostname],
      (rows) => {
        const role = parseRole(rows[0]?.role);
        return (
          rows.length === 1 &&
          Boolean(role && ['platform_owner', 'platform_admin', 'staff'].includes(role))
        );
      },
    );
    if (result.rows.length !== 1) return undefined;
    const row = result.rows[0];
    const role = parseRole(row?.role);
    if (!row || !role || !['platform_owner', 'platform_admin', 'staff'].includes(role)) {
      return undefined;
    }
    const authorization = parseOrapAuthorization(row);
    if (!authorization) return undefined;
    return {
      authenticationAssurance: row.authentication_assurance,
      authorization,
      id: row.user_id,
      role,
      traceId: String(request.id),
      verifiedAt: row.verified_at,
    };
  }

  private async authQuery<T extends Record<string, unknown>>(
    text: string,
    values: unknown[],
  ): Promise<{ rows: T[] }> {
    return withAuthTransaction(this.pool as TenantTransactionPool, async (client) => {
      return (await client.query(text, values)) as { rows: T[] };
    });
  }

  private async authSessionQuery<T extends Record<string, unknown>>(
    text: string,
    values: unknown[],
    isValid: (rows: T[]) => boolean,
  ): Promise<{ rows: T[] }> {
    return withAuthTransaction(this.pool as TenantTransactionPool, async (client) => {
      const result = (await client.query(text, values)) as { rows: T[] };
      if (!isValid(result.rows)) return result;
      const refreshed = (await client.query(
        `UPDATE sessions
            SET last_seen_at = now()
          WHERE token_hash = $1 AND host = $2
            AND revoked_at IS NULL AND expires_at > now()
            AND last_seen_at > now() - interval '30 minutes'
            AND NOT recovery_restricted
          RETURNING id`,
        [values[0], values[1]],
      )) as { rows: { id: string }[] };
      return refreshed.rows.length === 1 ? result : { rows: [] };
    });
  }
}

function parseRole(value: string | undefined): Role | undefined {
  return roles.find((role) => role === value);
}

function parseOrapAuthorization(row: PlatformContextRow): OrapAuthorizationState | undefined {
  if (
    typeof row.membership_id !== 'string' ||
    !Number.isInteger(row.authorization_version) ||
    row.authorization_version < 1 ||
    !Array.isArray(row.grants)
  ) {
    return undefined;
  }
  const grants: OrapAssignmentGrant[] = [];
  for (const value of row.grants) {
    if (!isRecord(value)) return undefined;
    const permissionKeys = stringArray(value.permissionKeys);
    const siteIds = stringArray(value.siteIds);
    const tenantIds = stringArray(value.tenantIds);
    if (
      typeof value.assignmentId !== 'string' ||
      typeof value.portfolio !== 'boolean' ||
      !permissionKeys ||
      !siteIds ||
      !tenantIds ||
      permissionKeys.some((key) => !isRegisteredOrapCapability(key))
    ) {
      return undefined;
    }
    grants.push({
      assignmentId: value.assignmentId,
      permissionKeys,
      portfolio: value.portfolio,
      siteIds,
      tenantIds,
    });
  }
  return {
    grants,
    membershipId: row.membership_id,
    version: row.authorization_version,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined;
}
