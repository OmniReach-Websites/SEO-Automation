import { randomUUID } from 'node:crypto';

import {
  assertOrapCapability,
  assertPlatformOwnerIdentity,
  canOrap,
  createOneTimeToken,
  hashPassword,
  normalizeEmail,
  OrapAuthorizationDeniedError,
  orapVisibleScope,
  type OrapResourceTarget,
} from '@omnireach/auth';
import {
  assertPlanFeatureAllowed,
  defaultGraceEndsAt,
  withPlatformTransaction,
  type AdminActor,
  type CustomerRole,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import { OrapResourceNotFoundError } from './orap-errors.ts';
import {
  analyticsDelta,
  deriveVisibilityOpportunities,
  type AnalyticsAvailability,
  type AnalyticsKpi,
  type AnalyticsSearchRow,
  type OrapAnalyticsDashboard,
  type OrapAnalyticsInput,
} from './orap-analytics.ts';
import type { OrapAdministrationEndpointService, PlanEntitlementsInput } from './orap-routes.ts';

export interface InvitationNotifier {
  send(input: { host: string; normalizedEmail: string; token: string }): Promise<void>;
}

export class PostgresOrapService implements OrapAdministrationEndpointService {
  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly invitations: InvitationNotifier,
    private readonly requestRecovery: (input: {
      host: string;
      networkIdentifier: string;
      normalizedEmail: string;
      traceId: string;
    }) => Promise<void>,
    private readonly siteContracts: ReadonlyMap<
      string,
      {
        businessLocationCount?: number;
        contactForms?: readonly {
          fieldIds: readonly string[];
          id: string;
          requiredFieldIds: readonly string[];
        }[];
        contractHash: string;
        contractVersion: string;
        standardPageCount?: number;
      }
    > = new Map(),
  ) {}

  createPlan(
    actor: AdminActor,
    input: {
      code: string;
      entitlements: PlanEntitlementsInput;
      features: { enabled: boolean; key: string; version: number }[];
      name: string;
      reason: string;
      version: number;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'plans.edit');
    for (const feature of input.features) assertPlanFeatureAllowed(feature.key);
    return this.transaction(actor, async (client) => {
      for (const requested of input.features) {
        const feature = required(
          (
            await query<{ key: string; readiness: 'deployable' | 'planned' | 'tested' }>(
              client,
              `SELECT key, readiness FROM feature_definitions
                WHERE key = $1 AND version = $2`,
              [requested.key, requested.version],
            )
          ).rows[0],
          `Feature definition was not found: ${requested.key}@${requested.version}`,
        );
        if (
          input.entitlements.commercialStatus === 'approved' &&
          requested.enabled &&
          feature.readiness !== 'deployable'
        ) {
          throw new Error(`Approved plans cannot enable a nondeployable feature: ${feature.key}`);
        }
      }
      const plan = required(
        (
          await query<{ code: string; id: string; name: string; version: number }>(
            client,
            `INSERT INTO plans
               (code, name, version, monthly_price_cents, currency, commercial_status,
                customer_seat_limit, standard_page_limit, business_location_limit,
                seo_audit_interval_hours, ai_review_cycles_per_month,
                pending_invitations_count_as_seats)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id, code, name, version`,
            [
              input.code,
              input.name.trim(),
              input.version,
              input.entitlements.monthlyPriceCents,
              input.entitlements.currency,
              input.entitlements.commercialStatus,
              input.entitlements.customerSeatLimit,
              input.entitlements.standardPageLimit,
              input.entitlements.businessLocationLimit,
              input.entitlements.seoAuditIntervalHours,
              input.entitlements.aiReviewCyclesPerMonth,
              input.entitlements.pendingInvitationsCountAsSeats,
            ],
          )
        ).rows[0],
        'Plan creation failed',
      );
      for (const feature of input.features) {
        await client.query(
          `INSERT INTO plan_features (plan_id, feature_key, feature_version, enabled)
           VALUES ($1, $2, $3, $4)`,
          [plan.id, feature.key, feature.version, feature.enabled],
        );
      }
      await audit(client, actor, {
        action: 'plan.created',
        after: { ...plan, entitlements: input.entitlements, features: input.features },
        before: null,
        reason: input.reason,
        targetId: plan.id,
        targetType: 'plan',
      });
      return { ...plan, entitlements: input.entitlements, features: input.features };
    });
  }

  listStaff(actor: AdminActor): Promise<unknown> {
    assertPlatformOwnerIdentity(actor);
    return this.transaction(actor, async (client) => {
      const result = await query<{
        active_sessions: number;
        authorization_version: number;
        created_at: Date;
        display_name: string;
        email_code_enabled: boolean;
        identity_kind: string;
        job_title: string | null;
        last_login_at: Date | null;
        membership_id: string;
        normalized_email: string;
        role_name: string | null;
        role_slug: string | null;
        status: string;
        strong_factor_enrolled: boolean;
        user_id: string;
      }>(
        client,
        `SELECT membership.id AS membership_id,
                membership.user_id,
                membership.identity_kind,
                membership.status,
                membership.job_title,
                membership.authorization_version,
                membership.created_at,
                user_account.normalized_email,
                user_account.display_name,
                assigned_role.name AS role_name,
                assigned_role.slug AS role_slug,
                authentication.email_code_enabled,
                authentication.strong_factor_enrolled,
                (SELECT max(session.created_at) FROM sessions session
                  WHERE session.user_id = membership.user_id
                    AND session.tenant_id IS NULL AND session.site_id IS NULL)
                  AS last_login_at,
                (SELECT count(*)::integer FROM sessions session
                  WHERE session.user_id = membership.user_id
                    AND session.tenant_id IS NULL AND session.site_id IS NULL
                    AND session.revoked_at IS NULL AND session.expires_at > now())
                  AS active_sessions
           FROM orap_staff_memberships membership
           JOIN users user_account ON user_account.id = membership.user_id
           JOIN orap_staff_directory_auth_status authentication
             ON authentication.user_id = membership.user_id
           LEFT JOIN LATERAL (
             SELECT role.name, role.slug
               FROM staff_role_assignments assignment
               JOIN staff_roles role ON role.id = assignment.role_id
              WHERE assignment.staff_membership_id = membership.id
                AND assignment.active AND assignment.primary_role
              ORDER BY assignment.assigned_at DESC
              LIMIT 1
           ) assigned_role ON true
          WHERE membership.status <> 'archived'
          ORDER BY CASE membership.identity_kind
                     WHEN 'platform_owner' THEN 0
                     WHEN 'platform_admin' THEN 1
                     ELSE 2
                   END,
                   lower(user_account.display_name), membership.id`,
        [],
      );
      return result.rows.map((row) => ({
        activeSessions: row.active_sessions,
        authorizationVersion: row.authorization_version,
        createdAt: row.created_at.toISOString(),
        displayName: row.display_name,
        emailCodeEnabled: row.email_code_enabled,
        identityKind: row.identity_kind,
        ...(row.job_title ? { jobTitle: row.job_title } : {}),
        ...(row.last_login_at ? { lastLoginAt: row.last_login_at.toISOString() } : {}),
        membershipId: row.membership_id,
        normalizedEmail: row.normalized_email,
        ...(row.role_name ? { roleName: row.role_name } : {}),
        ...(row.role_slug ? { roleSlug: row.role_slug } : {}),
        status: row.status,
        strongFactorEnrolled: row.strong_factor_enrolled,
        userId: row.user_id,
      }));
    });
  }

  listStaffRoles(actor: AdminActor): Promise<unknown> {
    assertPlatformOwnerIdentity(actor);
    return this.transaction(actor, async (client) => {
      const result = await query<{
        description: string;
        name: string;
        permission_count: number;
        slug: string;
      }>(
        client,
        `SELECT role.slug, role.name, role.description, version.permission_count
           FROM staff_roles role
           JOIN staff_role_versions version
             ON version.role_id = role.id AND version.version = role.current_version
          WHERE role.active AND NOT role.owner_identity_only
          ORDER BY role.display_order, role.name`,
        [],
      );
      return result.rows.map((row) => ({
        description: row.description,
        name: row.name,
        permissionCount: row.permission_count,
        slug: row.slug,
      }));
    });
  }

  async updateStaffAccount(
    actor: AdminActor,
    input: {
      displayName: string;
      email: string;
      jobTitle?: string;
      newPassword?: string;
      reason: string;
      userId: string;
    },
  ): Promise<unknown> {
    assertStaffAuthorityMutation(actor, input.reason);
    const normalizedEmail = normalizeEmail(input.email);
    const passwordHash = input.newPassword ? await hashPassword(input.newPassword) : null;
    return this.transaction(actor, async (client) => {
      const result = await query<{
        password_replaced: boolean;
        revoked_sessions: number;
        updated_display_name: string;
        updated_job_title: string | null;
        updated_normalized_email: string;
      }>(client, `SELECT * FROM orap_owner_update_staff_account($1, $2, $3, $4, $5, $6, $7)`, [
        input.userId,
        input.displayName.trim(),
        normalizedEmail,
        input.jobTitle?.trim() ?? '',
        passwordHash,
        input.reason.trim(),
        actor.traceId,
      ]);
      const updated = required(result.rows[0], 'ORAP staff account update failed');
      return {
        displayName: updated.updated_display_name,
        ...(updated.updated_job_title ? { jobTitle: updated.updated_job_title } : {}),
        normalizedEmail: updated.updated_normalized_email,
        passwordReplaced: updated.password_replaced,
        revokedSessions: updated.revoked_sessions,
      };
    });
  }

  async inviteStaff(
    actor: AdminActor,
    input: {
      displayName: string;
      email: string;
      host: string;
      jobTitle?: string;
      reason: string;
      roleSlug: string;
    },
  ): Promise<unknown> {
    assertStaffAuthorityMutation(actor, input.reason);
    const normalizedEmail = normalizeEmail(input.email);
    const oneTimeToken = createOneTimeToken();
    const invitation = await this.transaction(actor, async (client) => {
      await client.query(
        `UPDATE staff_invitations
            SET state = 'expired'
          WHERE normalized_email = $1 AND state = 'pending' AND expires_at <= now()`,
        [normalizedEmail],
      );
      const existing = await query<{ id: string }>(
        client,
        `SELECT membership.id
           FROM users user_account
           JOIN platform_memberships membership
             ON membership.user_id = user_account.id AND membership.active
          WHERE user_account.normalized_email = $1
          LIMIT 1`,
        [normalizedEmail],
      );
      if (existing.rows.length) throw new Error('That email already has active ORAP access');
      const role = required(
        (
          await query<{ id: string; name: string; role_version_id: string; slug: string }>(
            client,
            `SELECT role.id, role.slug, role.name, version.id AS role_version_id
               FROM staff_roles role
               JOIN staff_role_versions version
                 ON version.role_id = role.id AND version.version = role.current_version
              WHERE role.slug = $1 AND role.active AND NOT role.owner_identity_only
              FOR SHARE OF role, version`,
            [input.roleSlug],
          )
        ).rows[0],
        'Assignable staff role was not found',
      );
      const created = required(
        (
          await query<{ id: string; expires_at: Date }>(
            client,
            `INSERT INTO staff_invitations
               (normalized_email, display_name, token_hash, exact_host, role_id,
                role_version_id, scope_plan, created_by, expires_at, last_sent_at)
             VALUES ($1, $2, $3, $4, $5, $6,
                     jsonb_build_array(
                       jsonb_build_object('scopeType', 'platform'),
                       jsonb_build_object('jobTitle', $8::text)
                     ),
                     $7, now() + interval '7 days', now())
             RETURNING id, expires_at`,
            [
              normalizedEmail,
              input.displayName.trim(),
              oneTimeToken.digest,
              input.host.toLowerCase(),
              role.id,
              role.role_version_id,
              actor.id,
              input.jobTitle?.trim() ?? '',
            ],
          )
        ).rows[0],
        'Staff invitation creation failed',
      );
      await staffAccessAudit(client, actor, {
        action: 'staff.invited',
        after: { invitationId: created.id, normalizedEmail, roleSlug: role.slug },
        before: null,
        reason: input.reason,
        targetUserId: null,
      });
      return { ...created, roleName: role.name };
    });
    try {
      await this.invitations.send({
        host: input.host,
        normalizedEmail,
        token: oneTimeToken.token,
      });
    } catch (error) {
      await this.transaction(actor, async (client) => {
        await client.query(
          `UPDATE staff_invitations
              SET state = 'revoked', revoked_at = now(), revoked_by = $2
            WHERE id = $1 AND state = 'pending'`,
          [invitation.id, actor.id],
        );
      });
      throw error;
    }
    return {
      expiresAt: invitation.expires_at.toISOString(),
      invitationId: invitation.id,
      roleName: invitation.roleName,
      status: 'pending',
    };
  }

  changeStaffRole(
    actor: AdminActor,
    input: { reason: string; roleSlug: string; userId: string },
  ): Promise<unknown> {
    assertStaffAuthorityMutation(actor, input.reason);
    if (input.userId === actor.id)
      throw new Error('The current owner identity cannot be reassigned');
    return this.transaction(actor, async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('orap-platform-owner-authority', 0))`,
      );
      const target = required(
        (
          await query<{ identity_kind: string; membership_id: string }>(
            client,
            `SELECT id AS membership_id, identity_kind
               FROM orap_staff_memberships
              WHERE user_id = $1 AND status = 'active'
              FOR UPDATE`,
            [input.userId],
          )
        ).rows[0],
        'Active staff account was not found',
      );
      const ownerAuthorityRequested = input.roleSlug === 'platform-owner';
      const role = required(
        (
          await query<{
            id: string;
            name: string;
            owner_identity_only: boolean;
            role_version_id: string;
            slug: string;
          }>(
            client,
            `SELECT role.id, role.slug, role.name, role.owner_identity_only,
                    version.id AS role_version_id
               FROM staff_roles role
               JOIN staff_role_versions version
                 ON version.role_id = role.id AND version.version = role.current_version
              WHERE role.slug = $1 AND role.active AND role.owner_identity_only = $2
              FOR SHARE OF role, version`,
            [input.roleSlug, ownerAuthorityRequested],
          )
        ).rows[0],
        'Assignable authority level was not found',
      );
      const before = await query<Record<string, unknown>>(
        client,
        `SELECT assignment.id, role.slug, role.name
           FROM staff_role_assignments assignment
           JOIN staff_roles role ON role.id = assignment.role_id
          WHERE assignment.staff_membership_id = $1 AND assignment.active
          FOR UPDATE OF assignment`,
        [target.membership_id],
      );
      if (target.identity_kind === 'platform_owner' && !ownerAuthorityRequested) {
        const owners = await query<{ id: string }>(
          client,
          `SELECT id
             FROM orap_staff_memberships
            WHERE identity_kind = 'platform_owner' AND status = 'active'
            FOR UPDATE`,
          [],
        );
        if (owners.rows.length <= 1) {
          throw new Error('The last active Platform Owner cannot be demoted');
        }
      }
      await client.query(
        `UPDATE staff_role_assignments
            SET active = false, revoked_by = $2, revoked_at = now()
          WHERE staff_membership_id = $1 AND active`,
        [target.membership_id, actor.id],
      );
      if (!ownerAuthorityRequested) {
        const assignment = required(
          (
            await query<{ id: string }>(
              client,
              `INSERT INTO staff_role_assignments
                 (staff_membership_id, role_id, role_version_id, primary_role,
                  assigned_by, reason)
               VALUES ($1, $2, $3, true, $4, $5)
               RETURNING id`,
              [target.membership_id, role.id, role.role_version_id, actor.id, input.reason.trim()],
            )
          ).rows[0],
          'Staff role assignment failed',
        );
        await client.query(
          `INSERT INTO staff_resource_scopes
             (assignment_id, scope_type, created_by)
           VALUES ($1, 'platform', $2)`,
          [assignment.id, actor.id],
        );
      }
      const identityKind = ownerAuthorityRequested
        ? 'platform_owner'
        : role.slug === 'platform-admin'
          ? 'platform_admin'
          : 'staff';
      await client.query(
        `UPDATE orap_staff_memberships
            SET identity_kind = $2, authorization_version = authorization_version + 1,
                updated_at = now()
          WHERE id = $1`,
        [target.membership_id, identityKind],
      );
      await client.query(
        `UPDATE platform_memberships SET role = $2, updated_at = now()
          WHERE user_id = $1 AND active`,
        [input.userId, identityKind],
      );
      const revoked = await query<{ id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = now(), revoke_reason = 'orap_staff_role_changed'
          WHERE user_id = $1 AND tenant_id IS NULL AND site_id IS NULL
            AND revoked_at IS NULL
          RETURNING id`,
        [input.userId],
      );
      await staffAccessAudit(client, actor, {
        action:
          identityKind === 'platform_owner' && target.identity_kind !== 'platform_owner'
            ? 'staff.owner_assigned'
            : target.identity_kind === 'platform_owner' && identityKind !== 'platform_owner'
              ? 'staff.owner_removed'
              : 'staff.role_changed',
        after: { identityKind, roleSlug: role.slug, revokedSessions: revoked.rows.length },
        before: { assignments: before.rows, identityKind: target.identity_kind },
        reason: input.reason,
        targetUserId: input.userId,
      });
      return { identityKind, roleName: role.name, revokedSessions: revoked.rows.length };
    });
  }

  disableStaff(actor: AdminActor, input: { reason: string; userId: string }): Promise<unknown> {
    assertStaffAuthorityMutation(actor, input.reason);
    if (input.userId === actor.id) {
      throw new Error('The current Platform Owner cannot disable their own account');
    }
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<{
            identity_kind: string;
            membership_id: string;
            status: string;
            user_id: string;
          }>(
            client,
            `SELECT membership.id AS membership_id, membership.user_id,
                    membership.identity_kind, membership.status
               FROM orap_staff_memberships membership
               JOIN platform_memberships legacy
                 ON legacy.user_id = membership.user_id
              WHERE membership.user_id = $1
              FOR UPDATE OF membership, legacy`,
            [input.userId],
          )
        ).rows[0],
        'Staff account was not found',
      );
      if (before.status !== 'active') throw new OrapResourceNotFoundError();
      if (before.identity_kind === 'platform_owner') {
        const owners = await query<{ id: string }>(
          client,
          `SELECT id
             FROM orap_staff_memberships
            WHERE identity_kind = 'platform_owner' AND status = 'active'
            FOR UPDATE`,
          [],
        );
        if (owners.rows.length <= 1) {
          throw new Error('The last active Platform Owner cannot be disabled');
        }
      }
      const after = required(
        (
          await query<{
            authorization_version: number;
            identity_kind: string;
            status: string;
            user_id: string;
          }>(
            client,
            `UPDATE orap_staff_memberships
                SET status = 'disabled', disabled_at = now(), updated_at = now(),
                    authorization_version = authorization_version + 1
              WHERE user_id = $1 AND status = 'active'
              RETURNING user_id, identity_kind, status, authorization_version`,
            [input.userId],
          )
        ).rows[0],
        'Staff account disable failed',
      );
      await client.query(
        `UPDATE platform_memberships SET active = false, updated_at = now()
          WHERE user_id = $1 AND active`,
        [input.userId],
      );
      const revoked = await query<{ id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = now(), revoke_reason = 'orap_staff_disabled'
          WHERE user_id = $1 AND tenant_id IS NULL AND site_id IS NULL
            AND revoked_at IS NULL
          RETURNING id`,
        [input.userId],
      );
      await staffAccessAudit(client, actor, {
        action: 'staff.disabled',
        after: { ...after, revokedSessions: revoked.rows.length },
        before,
        reason: input.reason,
        targetUserId: input.userId,
      });
      return { ...after, revokedSessions: revoked.rows.length };
    });
  }

  revokeStaffSessions(
    actor: AdminActor,
    input: { reason: string; userId: string },
  ): Promise<unknown> {
    assertStaffAuthorityMutation(actor, input.reason);
    return this.transaction(actor, async (client) => {
      const target = await query<{ user_id: string }>(
        client,
        `SELECT user_id FROM orap_staff_memberships
          WHERE user_id = $1 AND status = 'active' FOR SHARE`,
        [input.userId],
      );
      if (target.rows.length !== 1) throw new OrapResourceNotFoundError();
      const revoked = await query<{ id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = now(), revoke_reason = 'orap_owner_revocation'
          WHERE user_id = $1 AND tenant_id IS NULL AND site_id IS NULL
            AND revoked_at IS NULL
          RETURNING id`,
        [input.userId],
      );
      await staffAccessAudit(client, actor, {
        action: 'staff.sessions_revoked',
        after: { revokedSessions: revoked.rows.length },
        before: null,
        reason: input.reason,
        targetUserId: input.userId,
      });
      return { revokedSessions: revoked.rows.length };
    });
  }

  async requestStaffReset(
    actor: AdminActor,
    input: { host: string; networkIdentifier: string; reason: string; userId: string },
  ): Promise<unknown> {
    assertStaffAuthorityMutation(actor, input.reason);
    const target = await this.transaction(actor, async (client) => {
      const row = required(
        (
          await query<{ normalized_email: string; user_id: string }>(
            client,
            `SELECT membership.user_id, user_account.normalized_email
               FROM orap_staff_memberships membership
               JOIN users user_account ON user_account.id = membership.user_id
              WHERE membership.user_id = $1 AND membership.status = 'active'
              FOR SHARE OF membership, user_account`,
            [input.userId],
          )
        ).rows[0],
        'Staff account was not found',
      );
      await staffAccessAudit(client, actor, {
        action: 'staff.password_reset_requested',
        after: { delivery: 'requested' },
        before: null,
        reason: input.reason,
        targetUserId: input.userId,
      });
      return row;
    });
    await this.requestRecovery({
      host: input.host,
      networkIdentifier: input.networkIdentifier,
      normalizedEmail: target.normalized_email,
      traceId: actor.traceId,
    });
    return { status: 'accepted' };
  }

  assignPlan(
    actor: AdminActor,
    input: { planId: string; reason: string; siteId: string; tenantId: string },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'subscriptions.edit', input);
    return this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const plan = await query<{
        business_location_limit: number;
        id: string;
        standard_page_limit: number;
      }>(
        client,
        `SELECT id, standard_page_limit, business_location_limit
           FROM plans WHERE id = $1 AND active`,
        [input.planId],
      );
      const selectedPlan = required(plan.rows[0], 'Active plan was not found');
      const siteScope = required(
        (
          await query<{ business_location_count: number; standard_page_count: number }>(
            client,
            `SELECT standard_page_count, business_location_count FROM sites
              WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
            [input.tenantId, input.siteId],
          )
        ).rows[0],
        'Site was not found',
      );
      if (siteScope.standard_page_count > selectedPlan.standard_page_limit) {
        throw new Error('Site standard-page count exceeds plan entitlement');
      }
      if (siteScope.business_location_count > selectedPlan.business_location_limit) {
        throw new Error('Site business-location count exceeds plan entitlement');
      }
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM subscriptions WHERE tenant_id = $1 AND site_id = $2 FOR UPDATE`,
            [input.tenantId, input.siteId],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO subscriptions (tenant_id, site_id, plan_id, status)
             VALUES ($1, $2, $3, 'active')
             ON CONFLICT (site_id) DO UPDATE
               SET plan_id = EXCLUDED.plan_id, status = 'active', grace_ends_at = NULL,
                   updated_at = now()
             RETURNING *`,
            [input.tenantId, input.siteId, input.planId],
          )
        ).rows[0],
        'Plan assignment failed',
      );
      await audit(client, actor, {
        action: 'site.plan_assigned',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: String(after.id),
        targetType: 'subscription',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  listSites(actor: AdminActor): Promise<unknown> {
    assertOrapCapability(actor, 'websites.list');
    const scope = orapVisibleScope(actor, 'websites.list');
    return this.transaction(actor, async (client) => {
      const result = await query<{
        id: string;
        name: string;
        status: string;
        tenant_id: string;
        tenant_name: string;
      }>(
        client,
        `SELECT s.id, s.tenant_id, s.name, s.status, t.name AS tenant_name
           FROM sites s JOIN tenants t ON t.id = s.tenant_id
          WHERE $1::boolean
             OR s.tenant_id = ANY($2::uuid[])
             OR s.id = ANY($3::uuid[])
          ORDER BY t.name, s.name`,
        [scope.portfolio, [...scope.tenantIds], [...scope.siteIds]],
      );
      return result.rows.map((site) => ({
        id: site.id,
        name: site.name,
        status: site.status,
        tenantId: site.tenant_id,
        tenantName: site.tenant_name,
      }));
    });
  }

  listAnalyticsSites(actor: AdminActor): Promise<unknown> {
    assertOrapCapability(actor, 'analytics.view');
    const scope = orapVisibleScope(actor, 'analytics.view');
    return this.transaction(actor, async (client) => {
      const result = await query<{
        id: string;
        name: string;
        status: string;
        tenant_id: string;
        tenant_name: string;
      }>(
        client,
        `SELECT s.id, s.tenant_id, s.name, s.status, t.name AS tenant_name
           FROM sites s
           JOIN tenants t ON t.id = s.tenant_id
          WHERE s.status = 'active'
            AND ($1::boolean OR s.tenant_id = ANY($2::uuid[]) OR s.id = ANY($3::uuid[]))
          ORDER BY t.name, s.name`,
        [scope.portfolio, [...scope.tenantIds], [...scope.siteIds]],
      );
      return result.rows.map((site) => ({
        id: site.id,
        name: site.name,
        status: site.status,
        tenantId: site.tenant_id,
        tenantName: site.tenant_name,
      }));
    });
  }

  siteAnalytics(actor: AdminActor, input: OrapAnalyticsInput): Promise<OrapAnalyticsDashboard> {
    assertOrapCapability(actor, 'analytics.view', input);
    return this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const queryOrder = analyticsOrderBy(input.querySort);
      const pageOrder = analyticsOrderBy(input.pageSort);
      const scopeValues = [input.tenantId, input.siteId, input.previousStartDate, input.endDate];
      const siteResult = await query<{
        id: string;
        name: string;
        tenant_id: string;
        tenant_name: string;
      }>(
        client,
        `SELECT s.id, s.tenant_id, s.name, t.name AS tenant_name
             FROM sites s
             JOIN tenants t ON t.id = s.tenant_id
            WHERE s.tenant_id = $1 AND s.id = $2 AND s.status = 'active'`,
        [input.tenantId, input.siteId],
      );
      const connectionsResult = await query<{
        available_end_date: Date | string | null;
        available_start_date: Date | string | null;
        last_synced_at: Date | string | null;
        property_id: string;
        property_kind: 'ga4' | 'search_console';
        property_mapping: string;
        refresh_failure_code: string | null;
        status: string;
      }>(
        client,
        `SELECT connection.property_kind, connection.property_id,
                  connection.property_mapping, connection.status,
                  connection.last_synced_at, connection.refresh_failure_code,
                  (SELECT min(snapshot.window_start)::date::text
                     FROM metric_snapshots snapshot
                    WHERE snapshot.tenant_id = $1 AND snapshot.site_id = $2
                      AND snapshot.connection_id = connection.id) AS available_start_date,
                  (SELECT max(snapshot.window_start)::date::text
                     FROM metric_snapshots snapshot
                    WHERE snapshot.tenant_id = $1 AND snapshot.site_id = $2
                      AND snapshot.connection_id = connection.id) AS available_end_date
             FROM integration_connections connection
            WHERE connection.tenant_id = $1 AND connection.site_id = $2
              AND connection.provider = 'google'
            ORDER BY connection.property_kind`,
        [input.tenantId, input.siteId],
      );
      const searchDailyResult = await query<AnalyticsDailyRow>(client, searchDailySql, scopeValues);
      const gaDailyResult = await query<AnalyticsDailyRow>(client, gaDailySql, scopeValues);
      const queryResult = await query<AnalyticsSearchResultRow>(
        client,
        searchDimensionSql('query', queryOrder),
        [
          input.tenantId,
          input.siteId,
          input.previousStartDate,
          input.previousEndDate,
          input.startDate,
          input.endDate,
          input.limit,
        ],
      );
      const pageResult = await query<AnalyticsSearchResultRow>(
        client,
        searchDimensionSql('page', pageOrder),
        [
          input.tenantId,
          input.siteId,
          input.previousStartDate,
          input.previousEndDate,
          input.startDate,
          input.endDate,
          input.limit,
        ],
      );
      const technicalResult = await query<AnalyticsTechnicalRow>(
        client,
        `WITH latest_crawl AS (
             SELECT id, state, completed_at
               FROM crawl_runs
              WHERE tenant_id = $1 AND site_id = $2
              ORDER BY started_at DESC
              LIMIT 1
           )
           SELECT
             (SELECT state FROM latest_crawl) AS crawl_state,
             (SELECT completed_at FROM latest_crawl) AS crawl_completed_at,
             CASE WHEN EXISTS (SELECT 1 FROM latest_crawl)
                  THEN (SELECT count(*)::integer FROM crawl_pages page
                         WHERE page.tenant_id = $1 AND page.site_id = $2
                           AND page.crawl_run_id = (SELECT id FROM latest_crawl))
             END AS pages_crawled,
             CASE WHEN EXISTS (SELECT 1 FROM latest_crawl)
                  THEN (SELECT count(*)::integer FROM crawl_pages page
                         WHERE page.tenant_id = $1 AND page.site_id = $2
                           AND page.crawl_run_id = (SELECT id FROM latest_crawl)
                           AND (page.status < 200 OR page.status >= 400))
             END AS failing_pages,
             count(*) FILTER (WHERE finding.state IN ('open','acknowledged'))::integer
               AS open_findings,
             count(*) FILTER (WHERE finding.state IN ('open','acknowledged')
                               AND finding.severity = 'critical')::integer AS critical,
             count(*) FILTER (WHERE finding.state IN ('open','acknowledged')
                               AND finding.severity = 'high')::integer AS high,
             count(*) FILTER (WHERE finding.state IN ('open','acknowledged')
                               AND finding.severity = 'medium')::integer AS medium,
             count(*) FILTER (WHERE finding.state IN ('open','acknowledged')
                               AND finding.severity = 'low')::integer AS low,
             count(*) FILTER (WHERE finding.state IN ('open','acknowledged')
                               AND finding.severity = 'info')::integer AS info,
             count(*) FILTER (WHERE finding.state = 'resolved'
                                AND finding.resolved_at >= $3::date
                                AND finding.resolved_at < ($4::date + interval '1 day'))::integer
                AS resolved_findings
             FROM findings finding
            WHERE finding.tenant_id = $1 AND finding.site_id = $2`,
        [input.tenantId, input.siteId, input.startDate, input.endDate],
      );
      const findingResult = await query<AnalyticsFindingRow>(
        client,
        `SELECT rule_id, severity, state, evidence, limitation, remediation
             FROM findings
            WHERE tenant_id = $1 AND site_id = $2
              AND state IN ('open','acknowledged')
            ORDER BY CASE severity
                       WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3
                       WHEN 'low' THEN 4 ELSE 5 END,
                     last_seen_at DESC, rule_id
            LIMIT 10`,
        [input.tenantId, input.siteId],
      );
      const timelineResult = await query<AnalyticsTimelineRow>(
        client,
        `SELECT category, occurred_at, state
             FROM (
               SELECT job.category, COALESCE(job.completed_at, job.updated_at) AS occurred_at,
                      job.state
                 FROM jobs job
                WHERE job.tenant_id = $1 AND job.site_id = $2
                  AND COALESCE(job.completed_at, job.updated_at) >= $3::date
                  AND COALESCE(job.completed_at, job.updated_at) < ($4::date + interval '1 day')
               UNION ALL
               SELECT 'publication' AS category,
                      COALESCE(publication.completed_at, publication.created_at) AS occurred_at,
                      publication.status AS state
                 FROM publication_requests publication
                WHERE publication.tenant_id = $1 AND publication.site_id = $2
                  AND COALESCE(publication.completed_at, publication.created_at) >= $3::date
                  AND COALESCE(publication.completed_at, publication.created_at)
                        < ($4::date + interval '1 day')
             ) event
            ORDER BY occurred_at DESC, category
            LIMIT 30`,
        [input.tenantId, input.siteId, input.startDate, input.endDate],
      );

      const site = required(siteResult.rows[0], 'Site was not found');
      const connections = connectionsResult.rows.map((connection) => ({
        availableEndDate: dateOnlyNullableString(connection.available_end_date),
        availableStartDate: dateOnlyNullableString(connection.available_start_date),
        lastErrorCode: connection.refresh_failure_code,
        lastSyncedAt: dateTimeString(connection.last_synced_at),
        propertyId: connection.property_id,
        propertyKind: connection.property_kind,
        propertyMapping: connection.property_mapping,
        status: connection.status,
      }));
      const searchDaily = searchDailyResult.rows.map(toDailyPoint);
      const gaDaily = gaDailyResult.rows.map(toDailyPoint);
      const topQueries = queryResult.rows.map(toSearchRow);
      const topPages = pageResult.rows.map(toSearchRow);
      const searchConnection = connections.find(
        ({ propertyKind }) => propertyKind === 'search_console',
      );
      const gaConnection = connections.find(({ propertyKind }) => propertyKind === 'ga4');
      const searchState = analyticsSourceState(
        searchConnection,
        hasAnalyticsRows(searchDaily, input.startDate, input.endDate),
        new Date(),
      );
      const gaState = analyticsSourceState(
        gaConnection,
        hasAnalyticsRows(gaDaily, input.startDate, input.endDate),
        new Date(),
      );
      const searchCurrent = analyticsPeriod(searchDaily, input.startDate, input.endDate);
      const searchPrevious = analyticsPeriod(
        searchDaily,
        input.previousStartDate,
        input.previousEndDate,
      );
      const gaCurrent = analyticsPeriod(gaDaily, input.startDate, input.endDate);
      const gaPrevious = analyticsPeriod(gaDaily, input.previousStartDate, input.previousEndDate);
      const technical = technicalResult.rows[0];
      const seriesByDate = new Map(
        analyticsDates(input.startDate, input.endDate).map((date) => [date, emptyDailyPoint(date)]),
      );
      for (const point of searchDaily.filter(({ date }) => date >= input.startDate)) {
        const existing = seriesByDate.get(point.date) ?? emptyDailyPoint(point.date);
        seriesByDate.set(point.date, {
          ...existing,
          clicks: point.clicks,
          ctr:
            point.clicks !== null && point.impressions !== null && point.impressions > 0
              ? point.clicks / point.impressions
              : null,
          impressions: point.impressions,
          position: point.position,
        });
      }
      for (const point of gaDaily.filter(({ date }) => date >= input.startDate)) {
        const existing = seriesByDate.get(point.date) ?? emptyDailyPoint(point.date);
        seriesByDate.set(point.date, {
          ...existing,
          activeUsers: point.activeUsers,
          pageViews: point.pageViews,
          sessions: point.sessions,
          totalSessions: point.totalSessions,
        });
      }
      const notes = analyticsQualityNotes(connections, searchState, gaState);
      return {
        dataQuality: {
          connections,
          generatedAt: new Date().toISOString(),
          notes,
          state: combinedAnalyticsState(searchState, gaState),
        },
        kpis: analyticsKpis(
          { current: searchCurrent, previous: searchPrevious, state: searchState },
          { current: gaCurrent, previous: gaPrevious, state: gaState },
        ),
        opportunities: deriveVisibilityOpportunities(topQueries),
        range: {
          days: inclusiveDays(input.startDate, input.endDate),
          endDate: input.endDate,
          label:
            input.preset === 'custom'
              ? `${input.startDate} to ${input.endDate}`
              : `Last ${inclusiveDays(input.startDate, input.endDate)} days`,
          previousEndDate: input.previousEndDate,
          previousStartDate: input.previousStartDate,
          preset: input.preset,
          startDate: input.startDate,
        },
        series: [...seriesByDate.values()].sort((left, right) =>
          left.date.localeCompare(right.date),
        ),
        site: {
          id: site.id,
          name: site.name,
          tenantId: site.tenant_id,
          tenantName: site.tenant_name,
        },
        technical: {
          crawlCompletedAt: technical ? dateTimeString(technical.crawl_completed_at) : null,
          crawlState: technical?.crawl_state ?? null,
          failingPages: technical ? nullableIntegerValue(technical.failing_pages) : null,
          findings: {
            critical: integerValue(technical?.critical),
            high: integerValue(technical?.high),
            info: integerValue(technical?.info),
            low: integerValue(technical?.low),
            medium: integerValue(technical?.medium),
          },
          openFindings: integerValue(technical?.open_findings),
          pagesCrawled: technical ? nullableIntegerValue(technical.pages_crawled) : null,
          resolvedFindings: integerValue(technical?.resolved_findings),
          topFindings: findingResult.rows.map((finding) => ({
            affectedPage: findingPage(finding.evidence),
            limitation: finding.limitation,
            remediation: finding.remediation,
            ruleId: finding.rule_id,
            severity: finding.severity,
            state: finding.state,
          })),
        },
        timeline: timelineResult.rows.flatMap((event) => {
          const occurredAt = dateTimeString(event.occurred_at);
          return occurredAt
            ? [
                {
                  category: event.category,
                  occurredAt,
                  state: event.state,
                  summary: analyticsEventSummary(event.category, event.state),
                },
              ]
            : [];
        }),
        topPages,
        topQueries,
      };
    });
  }

  siteManagement(actor: AdminActor, input: { siteId: string; tenantId: string }): Promise<unknown> {
    assertOrapCapability(actor, 'websites.view', input);
    return this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const [plans, subscription, features, controls, budget, integrations, availability] =
        await Promise.all([
          query<{
            code: string;
            commercial_status: string;
            id: string;
            monthly_price_cents: number;
            name: string;
            version: number;
          }>(
            client,
            `SELECT id, code, name, version, commercial_status, monthly_price_cents
               FROM plans WHERE active ORDER BY code, version DESC`,
            [],
          ),
          query<{
            ai_review_cycles_per_month: number;
            code: string;
            customer_seat_limit: number;
            grace_ends_at: Date | null;
            plan_id: string;
            seo_audit_interval_hours: number;
            standard_page_limit: number;
            status: string;
            version: number;
          }>(
            client,
            `SELECT subscription.plan_id, subscription.status, subscription.grace_ends_at,
                    plan.code, plan.version, plan.customer_seat_limit,
                    plan.standard_page_limit, plan.seo_audit_interval_hours,
                    COALESCE(quota.quota_limit, plan.ai_review_cycles_per_month)
                      AS ai_review_cycles_per_month
               FROM subscriptions subscription
               JOIN plans plan ON plan.id = subscription.plan_id
               LEFT JOIN site_plan_quota_overrides quota
                 ON quota.tenant_id = subscription.tenant_id
                AND quota.site_id = subscription.site_id
                AND quota.quota_key = 'ai_review_cycles_per_month'
              WHERE subscription.tenant_id = $1 AND subscription.site_id = $2`,
            [input.tenantId, input.siteId],
          ),
          query<{ enabled: boolean; key: string; readiness: string }>(
            client,
            `SELECT definition.key, definition.readiness,
                    COALESCE(override.enabled, plan_feature.enabled, definition.safe_default) AS enabled
               FROM feature_definitions definition
               LEFT JOIN subscriptions subscription
                 ON subscription.tenant_id = $1 AND subscription.site_id = $2
               LEFT JOIN plan_features plan_feature
                 ON plan_feature.plan_id = subscription.plan_id
                AND plan_feature.feature_key = definition.key
               LEFT JOIN site_feature_overrides override
                 ON override.tenant_id = $1 AND override.site_id = $2
                AND override.feature_key = definition.key
              ORDER BY definition.key`,
            [input.tenantId, input.siteId],
          ),
          query<{
            autonomous_changes_stopped: boolean;
            automation_stopped: boolean;
            editing_frozen: boolean;
            policy_version: number;
          }>(
            client,
            `SELECT autonomous_changes_stopped, automation_stopped, editing_frozen,
                    policy_version
               FROM site_emergency_controls WHERE tenant_id = $1 AND site_id = $2`,
            [input.tenantId, input.siteId],
          ),
          query<{ cap_usd_micros: string; policy_version: number }>(
            client,
            `SELECT cap_usd_micros::text, policy_version FROM site_ai_budgets
              WHERE tenant_id = $1 AND site_id = $2`,
            [input.tenantId, input.siteId],
          ),
          query<{ last_synced_at: Date | null; property_kind: string; status: string }>(
            client,
            `SELECT property_kind, status, last_synced_at FROM integration_connections
              WHERE tenant_id = $1 AND site_id = $2 ORDER BY property_kind`,
            [input.tenantId, input.siteId],
          ),
          query<{ active_artifact: boolean; public_domain: boolean }>(
            client,
            `SELECT
               EXISTS (SELECT 1 FROM domains WHERE tenant_id = $1 AND site_id = $2
                        AND kind = 'public' AND active AND verification_status = 'verified')
                 AS public_domain,
               EXISTS (SELECT 1 FROM active_artifacts WHERE tenant_id = $1 AND site_id = $2)
                 AS active_artifact`,
            [input.tenantId, input.siteId],
          ),
        ]);
      const current = subscription.rows[0];
      const emergency = controls.rows[0] ?? {
        autonomous_changes_stopped: false,
        automation_stopped: false,
        editing_frozen: false,
        policy_version: 0,
      };
      return {
        availability: {
          activeArtifact: availability.rows[0]?.active_artifact ?? false,
          publicDomain: availability.rows[0]?.public_domain ?? false,
          preservedDuringDelinquency: true,
        },
        budget: budget.rows[0]
          ? {
              capUsdMicros: Number(budget.rows[0].cap_usd_micros),
              policyVersion: budget.rows[0].policy_version,
            }
          : null,
        emergency: {
          autonomousChangesStopped: emergency.autonomous_changes_stopped,
          automationStopped: emergency.automation_stopped,
          editingFrozen: emergency.editing_frozen,
          policyVersion: emergency.policy_version,
        },
        features: features.rows,
        integrations: integrations.rows.map((row) => ({
          lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
          propertyKind: row.property_kind,
          status: row.status,
        })),
        plans: plans.rows.map((plan) => ({
          code: plan.code,
          commercialStatus: plan.commercial_status,
          id: plan.id,
          monthlyPriceCents: plan.monthly_price_cents,
          name: plan.name,
          version: plan.version,
        })),
        subscription: current
          ? {
              aiReviewCyclesPerMonth: current.ai_review_cycles_per_month,
              code: current.code,
              customerSeatLimit: current.customer_seat_limit,
              graceEndsAt: current.grace_ends_at?.toISOString() ?? null,
              planId: current.plan_id,
              seoAuditIntervalHours: current.seo_audit_interval_hours,
              standardPageLimit: current.standard_page_limit,
              status: current.status,
              version: current.version,
            }
          : null,
      };
    });
  }

  createTenantAndSite(
    actor: AdminActor,
    input: { reason: string; siteName: string; sourcePath: string; tenantName: string },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'customers.create');
    assertOrapCapability(actor, 'websites.create');
    const contract = this.siteContracts.get(input.sourcePath);
    if (!contract) throw new Error('Site source package is not registered');
    return this.transaction(actor, async (client) => {
      const tenant = required(
        (
          await query<{ id: string; name: string; status: string }>(
            client,
            `INSERT INTO tenants (name) VALUES ($1) RETURNING id, name, status`,
            [input.tenantName.trim()],
          )
        ).rows[0],
        'Tenant creation failed',
      );
      const site = required(
        (
          await query<{ id: string; name: string; status: string; tenant_id: string }>(
            client,
            `INSERT INTO sites
               (tenant_id, name, source_path, contract_version, contract_hash,
                standard_page_count, business_location_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, tenant_id, name, status`,
            [
              tenant.id,
              input.siteName.trim(),
              input.sourcePath,
              contract.contractVersion,
              contract.contractHash,
              contract.standardPageCount ?? 1,
              contract.businessLocationCount ?? 1,
            ],
          )
        ).rows[0],
        'Site creation failed',
      );
      await audit(client, actor, {
        action: 'site.created',
        after: { site, tenant },
        before: null,
        reason: input.reason,
        siteId: site.id,
        targetId: site.id,
        targetType: 'site',
        tenantId: tenant.id,
      });
      return { site, tenant };
    });
  }

  async inviteCustomer(
    actor: AdminActor,
    input: {
      email: string;
      reason: string;
      role: CustomerRole;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'customers.users.manage', input);
    const normalizedEmail = normalizeEmail(input.email);
    const token = createOneTimeToken();
    const invitation = await this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const adminDomains = await query<{ hostname: string }>(
        client,
        `SELECT hostname FROM domains
          WHERE tenant_id = $1 AND site_id = $2 AND kind = 'admin'
            AND active AND verification_status = 'verified'
          LIMIT 2`,
        [input.tenantId, input.siteId],
      );
      if (adminDomains.rows.length !== 1 || !adminDomains.rows[0]) {
        throw new Error('Exactly one verified customer admin domain is required');
      }
      await client.query(
        `UPDATE customer_invitations SET revoked_at = now()
          WHERE tenant_id = $1 AND site_id = $2 AND normalized_email = $3
            AND accepted_at IS NULL AND revoked_at IS NULL`,
        [input.tenantId, input.siteId, normalizedEmail],
      );
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.siteId]);
      const seats = required(
        (
          await query<{
            customer_seat_limit: number;
            occupied: number;
          }>(
            client,
            `SELECT p.customer_seat_limit,
                    ((SELECT count(*) FROM memberships m
                       WHERE m.tenant_id = $1 AND m.site_id = $2 AND m.active) +
                     CASE WHEN p.pending_invitations_count_as_seats THEN
                       (SELECT count(*) FROM customer_invitations i
                         WHERE i.tenant_id = $1 AND i.site_id = $2
                           AND i.accepted_at IS NULL AND i.revoked_at IS NULL
                           AND i.expires_at > now())
                     ELSE 0 END)::integer AS occupied
               FROM subscriptions s JOIN plans p ON p.id = s.plan_id
              WHERE s.tenant_id = $1 AND s.site_id = $2 AND s.status IN ('active','past_due')`,
            [input.tenantId, input.siteId],
          )
        ).rows[0],
        'An active site subscription is required before inviting customers',
      );
      if (seats.occupied >= seats.customer_seat_limit) {
        throw new Error('Customer seat entitlement is exhausted');
      }
      const created = required(
        (
          await query<{ id: string }>(
            client,
            `INSERT INTO customer_invitations
               (tenant_id, site_id, normalized_email, role, token_hash, invited_by, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days')
             RETURNING id`,
            [input.tenantId, input.siteId, normalizedEmail, input.role, token.digest, actor.id],
          )
        ).rows[0],
        'Invitation creation failed',
      );
      await audit(client, actor, {
        action: 'customer.invited',
        after: { normalizedEmail, role: input.role, status: 'pending' },
        before: null,
        reason: input.reason,
        siteId: input.siteId,
        targetId: created.id,
        targetType: 'customer_invitation',
        tenantId: input.tenantId,
      });
      return { ...created, host: adminDomains.rows[0].hostname };
    });
    await this.invitations.send({
      host: invitation.host,
      normalizedEmail,
      token: token.token,
    });
    return { invitationId: invitation.id, status: 'pending' };
  }

  changeCustomerRole(
    actor: AdminActor,
    input: { membershipId: string; reason: string; role: CustomerRole; siteId: string },
  ): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      const before = await membership(client, input.membershipId, input.siteId);
      assertOrapCapability(actor, 'customers.users.manage', resourceTarget(before));
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE memberships SET role = $1, updated_at = now()
              WHERE id = $2 AND site_id = $3
              RETURNING id, tenant_id, site_id, user_id, role, active`,
            [input.role, input.membershipId, input.siteId],
          )
        ).rows[0],
        'Membership was not found',
      );
      const revoked = await query<{ id: string }>(
        client,
        `UPDATE sessions SET revoked_at = now(), revoke_reason = 'membership-role-changed'
          WHERE site_id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
        [input.siteId, after.user_id],
      );
      await audit(client, actor, {
        action: 'membership.role_changed',
        after: { membership: after, revokedSessions: revoked.rows.length },
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.membershipId,
        targetType: 'membership',
        tenantId: String(after.tenant_id),
      });
      return { membership: after, revokedSessions: revoked.rows.length };
    });
  }

  disableCustomer(
    actor: AdminActor,
    input: { membershipId: string; reason: string; siteId: string },
  ): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      const before = await membership(client, input.membershipId, input.siteId);
      assertOrapCapability(actor, 'customers.users.manage', resourceTarget(before));
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE memberships SET active = false, updated_at = now()
              WHERE id = $1 AND site_id = $2
              RETURNING id, tenant_id, site_id, user_id, role, active`,
            [input.membershipId, input.siteId],
          )
        ).rows[0],
        'Membership was not found',
      );
      const revoked = await query<{ id: string }>(
        client,
        `UPDATE sessions SET revoked_at = now(), revoke_reason = 'membership-disabled'
          WHERE site_id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
        [input.siteId, after.user_id],
      );
      await audit(client, actor, {
        action: 'membership.disabled',
        after: { membership: after, revokedSessions: revoked.rows.length },
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.membershipId,
        targetType: 'membership',
        tenantId: String(after.tenant_id),
      });
      return { membership: after, revokedSessions: revoked.rows.length };
    });
  }

  async requestCustomerReset(
    actor: AdminActor,
    input: { networkIdentifier: string; reason: string; siteId: string; userId: string },
  ): Promise<unknown> {
    const customer = await this.transaction(actor, async (client) => {
      const result = await query<{
        hostname: string;
        normalized_email: string;
        tenant_id: string;
      }>(
        client,
        `SELECT u.normalized_email, m.tenant_id, d.hostname
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           JOIN domains d ON d.tenant_id = m.tenant_id AND d.site_id = m.site_id
            AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
          WHERE m.site_id = $1 AND m.user_id = $2 AND m.active AND u.status = 'active'
          LIMIT 2`,
        [input.siteId, input.userId],
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new Error('Customer or verified admin domain was not found');
      }
      const row = result.rows[0];
      assertOrapCapability(actor, 'security.customer_access.manage', {
        siteId: input.siteId,
        tenantId: row.tenant_id,
      });
      await audit(client, actor, {
        action: 'customer.password_reset_requested',
        after: { status: 'requested' },
        before: null,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.userId,
        targetType: 'user',
        tenantId: row.tenant_id,
      });
      return row;
    });
    await this.requestRecovery({
      host: customer.hostname,
      networkIdentifier: input.networkIdentifier,
      normalizedEmail: customer.normalized_email,
      traceId: actor.traceId,
    });
    return { status: 'accepted' };
  }

  listCustomerSessions(
    actor: AdminActor,
    input: { siteId: string; tenantId: string; userId: string },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'security.sessions.view', input);
    return this.transaction(actor, async (client) => {
      await lockCustomerSessionScope(client, input);
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
          WHERE tenant_id = $1 AND site_id = $2 AND user_id = $3
            AND revoked_at IS NULL AND expires_at > now()
            AND last_seen_at > now() - interval '30 minutes'
          ORDER BY last_seen_at DESC, id`,
        [input.tenantId, input.siteId, input.userId],
      );
      return {
        sessions: result.rows.map((row) => ({
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          host: row.host,
          id: row.id,
          lastSeenAt: row.last_seen_at,
        })),
      };
    });
  }

  revokeCustomerSession(
    actor: AdminActor,
    input: {
      reason: string;
      sessionId: string;
      siteId: string;
      tenantId: string;
      userId: string;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'security.sessions.revoke', input);
    assertBoundedAdministrativeReason(input.reason);
    return this.transaction(actor, async (client) => {
      await lockCustomerSessionScope(client, input);
      const revoked = await query<{ id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = now(), revoke_reason = 'orap-exact-site-revocation'
          WHERE id = $1 AND tenant_id = $2 AND site_id = $3 AND user_id = $4
            AND revoked_at IS NULL
          RETURNING id`,
        [input.sessionId, input.tenantId, input.siteId, input.userId],
      );
      if (revoked.rows.length !== 1) {
        throw new OrapResourceNotFoundError('Customer session was not found');
      }
      await audit(client, actor, {
        action: 'customer.session.revoked',
        after: { revokedSessions: revoked.rows.length },
        before: null,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.sessionId,
        targetType: 'session',
        tenantId: input.tenantId,
      });
      return { revokedSessions: revoked.rows.length };
    });
  }

  revokeAllCustomerSessions(
    actor: AdminActor,
    input: { reason: string; siteId: string; tenantId: string; userId: string },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'security.sessions.revoke', input);
    assertBoundedAdministrativeReason(input.reason);
    return this.transaction(actor, async (client) => {
      await lockCustomerSessionScope(client, input);
      const revoked = await query<{ id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = now(), revoke_reason = 'orap-exact-site-revoke-all'
          WHERE tenant_id = $1 AND site_id = $2 AND user_id = $3
            AND revoked_at IS NULL
          RETURNING id`,
        [input.tenantId, input.siteId, input.userId],
      );
      await audit(client, actor, {
        action: 'customer.sessions.revoked',
        after: { revokedSessions: revoked.rows.length },
        before: null,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.userId,
        targetType: 'user',
        tenantId: input.tenantId,
      });
      return { revokedSessions: revoked.rows.length };
    });
  }

  setFeatureOverride(
    actor: AdminActor,
    input: {
      cancelQueuedWork: boolean;
      enabled: boolean;
      featureKey: string;
      policyVersion: number;
      reason: string;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'entitlements.override', input);
    assertPlanFeatureAllowed(input.featureKey);
    return this.transaction(actor, async (client) => {
      const feature = required(
        (
          await query<{
            key: string;
            overrideable: boolean;
            readiness: 'deployable' | 'planned' | 'tested';
            version: number;
          }>(
            client,
            `SELECT key, version, overrideable, readiness FROM feature_definitions
              WHERE key = $1 ORDER BY version DESC LIMIT 1`,
            [input.featureKey],
          )
        ).rows[0],
        'Feature definition was not found',
      );
      if (!feature.overrideable || feature.key === 'content.ai.protected-facts') {
        throw new Error('Feature is protected by a nonoverrideable system rule');
      }
      if (input.enabled && feature.readiness !== 'deployable') {
        throw new Error('Feature is not deployable and cannot be enabled');
      }
      await assertSite(client, input.tenantId, input.siteId);
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM site_feature_overrides
            WHERE tenant_id = $1 AND site_id = $2 AND feature_key = $3`,
            [input.tenantId, input.siteId, input.featureKey],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO site_feature_overrides
               (tenant_id, site_id, feature_key, feature_version, enabled, reason, actor_id, policy_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (site_id, feature_key) DO UPDATE
               SET feature_version = EXCLUDED.feature_version, enabled = EXCLUDED.enabled,
                   reason = EXCLUDED.reason, actor_id = EXCLUDED.actor_id,
                   effective_at = now(), policy_version = EXCLUDED.policy_version
             RETURNING *`,
            [
              input.tenantId,
              input.siteId,
              feature.key,
              feature.version,
              input.enabled,
              input.reason,
              actor.id,
              input.policyVersion,
            ],
          )
        ).rows[0],
        'Feature override failed',
      );
      await audit(client, actor, {
        action: 'site.feature_override_changed',
        after: { ...after, cancelQueuedWork: input.cancelQueuedWork },
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: String(after.id),
        targetType: 'site_feature_override',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setContactForm(
    actor: AdminActor,
    input: {
      confirmationEnabled: boolean;
      enabled: boolean;
      fieldIds: string[];
      formId: string;
      policyVersion: number;
      reason: string;
      recipientEmail: string;
      recipientVerified: boolean;
      retentionDays: number;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'contact_forms.manage', input);
    if (input.enabled && !input.recipientVerified) {
      throw new Error('An enabled contact form requires a verified recipient');
    }
    return this.transaction(actor, async (client) => {
      const site = required(
        (
          await query<{ source_path: string }>(
            client,
            `SELECT source_path FROM sites
              WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
            [input.tenantId, input.siteId],
          )
        ).rows[0],
        'Site was not found',
      );
      const form = this.siteContracts
        .get(site.source_path)
        ?.contactForms?.find(({ id }) => id === input.formId);
      if (!form) throw new Error('Contact form is not declared by the site contract');
      const fieldIds = [...new Set(input.fieldIds)];
      if (
        fieldIds.some((id) => !form.fieldIds.includes(id)) ||
        form.requiredFieldIds.some((id) => !fieldIds.includes(id))
      ) {
        throw new Error('Contact form fields must be declared and include required fields');
      }
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM site_contact_forms
              WHERE tenant_id = $1 AND site_id = $2 AND form_id = $3 FOR UPDATE`,
            [input.tenantId, input.siteId, input.formId],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO site_contact_forms
               (tenant_id, site_id, form_id, enabled, declared_field_ids,
                enabled_field_ids, required_field_ids, confirmation_enabled,
                recipient_email, recipient_verified_at, retention_days, reason,
                actor_id, policy_version)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, lower($9),
                     CASE WHEN $10 THEN now() ELSE NULL END, $11, $12, $13, $14)
             ON CONFLICT (tenant_id, site_id, form_id) DO UPDATE
               SET enabled = EXCLUDED.enabled,
                   declared_field_ids = EXCLUDED.declared_field_ids,
                   enabled_field_ids = EXCLUDED.enabled_field_ids,
                   required_field_ids = EXCLUDED.required_field_ids,
                   confirmation_enabled = EXCLUDED.confirmation_enabled,
                   recipient_email = EXCLUDED.recipient_email,
                   recipient_verified_at = EXCLUDED.recipient_verified_at,
                   retention_days = EXCLUDED.retention_days, reason = EXCLUDED.reason,
                   actor_id = EXCLUDED.actor_id, policy_version = EXCLUDED.policy_version,
                   updated_at = now()
             RETURNING *`,
            [
              input.tenantId,
              input.siteId,
              input.formId,
              input.enabled,
              JSON.stringify(form.fieldIds),
              JSON.stringify(fieldIds),
              JSON.stringify(form.requiredFieldIds),
              input.confirmationEnabled,
              input.recipientEmail,
              input.recipientVerified,
              input.retentionDays,
              input.reason,
              actor.id,
              input.policyVersion,
            ],
          )
        ).rows[0],
        'Contact form configuration failed',
      );
      await audit(client, actor, {
        action: 'site.contact_form_changed',
        after: redactContactRecipient(after),
        before: redactContactRecipient(before),
        reason: input.reason,
        siteId: input.siteId,
        targetId: `${input.siteId}:${input.formId}`,
        targetType: 'site_contact_form',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setContactSubmissionHold(
    actor: AdminActor,
    input: {
      hold: boolean;
      reason: string;
      siteId: string;
      submissionId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'contact_forms.submissions.hold', input);
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT id, tenant_id, site_id, form_id, delivery_state, expires_at,
                    legal_hold, hold_reason, held_at, held_by
               FROM contact_submissions
              WHERE tenant_id = $1 AND site_id = $2 AND id = $3
              FOR UPDATE`,
            [input.tenantId, input.siteId, input.submissionId],
          )
        ).rows[0],
        'Contact submission was not found',
      );
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE contact_submissions
                SET legal_hold = $4,
                    hold_reason = CASE WHEN $4 THEN $5 ELSE NULL END,
                    held_at = CASE WHEN $4 THEN now() ELSE NULL END,
                    held_by = CASE WHEN $4 THEN $6 ELSE NULL END
              WHERE tenant_id = $1 AND site_id = $2 AND id = $3
              RETURNING id, tenant_id, site_id, form_id, delivery_state, expires_at,
                        legal_hold, hold_reason, held_at, held_by`,
            [input.tenantId, input.siteId, input.submissionId, input.hold, input.reason, actor.id],
          )
        ).rows[0],
        'Contact submission hold update failed',
      );
      await audit(client, actor, {
        action: input.hold ? 'contact.legal_hold_applied' : 'contact.legal_hold_released',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.submissionId,
        targetType: 'contact_submission',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setQuotaOverride(
    actor: AdminActor,
    input: {
      policyVersion: number;
      quotaKey: 'ai_review_cycles_per_month';
      quotaLimit: number;
      reason: string;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'entitlements.override', input);
    return this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM site_plan_quota_overrides
              WHERE tenant_id = $1 AND site_id = $2 AND quota_key = $3 FOR UPDATE`,
            [input.tenantId, input.siteId, input.quotaKey],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO site_plan_quota_overrides
               (tenant_id, site_id, quota_key, quota_limit, reason, actor_id, policy_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (tenant_id, site_id, quota_key) DO UPDATE
               SET quota_limit = EXCLUDED.quota_limit, reason = EXCLUDED.reason,
                   actor_id = EXCLUDED.actor_id, policy_version = EXCLUDED.policy_version,
                   updated_at = now()
             RETURNING *`,
            [
              input.tenantId,
              input.siteId,
              input.quotaKey,
              input.quotaLimit,
              input.reason,
              actor.id,
              input.policyVersion,
            ],
          )
        ).rows[0],
        'Quota override failed',
      );
      await audit(client, actor, {
        action: 'site.quota_override_changed',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: `${input.siteId}:${input.quotaKey}`,
        targetType: 'site_plan_quota_override',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setSiteAiBudget(
    actor: AdminActor,
    input: {
      capUsdMicros: number;
      policyVersion: number;
      reason: string;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'ai_budget.site.edit', input);
    return this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM site_ai_budgets
              WHERE tenant_id = $1 AND site_id = $2 FOR UPDATE`,
            [input.tenantId, input.siteId],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO site_ai_budgets
               (tenant_id, site_id, cap_usd_micros, policy_version, override_reason, override_actor_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, site_id) DO UPDATE
               SET cap_usd_micros = EXCLUDED.cap_usd_micros,
                   policy_version = EXCLUDED.policy_version,
                   override_reason = EXCLUDED.override_reason,
                   override_actor_id = EXCLUDED.override_actor_id,
                   updated_at = now()
             RETURNING *`,
            [
              input.tenantId,
              input.siteId,
              input.capUsdMicros,
              input.policyVersion,
              input.reason,
              actor.id,
            ],
          )
        ).rows[0],
        'Site AI budget update failed',
      );
      await client.query(
        `UPDATE ai_budget_periods SET cap_usd_micros = $3
          WHERE tenant_id = $1 AND site_id = $2
            AND period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        [input.tenantId, input.siteId, input.capUsdMicros],
      );
      await audit(client, actor, {
        action: 'site.ai_budget_changed',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.siteId,
        targetType: 'site_ai_budget',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setPlatformAiBudget(
    actor: AdminActor,
    input: { capUsdMicros: number; policyVersion: number; reason: string },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'ai_budget.platform.edit');
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            'SELECT * FROM platform_ai_budget WHERE singleton = true FOR UPDATE',
            [],
          )
        ).rows[0],
        'Platform AI budget was not found',
      );
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE platform_ai_budget
                SET cap_usd_micros = $1, policy_version = $2, override_reason = $3,
                    override_actor_id = $4, updated_at = now()
              WHERE singleton = true
              RETURNING *`,
            [input.capUsdMicros, input.policyVersion, input.reason, actor.id],
          )
        ).rows[0],
        'Platform AI budget update failed',
      );
      await client.query(
        `UPDATE platform_ai_budget_periods SET cap_usd_micros = $1, updated_at = now()
          WHERE period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        [input.capUsdMicros],
      );
      await audit(client, actor, {
        action: 'platform.ai_budget_changed',
        after,
        before,
        reason: input.reason,
        targetId: 'platform',
        targetType: 'platform_ai_budget',
      });
      return after;
    });
  }

  setEmergencyControls(
    actor: AdminActor,
    input: {
      autonomousChangesStopped: boolean;
      automationStopped: boolean;
      editingFrozen: boolean;
      policyVersion: number;
      reason: string;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'automation.emergency_controls.manage', input);
    return this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM site_emergency_controls WHERE tenant_id = $1 AND site_id = $2`,
            [input.tenantId, input.siteId],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO site_emergency_controls
               (tenant_id, site_id, editing_frozen, autonomous_changes_stopped,
                automation_stopped, reason, actor_id, policy_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (tenant_id, site_id) DO UPDATE
               SET editing_frozen = EXCLUDED.editing_frozen,
                   autonomous_changes_stopped = EXCLUDED.autonomous_changes_stopped,
                   automation_stopped = EXCLUDED.automation_stopped,
                   reason = EXCLUDED.reason, actor_id = EXCLUDED.actor_id,
                   policy_version = EXCLUDED.policy_version, updated_at = now()
             RETURNING *`,
            [
              input.tenantId,
              input.siteId,
              input.editingFrozen,
              input.autonomousChangesStopped,
              input.automationStopped,
              input.reason,
              actor.id,
              input.policyVersion,
            ],
          )
        ).rows[0],
        'Emergency control update failed',
      );
      await audit(client, actor, {
        action: 'site.emergency_controls_changed',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.siteId,
        targetType: 'site',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setSubscriptionState(
    actor: AdminActor,
    input: {
      graceEndsAt?: Date;
      reason: string;
      siteId: string;
      status: 'active' | 'cancelled' | 'past_due';
      tenantId: string;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'subscriptions.edit', input);
    const graceEndsAt =
      input.status === 'past_due'
        ? (input.graceEndsAt ?? defaultGraceEndsAt(new Date()))
        : input.graceEndsAt;
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM subscriptions WHERE tenant_id = $1 AND site_id = $2 FOR UPDATE`,
            [input.tenantId, input.siteId],
          )
        ).rows[0],
        'Subscription is not configured for this site',
      );
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE subscriptions
                SET status = $3, grace_ends_at = $4, updated_at = now()
              WHERE tenant_id = $1 AND site_id = $2 RETURNING *`,
            [input.tenantId, input.siteId, input.status, graceEndsAt ?? null],
          )
        ).rows[0],
        'Subscription update failed',
      );
      await audit(client, actor, {
        action: 'site.subscription_state_changed',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: String(after.id),
        targetType: 'subscription',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  listOperations(actor: AdminActor): Promise<unknown> {
    assertOrapCapability(actor, 'dashboard.view');
    const alertAllowed = canOrap(actor, 'alerts.view');
    const alertScope = orapVisibleScope(actor, 'alerts.view');
    const jobAllowed = canOrap(actor, 'automation.jobs.view');
    const jobScope = orapVisibleScope(actor, 'automation.jobs.view');
    const budgetAllowed = canOrap(actor, 'ai_budget.platform.view');
    return this.transaction(actor, async (client) => {
      const alerts = alertAllowed
        ? await query<{
            fingerprint: string;
            id: string;
            message: string;
            occurrences: number;
            severity: string;
            state: string;
          }>(
            client,
            `SELECT id, fingerprint, severity, state, safe_message AS message, occurrences
               FROM alerts
              WHERE $1::boolean
                 OR tenant_id = ANY($2::uuid[])
                 OR site_id = ANY($3::uuid[])
              ORDER BY CASE state WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
                       last_seen_at DESC
              LIMIT 100`,
            [alertScope.portfolio, [...alertScope.tenantIds], [...alertScope.siteIds]],
          )
        : { rows: [] };
      const jobs = jobAllowed
        ? await query<{
            category: string;
            id: string;
            state: string;
            trace_id: string;
            updated_at: Date;
          }>(
            client,
            `SELECT id, category, state, trace_id, updated_at
               FROM jobs
              WHERE $1::boolean
                 OR tenant_id = ANY($2::uuid[])
                 OR site_id = ANY($3::uuid[])
              ORDER BY updated_at DESC LIMIT 100`,
            [jobScope.portfolio, [...jobScope.tenantIds], [...jobScope.siteIds]],
          )
        : { rows: [] };
      const budget = budgetAllowed
        ? required(
            (
              await query<{
                cap_usd_micros: string;
                period_start: Date;
                reserved_usd_micros: string;
                used_usd_micros: string;
              }>(
                client,
                `SELECT COALESCE(p.cap_usd_micros, b.cap_usd_micros)::text AS cap_usd_micros,
                     date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS period_start,
                     COALESCE(p.reserved_usd_micros, 0)::text AS reserved_usd_micros,
                     COALESCE(p.used_usd_micros, 0)::text AS used_usd_micros
               FROM platform_ai_budget b
               LEFT JOIN platform_ai_budget_periods p
                 ON p.period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
              WHERE b.singleton = true`,
                [],
              )
            ).rows[0],
            'Platform AI budget is not configured',
          )
        : null;
      return {
        alerts: alerts.rows,
        budget: budget
          ? {
              capUsdMicros: Number(budget.cap_usd_micros),
              periodStart: budget.period_start.toISOString(),
              reservedUsdMicros: Number(budget.reserved_usd_micros),
              usedUsdMicros: Number(budget.used_usd_micros),
            }
          : null,
        jobs: jobs.rows.map((job) => ({
          category: job.category,
          id: job.id,
          state: job.state,
          traceId: job.trace_id,
          updatedAt: job.updated_at.toISOString(),
        })),
      };
    });
  }

  cancelJob(actor: AdminActor, input: { jobId: string; reason: string }): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT id, tenant_id, site_id, category, state, trace_id
               FROM jobs WHERE id = $1 FOR UPDATE`,
            [input.jobId],
          )
        ).rows[0],
        'Job was not found',
      );
      assertOrapCapability(actor, 'automation.jobs.cancel', resourceTarget(before));
      if (before.state !== 'queued') throw new Error('Only queued jobs can be cancelled');
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE jobs
                SET state = 'cancelled', completed_at = now(), updated_at = now(),
                    queue_claim_owner = NULL, queue_claimed_until = NULL
              WHERE id = $1 AND state = 'queued'
              RETURNING id, tenant_id, site_id, category, state, trace_id`,
            [input.jobId],
          )
        ).rows[0],
        'Queued job cancellation failed',
      );
      await audit(client, actor, {
        action: 'job.cancelled',
        after,
        before,
        reason: input.reason,
        ...(typeof after.site_id === 'string' ? { siteId: after.site_id } : {}),
        targetId: input.jobId,
        targetType: 'job',
        ...(typeof after.tenant_id === 'string' ? { tenantId: after.tenant_id } : {}),
      });
      return after;
    });
  }

  replayJob(actor: AdminActor, input: { jobId: string; reason: string }): Promise<unknown> {
    const replayTraceId = /^[A-Za-z0-9_-]{16,128}$/u.test(actor.traceId)
      ? actor.traceId
      : randomUUID();
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM jobs WHERE id = $1 FOR UPDATE`,
            [input.jobId],
          )
        ).rows[0],
        'Job was not found',
      );
      assertOrapCapability(actor, 'automation.jobs.replay', resourceTarget(before));
      if (!['cancelled', 'failed', 'skipped'].includes(String(before.state))) {
        throw new Error('Only cancelled, failed, or skipped jobs can be replayed');
      }
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO jobs
               (tenant_id, site_id, category, schema_version, record_id, dedupe_key,
                trace_id, state, policy_version, attempt_limit, expires_at)
             SELECT tenant_id, site_id, category, schema_version, record_id,
                    left('replay:' || id::text || ':' || gen_random_uuid()::text, 160),
                    $2, 'queued', policy_version, attempt_limit, now() + interval '24 hours'
               FROM jobs WHERE id = $1
             RETURNING id, tenant_id, site_id, category, state, trace_id, dedupe_key`,
            [input.jobId, replayTraceId],
          )
        ).rows[0],
        'Job replay admission failed',
      );
      await audit(client, actor, {
        action: 'job.replayed',
        after: { ...after, replayOf: input.jobId },
        before,
        reason: input.reason,
        ...(typeof after.site_id === 'string' ? { siteId: after.site_id } : {}),
        targetId: String(after.id),
        targetType: 'job',
        ...(typeof after.tenant_id === 'string' ? { tenantId: after.tenant_id } : {}),
      });
      return after;
    });
  }

  acknowledgeAlert(
    actor: AdminActor,
    input: { alertId: string; reason: string },
  ): Promise<unknown> {
    return this.transitionAlert(actor, input, 'acknowledged');
  }

  resolveAlert(actor: AdminActor, input: { alertId: string; reason: string }): Promise<unknown> {
    return this.transitionAlert(actor, input, 'resolved');
  }

  private transitionAlert(
    actor: AdminActor,
    input: { alertId: string; reason: string },
    state: 'acknowledged' | 'resolved',
  ): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT id, tenant_id, site_id, fingerprint, severity, state, occurrences
               FROM alerts WHERE id = $1 FOR UPDATE`,
            [input.alertId],
          )
        ).rows[0],
        'Alert was not found',
      );
      assertOrapCapability(
        actor,
        state === 'acknowledged' ? 'alerts.acknowledge' : 'alerts.resolve',
        resourceTarget(before),
      );
      if (before.state === 'resolved') throw new Error('Resolved alert cannot be transitioned');
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE alerts
                SET state = $2,
                    owner_id = $3,
                    acknowledged_at = CASE WHEN $2 IN ('acknowledged','resolved')
                                           THEN COALESCE(acknowledged_at, now()) ELSE acknowledged_at END,
                    resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE NULL END
              WHERE id = $1
              RETURNING id, tenant_id, site_id, fingerprint, severity, state, occurrences`,
            [input.alertId, state, actor.id],
          )
        ).rows[0],
        'Alert transition failed',
      );
      await audit(client, actor, {
        action: `alert.${state}`,
        after,
        before,
        reason: input.reason,
        ...(typeof after.site_id === 'string' ? { siteId: after.site_id } : {}),
        targetId: input.alertId,
        targetType: 'alert',
        ...(typeof after.tenant_id === 'string' ? { tenantId: after.tenant_id } : {}),
      });
      return after;
    });
  }

  private transaction<T>(
    actor: AdminActor,
    operation: (client: TenantTransactionClient) => Promise<T>,
  ): Promise<T> {
    return withPlatformTransaction(this.pool, { actorId: actor.id }, async (client) => {
      await assertCurrentOrapAuthorization(client, actor);
      return operation(client);
    });
  }
}

interface AnalyticsDailyRow extends Record<string, unknown> {
  active_users?: number | string | null;
  clicks?: number | string | null;
  day: Date | string;
  impressions?: number | string | null;
  page_views?: number | string | null;
  position?: number | string | null;
  sessions?: number | string | null;
  total_sessions?: number | string | null;
}

interface AnalyticsSearchResultRow extends Record<string, unknown> {
  clicks: number | string;
  ctr: number | string | null;
  impressions: number | string;
  label: string;
  position: number | string | null;
  previous_clicks: number | string | null;
  previous_impressions: number | string | null;
}

interface AnalyticsTechnicalRow extends Record<string, unknown> {
  crawl_completed_at: Date | string | null;
  crawl_state: string | null;
  critical: number | string | null;
  failing_pages: number | string | null;
  high: number | string | null;
  info: number | string | null;
  low: number | string | null;
  medium: number | string | null;
  open_findings: number | string | null;
  pages_crawled: number | string | null;
  resolved_findings: number | string | null;
}

interface AnalyticsFindingRow extends Record<string, unknown> {
  evidence: unknown;
  limitation: string;
  remediation: string;
  rule_id: string;
  severity: string;
  state: string;
}

interface AnalyticsTimelineRow extends Record<string, unknown> {
  category: string;
  occurred_at: Date | string;
  state: string;
}

interface AnalyticsPeriodValues {
  activeUsers: number | null;
  clicks: number | null;
  ctr: number | null;
  impressions: number | null;
  pageViews: number | null;
  position: number | null;
  sessions: number | null;
  totalSessions: number | null;
}

const searchDailySql = `WITH observation AS (
  SELECT window_start::date AS day, dimensions,
         max(value) FILTER (WHERE metric = 'clicks') AS clicks,
         max(value) FILTER (WHERE metric = 'impressions') AS impressions,
         max(value) FILTER (WHERE metric = 'position') AS position
    FROM metric_snapshots
   WHERE tenant_id = $1 AND site_id = $2 AND source = 'search_console'
     AND window_start >= $3::date
     AND window_start < ($4::date + interval '1 day')
   GROUP BY window_start::date, dimensions
)
SELECT day::text,
       COALESCE(sum(clicks), 0)::text AS clicks,
       COALESCE(sum(impressions), 0)::text AS impressions,
       CASE WHEN sum(impressions) > 0
            THEN (sum(position * impressions) / sum(impressions))::text END AS position
  FROM observation
 GROUP BY day
 ORDER BY day`;

const gaDailySql = `WITH observation AS (
  SELECT window_start::date AS day, dimensions,
         max(value) FILTER (WHERE metric = 'sessions') AS sessions,
         max(value) FILTER (WHERE metric = 'activeUsers') AS active_users,
         max(value) FILTER (WHERE metric = 'screenPageViews') AS page_views
    FROM metric_snapshots
   WHERE tenant_id = $1 AND site_id = $2 AND source = 'ga4'
     AND window_start >= $3::date
     AND window_start < ($4::date + interval '1 day')
   GROUP BY window_start::date, dimensions
)
SELECT day::text,
       COALESCE(sum(sessions), 0)::text AS total_sessions,
       COALESCE(sum(sessions) FILTER (WHERE lower(COALESCE(dimensions->>'sessionMedium', ''))
           IN ('organic', 'organic search', 'organic_search')), 0)::text AS sessions,
       COALESCE(sum(active_users) FILTER (WHERE lower(COALESCE(dimensions->>'sessionMedium', ''))
           IN ('organic', 'organic search', 'organic_search')), 0)::text AS active_users,
       COALESCE(sum(page_views) FILTER (WHERE lower(COALESCE(dimensions->>'sessionMedium', ''))
           IN ('organic', 'organic search', 'organic_search')), 0)::text AS page_views
  FROM observation
 GROUP BY day
 ORDER BY day`;

function searchDimensionSql(
  dimension: 'page' | 'query',
  orderBy: 'clicks' | 'ctr' | 'impressions' | 'position',
): string {
  const direction = orderBy === 'position' ? 'ASC' : 'DESC';
  return `WITH observation AS (
    SELECT COALESCE(NULLIF(dimensions->>'${dimension}', ''), 'Unknown ${dimension}') AS label,
           window_start::date AS day,
           dimensions,
           max(value) FILTER (WHERE metric = 'clicks') AS clicks,
           max(value) FILTER (WHERE metric = 'impressions') AS impressions,
           max(value) FILTER (WHERE metric = 'position') AS position
      FROM metric_snapshots
     WHERE tenant_id = $1 AND site_id = $2 AND source = 'search_console'
       AND window_start >= $3::date
       AND window_start < ($6::date + interval '1 day')
     GROUP BY COALESCE(NULLIF(dimensions->>'${dimension}', ''), 'Unknown ${dimension}'),
              window_start::date, dimensions
  ), aggregate AS (
    SELECT label,
           COALESCE(sum(clicks) FILTER (WHERE day >= $5::date AND day <= $6::date), 0)
             AS clicks,
           COALESCE(sum(impressions) FILTER (WHERE day >= $5::date AND day <= $6::date), 0)
             AS impressions,
           sum(clicks) FILTER (WHERE day >= $3::date AND day <= $4::date)
             AS previous_clicks,
           sum(impressions) FILTER (WHERE day >= $3::date AND day <= $4::date)
             AS previous_impressions,
           CASE WHEN sum(impressions) FILTER (WHERE day >= $5::date AND day <= $6::date) > 0
                THEN sum(clicks) FILTER (WHERE day >= $5::date AND day <= $6::date)
                   / sum(impressions) FILTER (WHERE day >= $5::date AND day <= $6::date)
           END AS ctr,
           CASE WHEN sum(impressions) FILTER (WHERE day >= $5::date AND day <= $6::date) > 0
                THEN sum(position * impressions)
                       FILTER (WHERE day >= $5::date AND day <= $6::date)
                   / sum(impressions) FILTER (WHERE day >= $5::date AND day <= $6::date)
           END AS position
      FROM observation
     GROUP BY label
  )
  SELECT label, clicks::text, impressions::text, ctr::text, position::text,
         previous_clicks::text, previous_impressions::text
    FROM aggregate
   WHERE clicks > 0 OR impressions > 0
   ORDER BY ${orderBy} ${direction} NULLS LAST, impressions DESC, label
   LIMIT $7`;
}

function analyticsOrderBy(
  value: OrapAnalyticsInput['querySort'] | OrapAnalyticsInput['pageSort'],
): 'clicks' | 'ctr' | 'impressions' | 'position' {
  switch (value) {
    case 'clicks':
    case 'ctr':
    case 'impressions':
    case 'position':
      return value;
  }
}

function toDailyPoint(row: AnalyticsDailyRow): {
  activeUsers: number | null;
  clicks: number | null;
  ctr: number | null;
  date: string;
  impressions: number | null;
  pageViews: number | null;
  position: number | null;
  sessions: number | null;
  totalSessions: number | null;
} {
  const clicks = decimalValue(row.clicks);
  const impressions = decimalValue(row.impressions);
  return {
    activeUsers: decimalValue(row.active_users),
    clicks,
    ctr: clicks !== null && impressions !== null && impressions > 0 ? clicks / impressions : null,
    date: dateOnlyString(row.day),
    impressions,
    pageViews: decimalValue(row.page_views),
    position: decimalValue(row.position),
    sessions: decimalValue(row.sessions),
    totalSessions: decimalValue(row.total_sessions),
  };
}

function emptyDailyPoint(date: string): ReturnType<typeof toDailyPoint> {
  return {
    activeUsers: null,
    clicks: null,
    ctr: null,
    date,
    impressions: null,
    pageViews: null,
    position: null,
    sessions: null,
    totalSessions: null,
  };
}

function toSearchRow(row: AnalyticsSearchResultRow): AnalyticsSearchRow {
  const clicks = decimalValue(row.clicks) ?? 0;
  const previousClicks = decimalValue(row.previous_clicks);
  return {
    clicks,
    ctr: decimalValue(row.ctr),
    impressions: decimalValue(row.impressions) ?? 0,
    label: row.label,
    position: decimalValue(row.position),
    previousClicks,
    previousImpressions: decimalValue(row.previous_impressions),
    trafficDeltaPercent: analyticsDelta(clicks, previousClicks),
  };
}

function analyticsPeriod(
  rows: readonly ReturnType<typeof toDailyPoint>[],
  startDate: string,
  endDate: string,
): AnalyticsPeriodValues {
  const selected = rows.filter(({ date }) => date >= startDate && date <= endDate);
  const clicks = sumPresent(selected.map(({ clicks: value }) => value));
  const impressions = sumPresent(selected.map(({ impressions: value }) => value));
  const weightedPosition = selected.reduce(
    (total, row) =>
      total +
      (row.position !== null && row.impressions !== null ? row.position * row.impressions : 0),
    0,
  );
  return {
    activeUsers: sumPresent(selected.map(({ activeUsers: value }) => value)),
    clicks,
    ctr: clicks !== null && impressions !== null && impressions > 0 ? clicks / impressions : null,
    impressions,
    pageViews: sumPresent(selected.map(({ pageViews: value }) => value)),
    position:
      impressions !== null && impressions > 0 && weightedPosition > 0
        ? weightedPosition / impressions
        : null,
    sessions: sumPresent(selected.map(({ sessions: value }) => value)),
    totalSessions: sumPresent(selected.map(({ totalSessions: value }) => value)),
  };
}

function analyticsKpis(
  search: {
    current: AnalyticsPeriodValues;
    previous: AnalyticsPeriodValues;
    state: AnalyticsAvailability;
  },
  ga: {
    current: AnalyticsPeriodValues;
    previous: AnalyticsPeriodValues;
    state: AnalyticsAvailability;
  },
): AnalyticsKpi[] {
  return [
    kpi(
      'clicks',
      'Search clicks',
      search.current.clicks,
      search.previous.clicks,
      'count',
      search.state,
      'Total clicks reported by Search Console for the selected property and period.',
      'search_console',
    ),
    kpi(
      'impressions',
      'Search impressions',
      search.current.impressions,
      search.previous.impressions,
      'count',
      search.state,
      'Total Search Console result impressions for the selected property and period.',
      'search_console',
    ),
    kpi(
      'ctr',
      'Search CTR',
      search.current.ctr,
      search.previous.ctr,
      'percent',
      search.state,
      'Total clicks divided by total impressions. Row-level CTR values are not summed or averaged.',
      'search_console',
    ),
    kpi(
      'position',
      'Average position',
      search.current.position,
      search.previous.position,
      'position',
      search.state,
      'Search Console position weighted by impressions across stored observations.',
      'search_console',
      'Average position is aggregate evidence and does not describe every location, device, or individual result.',
    ),
    kpi(
      'organic_sessions',
      'Organic sessions',
      ga.current.sessions,
      ga.previous.sessions,
      'count',
      ga.state,
      'GA4 sessions where sessionMedium is organic, organic search, or organic_search.',
      'ga4',
    ),
    kpi(
      'organic_page_views',
      'Organic page views',
      ga.current.pageViews,
      ga.previous.pageViews,
      'count',
      ga.state,
      'GA4 screenPageViews summed for the documented organic session-medium allowlist.',
      'ga4',
    ),
    kpi(
      'active_user_observations',
      'Active-user observations',
      ga.current.activeUsers,
      ga.previous.activeUsers,
      'count',
      ga.state,
      'Daily GA4 activeUsers values summed across stored organic source/medium rows.',
      'ga4',
      'A person may appear in more than one day or source row; this is not a deduplicated period user count.',
    ),
    kpi(
      'total_sessions',
      'All-channel sessions',
      ga.current.totalSessions,
      ga.previous.totalSessions,
      'count',
      ga.state,
      'GA4 sessions across all stored source and medium rows, shown as context beside organic traffic.',
      'ga4',
      'This context metric includes direct, referral, paid, organic, and other measured channels.',
    ),
    {
      current: null,
      definition:
        'GA4 engagement-rate collection is not implemented in the current provider contract.',
      deltaPercent: null,
      key: 'engagement_rate',
      label: 'Engagement rate',
      previous: null,
      source: 'ga4',
      state: 'unsupported',
      unit: 'percent',
    },
    {
      current: null,
      definition:
        'GA4 key-event or conversion collection is not implemented in the current provider contract.',
      deltaPercent: null,
      key: 'conversions',
      label: 'Conversions',
      previous: null,
      source: 'ga4',
      state: 'unsupported',
      unit: 'count',
    },
  ];
}

function kpi(
  key: string,
  label: string,
  current: number | null,
  previous: number | null,
  unit: AnalyticsKpi['unit'],
  sourceState: AnalyticsAvailability,
  definition: string,
  source: AnalyticsKpi['source'],
  limitation?: string,
): AnalyticsKpi {
  const state = current === null && sourceState === 'available' ? 'no_data' : sourceState;
  return {
    current,
    definition,
    deltaPercent: analyticsDelta(current, previous),
    key,
    label,
    ...(limitation ? { limitation } : {}),
    previous,
    source,
    state,
    unit,
  };
}

function analyticsSourceState(
  connection: { lastSyncedAt: string | null; status: string } | undefined,
  hasRows: boolean,
  now: Date,
): AnalyticsAvailability {
  if (!connection) return 'not_connected';
  if (connection.status !== 'connected') return hasRows ? 'partial' : 'not_connected';
  if (!hasRows) return 'no_data';
  if (
    !connection.lastSyncedAt ||
    now.getTime() - new Date(connection.lastSyncedAt).getTime() > 72 * 60 * 60_000
  ) {
    return 'stale';
  }
  return 'available';
}

function combinedAnalyticsState(
  search: AnalyticsAvailability,
  ga: AnalyticsAvailability,
): AnalyticsAvailability {
  if (search === 'available' && ga === 'available') return 'available';
  if (search === 'stale' || ga === 'stale') return 'stale';
  if (search === 'not_connected' && ga === 'not_connected') return 'not_connected';
  if (search === 'no_data' && ga === 'no_data') return 'no_data';
  return 'partial';
}

function analyticsQualityNotes(
  connections: readonly {
    lastSyncedAt: string | null;
    propertyKind: 'ga4' | 'search_console';
    status: string;
  }[],
  searchState: AnalyticsAvailability,
  gaState: AnalyticsAvailability,
): string[] {
  const notes = [
    'Google can revise recent measurements; a re-finalized observation replaces its prior stored value.',
    'Search Console may omit anonymized or low-volume queries, so query rows may not sum to property totals.',
    'Metrics are collected by scheduled workers and this page never polls Google on demand.',
    'Date labels preserve source-reported calendar dates: Search Console uses Pacific Time and GA4 uses the connected property time zone, so cross-source day boundaries may differ.',
  ];
  if (searchState !== 'available') notes.push(`Search Console data state: ${searchState}.`);
  if (gaState !== 'available') notes.push(`GA4 data state: ${gaState}.`);
  if (connections.length === 0) notes.push('No Google property is connected for this site.');
  return notes;
}

function analyticsEventSummary(category: string, state: string): string {
  const label =
    {
      aio_proposal: 'AI proposal review',
      backup: 'Backup job',
      crawl: 'Site crawl',
      health_check: 'Health check',
      metrics_sync: 'Google metrics sync',
      publication: 'Website publication',
      publish: 'Publication worker',
      seo_audit: 'SEO audit',
    }[category] ?? category.replaceAll('_', ' ');
  return `${label} ${state}`;
}

function analyticsDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  for (
    let current = new Date(`${startDate}T00:00:00.000Z`).getTime();
    current <= end;
    current += 86_400_000
  ) {
    dates.push(new Date(current).toISOString().slice(0, 10));
  }
  return dates;
}

function hasAnalyticsRows(
  rows: readonly { date: string }[],
  startDate: string,
  endDate: string,
): boolean {
  return rows.some(({ date }) => date >= startDate && date <= endDate);
}

function inclusiveDays(startDate: string, endDate: string): number {
  return analyticsDates(startDate, endDate).length;
}

function sumPresent(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) : null;
}

function decimalValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: unknown): number {
  return Math.max(0, Math.trunc(decimalValue(value) ?? 0));
}

function nullableIntegerValue(value: unknown): number | null {
  const parsed = decimalValue(value);
  return parsed === null ? null : Math.max(0, Math.trunc(parsed));
}

function dateOnlyString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function dateOnlyNullableString(value: Date | string | null | undefined): string | null {
  return value ? dateOnlyString(value) : null;
}

function findingPage(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const candidate = (evidence as Record<string, unknown>).url;
  if (typeof candidate !== 'string' || candidate.length > 2_000) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function dateTimeString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function assertCurrentOrapAuthorization(
  client: TenantTransactionClient,
  actor: AdminActor,
): Promise<void> {
  if (!actor.authorization && actor.role === 'platform_owner') return;
  if (!actor.authorization) throw new OrapAuthorizationDeniedError('authorization.current');
  const result = await query<{ id: string }>(
    client,
    `SELECT membership.id
       FROM orap_staff_memberships membership
       JOIN platform_memberships legacy
         ON legacy.user_id = membership.user_id
        AND legacy.active
        AND legacy.role = membership.identity_kind
      WHERE membership.id = $1
        AND membership.user_id = $2
        AND membership.identity_kind = $3
        AND membership.status = 'active'
        AND membership.authorization_version = $4
      LIMIT 2`,
    [actor.authorization.membershipId, actor.id, actor.role, actor.authorization.version],
  );
  if (result.rows.length !== 1) {
    throw new OrapAuthorizationDeniedError('authorization.current');
  }
}

function resourceTarget(value: Record<string, unknown>): OrapResourceTarget {
  const siteId = value.siteId ?? value.site_id;
  const tenantId = value.tenantId ?? value.tenant_id;
  return {
    ...(typeof siteId === 'string' ? { siteId } : {}),
    ...(typeof tenantId === 'string' ? { tenantId } : {}),
  };
}

function assertBoundedAdministrativeReason(reason: string): void {
  const normalized = reason.trim();
  if (normalized.length < 3 || normalized.length > 500) {
    throw new Error(
      'Administrative session revocation requires a reason between 3 and 500 characters',
    );
  }
}

function assertStaffAuthorityMutation(actor: AdminActor, reason: string): void {
  assertPlatformOwnerIdentity(actor);
  const normalized = reason.trim();
  if (normalized.length < 3 || normalized.length > 500) {
    throw new Error('Staff authority changes require a reason between 3 and 500 characters');
  }
}

async function staffAccessAudit(
  client: TenantTransactionClient,
  actor: AdminActor,
  event: {
    action: string;
    after: unknown;
    before: unknown;
    reason: string;
    targetUserId: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO staff_access_audits
       (actor_user_id, target_user_id, action, decision, reason, trace_id, before, after)
     VALUES ($1, $2, $3, 'allowed', $4, $5, $6::jsonb, $7::jsonb)`,
    [
      actor.id,
      event.targetUserId,
      event.action,
      event.reason.trim(),
      actor.traceId,
      JSON.stringify(event.before),
      JSON.stringify(event.after),
    ],
  );
}

async function assertSite(
  client: TenantTransactionClient,
  tenantId: string,
  siteId: string,
): Promise<void> {
  const result = await query<{ id: string }>(
    client,
    `SELECT id FROM sites WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
    [tenantId, siteId],
  );
  if (result.rows.length !== 1) throw new Error('Site was not found');
}

async function lockCustomerSessionScope(
  client: TenantTransactionClient,
  input: { siteId: string; tenantId: string; userId: string },
): Promise<void> {
  // Authentication and customer recovery establish the account row as the first
  // identity lock. Keep the same user -> membership -> tenant/site order here so
  // this control cannot deadlock a recovery transaction that already holds the user.
  const user = await query<{ id: string }>(
    client,
    `SELECT id FROM users
      WHERE id = $1 AND status = 'active'
      FOR SHARE`,
    [input.userId],
  );
  if (user.rows.length !== 1) {
    throw new OrapResourceNotFoundError('Active customer site membership was not found');
  }
  const result = await query<{ id: string }>(
    client,
    `SELECT m.id
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
       JOIN sites s ON s.tenant_id = m.tenant_id AND s.id = m.site_id
         AND s.status = 'active'
      WHERE m.tenant_id = $1 AND m.site_id = $2 AND m.user_id = $3
        AND m.active
        AND m.role IN ('customer_owner', 'customer_editor', 'customer_viewer')
      LIMIT 2
      FOR SHARE OF m, t, s`,
    [input.tenantId, input.siteId, input.userId],
  );
  if (result.rows.length !== 1) {
    throw new OrapResourceNotFoundError('Active customer site membership was not found');
  }
}

async function membership(
  client: TenantTransactionClient,
  membershipId: string,
  siteId: string,
): Promise<Record<string, unknown>> {
  const result = await query<Record<string, unknown>>(
    client,
    `SELECT id, tenant_id, site_id, user_id, role, active
       FROM memberships WHERE id = $1 AND site_id = $2 FOR UPDATE`,
    [membershipId, siteId],
  );
  return required(result.rows[0], 'Membership was not found');
}

async function audit(
  client: TenantTransactionClient,
  actor: AdminActor,
  event: {
    action: string;
    after: unknown;
    before: unknown;
    reason: string;
    siteId?: string;
    targetId: string;
    targetType: string;
    tenantId?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (tenant_id, site_id, actor_id, action, reason, trace_id,
        target_type, target_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
    [
      event.tenantId ?? null,
      event.siteId ?? null,
      actor.id,
      event.action,
      event.reason.trim(),
      actor.traceId,
      event.targetType,
      event.targetId,
      JSON.stringify(event.before),
      JSON.stringify(event.after),
    ],
  );
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function redactContactRecipient(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return value ? { ...value, recipient_email: '[REDACTED]' } : null;
}
