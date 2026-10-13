import { randomUUID } from 'node:crypto';
import { domainToASCII } from 'node:url';

import { roles, type Role } from './roles.ts';
import type {
  AuthenticationAssurance,
  AuthenticationRepository,
  AccountSecurityTarget,
  LoginTarget,
  MfaFactorRecord,
  SessionAuthenticationMethod,
  SessionOwner,
  SessionRecord,
  VerificationMethod,
} from './service.ts';

interface LoginRow extends Record<string, unknown> {
  auth_state_version: string;
  blocked_until: Date | null;
  email_code_enabled: boolean;
  has_recovery_codes: boolean;
  host: string;
  normalized_email: string;
  password_hash: string;
  preferred_method: string | null;
  privileged_recovery_required: boolean;
  role: string;
  second_step_requirement: string;
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
    if (host === this.#orapHostname) {
      return this.acceptStaffInvitation({ ...input, host });
    }
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
      // The site-scoped advisory lock serializes seat admissions. Do not add a row-locking
      // clause here: PostgreSQL would require subscription UPDATE rights for the auth role.
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
                   (s.status IN ('past_due','cancelled') AND s.grace_ends_at >= $4))`,
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
      await client.query(
        `INSERT INTO account_authentication_policies
           (user_id, second_step_requirement, email_code_enabled)
         VALUES ($1, 'optional', false)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
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
      const policy = requiredRow(
        await query<{
          auth_state_version: string;
          email_code_enabled: boolean;
          has_recovery_codes: boolean;
          preferred_method: string | null;
          privileged_recovery_required: boolean;
          second_step_requirement: string;
        }>(
          client,
          `SELECT policy.auth_state_version::text, policy.second_step_requirement,
                  policy.email_code_enabled,
                  policy.preferred_method,
                  EXISTS (
                    SELECT 1 FROM account_recovery_codes recovery
                     WHERE recovery.user_id = policy.user_id
                       AND recovery.used_at IS NULL AND recovery.revoked_at IS NULL
                  ) AS has_recovery_codes,
                  EXISTS (
                    SELECT 1 FROM platform_memberships platform_membership
                     WHERE platform_membership.user_id = policy.user_id
                       AND platform_membership.active
                  ) AS privileged_recovery_required
             FROM account_authentication_policies policy WHERE policy.user_id = $1`,
          [user.id],
        ),
        'Account authentication policy was not found',
      );
      return {
        authStateVersion: policy.auth_state_version,
        emailCodeEnabled: policy.email_code_enabled,
        hasRecoveryCodes: policy.has_recovery_codes,
        host,
        normalizedEmail: invited.normalized_email,
        passwordHash: sessionPasswordHash,
        ...(isVerificationMethod(policy.preferred_method)
          ? { preferredMethod: policy.preferred_method }
          : {}),
        privilegedRecoveryRequired: policy.privileged_recovery_required,
        role,
        siteId: invited.site_id,
        tenantId: invited.tenant_id,
        userId: user.id,
        verificationRequired: policy.second_step_requirement === 'required',
      };
    });
  }

  private async acceptStaffInvitation(input: {
    displayName: string;
    host: string;
    now: Date;
    passwordHash: string;
    verifyExistingPassword(passwordHash: string): Promise<boolean>;
    tokenHash: string;
    traceId: string;
  }): Promise<LoginTarget | undefined> {
    return withAuthTransaction(this.pool, async (client) => {
      const invitation = await query<{
        created_by: string;
        display_name: string;
        id: string;
        job_title: string;
        normalized_email: string;
        role_id: string;
        role_slug: string;
        role_version_id: string;
      }>(
        client,
        `SELECT invitation.id, invitation.normalized_email, invitation.display_name,
                invitation.created_by, invitation.role_id, invitation.role_version_id,
                role.slug AS role_slug,
                COALESCE(invitation.scope_plan->1->>'jobTitle', '') AS job_title
           FROM staff_invitations invitation
           JOIN staff_roles role
             ON role.id = invitation.role_id AND role.active AND NOT role.owner_identity_only
           JOIN staff_role_versions version
             ON version.role_id = invitation.role_id
            AND version.id = invitation.role_version_id
          WHERE invitation.token_hash = $1 AND invitation.state = 'pending'
            AND invitation.expires_at > $2 AND invitation.exact_host = $3`,
        [input.tokenHash, input.now, input.host],
      );
      if (invitation.rows.length !== 1 || !invitation.rows[0]) return undefined;
      const invited = invitation.rows[0];
      const identityKind: Role =
        invited.role_slug === 'platform-admin' ? 'platform_admin' : 'staff';
      const existing = await query<{ id: string; password_hash: string; status: string }>(
        client,
        `SELECT user_account.id, user_account.status, credential.password_hash
           FROM users user_account
           JOIN credentials credential ON credential.user_id = user_account.id
          WHERE user_account.normalized_email = $1
          LIMIT 2`,
        [invited.normalized_email],
      );
      if (existing.rows.length > 1) return undefined;
      const existingUser = existing.rows[0];
      if (existingUser) {
        const platform = await query<{ id: string }>(
          client,
          `SELECT id FROM platform_memberships WHERE user_id = $1 AND active LIMIT 1`,
          [existingUser.id],
        );
        if (
          existingUser.status !== 'active' ||
          platform.rows.length > 0 ||
          !(await input.verifyExistingPassword(existingUser.password_hash))
        ) {
          return undefined;
        }
      }
      let user: { id: string };
      let sessionPasswordHash = input.passwordHash;
      if (existingUser) {
        user = existingUser;
        sessionPasswordHash = existingUser.password_hash;
      } else {
        user = requiredRow(
          await query<{ id: string }>(
            client,
            `INSERT INTO users (normalized_email, display_name)
             VALUES ($1, $2) RETURNING id`,
            [invited.normalized_email, invited.display_name || input.displayName],
          ),
          'Invited staff user creation failed',
        );
        await client.query(
          `INSERT INTO credentials (user_id, password_hash, password_changed_at)
           VALUES ($1, $2, $3)`,
          [user.id, input.passwordHash, input.now],
        );
      }
      await client.query(
        `INSERT INTO account_authentication_policies
           (user_id, second_step_requirement, email_code_enabled, preferred_method)
         VALUES ($1, 'required', true, 'email_code')
         ON CONFLICT (user_id) DO UPDATE
           SET second_step_requirement = 'required', email_code_enabled = true,
               preferred_method = COALESCE(account_authentication_policies.preferred_method,
                                           'email_code'), updated_at = now()`,
        [user.id],
      );
      await client.query(
        `INSERT INTO platform_memberships (user_id, role, active)
         VALUES ($1, $2, true)
         ON CONFLICT (user_id) DO UPDATE
           SET role = EXCLUDED.role, active = true, updated_at = now()`,
        [user.id, identityKind],
      );
      const membership = requiredRow(
        await query<{ id: string }>(
          client,
          `INSERT INTO orap_staff_memberships
             (user_id, identity_kind, status, job_title, created_by)
           VALUES ($1, $2, 'active', NULLIF($3, ''), $4)
           RETURNING id`,
          [user.id, identityKind, invited.job_title, invited.created_by],
        ),
        'ORAP staff membership creation failed',
      );
      const assignmentId = randomUUID();
      await client.query(
        `INSERT INTO staff_role_assignments
           (id, staff_membership_id, role_id, role_version_id, primary_role,
            assigned_by, reason)
         VALUES ($1, $2, $3, $4, true, $5, 'Accepted owner-issued staff invitation')`,
        [assignmentId, membership.id, invited.role_id, invited.role_version_id, invited.created_by],
      );
      await client.query(
        `INSERT INTO staff_resource_scopes (assignment_id, scope_type, created_by)
         VALUES ($1, 'platform', $2)`,
        [assignmentId, invited.created_by],
      );
      await client.query(`SELECT accept_orap_staff_invitation($1, $2)`, [invited.id, user.id]);
      await insertAudit(client, {
        action: 'staff.invitation.accepted',
        actorId: user.id,
        metadata: {
          existingAccount: Boolean(existingUser),
          host: input.host,
          invitationId: invited.id,
          role: identityKind,
          roleSlug: invited.role_slug,
        },
        targetId: invited.id,
        targetType: 'staff_invitation',
        traceId: input.traceId,
      });
      const policy = requiredRow(
        await query<{
          auth_state_version: string;
          email_code_enabled: boolean;
          preferred_method: string | null;
        }>(
          client,
          `SELECT auth_state_version::text, email_code_enabled, preferred_method
             FROM account_authentication_policies WHERE user_id = $1`,
          [user.id],
        ),
        'Staff authentication policy was not found',
      );
      return {
        authStateVersion: policy.auth_state_version,
        emailCodeEnabled: policy.email_code_enabled,
        hasRecoveryCodes: false,
        host: input.host,
        normalizedEmail: invited.normalized_email,
        passwordHash: sessionPasswordHash,
        ...(isVerificationMethod(policy.preferred_method)
          ? { preferredMethod: policy.preferred_method }
          : {}),
        privilegedRecoveryRequired: true,
        role: identityKind,
        userId: user.id,
        verificationRequired: true,
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
           SELECT u.id AS user_id, u.normalized_email, c.password_hash, c.blocked_until, m.role,
                   m.tenant_id, m.site_id, d.hostname AS host,
                   ap.auth_state_version::text AS auth_state_version,
                   COALESCE(ap.second_step_requirement, 'optional') AS second_step_requirement,
                   COALESCE(ap.email_code_enabled, false) AS email_code_enabled,
                   EXISTS (
                     SELECT 1 FROM account_recovery_codes recovery
                      WHERE recovery.user_id = u.id
                        AND recovery.used_at IS NULL AND recovery.revoked_at IS NULL
                   ) AS has_recovery_codes,
                   EXISTS (
                     SELECT 1 FROM platform_memberships platform_membership
                      WHERE platform_membership.user_id = u.id AND platform_membership.active
                   ) AS privileged_recovery_required,
                   ap.preferred_method
              FROM users u
              JOIN credentials c ON c.user_id = u.id
              JOIN account_authentication_policies ap ON ap.user_id = u.id
             JOIN memberships m ON m.user_id = u.id AND m.active
             JOIN sites st ON st.id = m.site_id AND st.tenant_id = m.tenant_id AND st.status = 'active'
             JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
             JOIN domains d ON d.site_id = m.site_id AND d.tenant_id = m.tenant_id
              AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
             WHERE u.normalized_email = $1 AND u.status = 'active' AND d.hostname = $2
               AND $2 <> $3
         ), platform_target AS (
            SELECT u.id AS user_id, u.normalized_email, c.password_hash, c.blocked_until, pm.role,
                   NULL::uuid AS tenant_id, NULL::uuid AS site_id, $2::text AS host,
                   ap.auth_state_version::text AS auth_state_version,
                   'required'::text AS second_step_requirement,
                    COALESCE(ap.email_code_enabled, false) AS email_code_enabled,
                    EXISTS (
                      SELECT 1 FROM account_recovery_codes recovery
                       WHERE recovery.user_id = u.id
                         AND recovery.used_at IS NULL AND recovery.revoked_at IS NULL
                    ) AS has_recovery_codes,
                   true AS privileged_recovery_required,
                   ap.preferred_method
              FROM users u
              JOIN credentials c ON c.user_id = u.id
              JOIN platform_memberships pm ON pm.user_id = u.id AND pm.active
              JOIN account_authentication_policies ap ON ap.user_id = u.id
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
        authStateVersion: row.auth_state_version,
        ...(row.blocked_until ? { blockedUntil: row.blocked_until } : {}),
        emailCodeEnabled: row.email_code_enabled,
        hasRecoveryCodes: row.has_recovery_codes,
        host: row.host,
        normalizedEmail: row.normalized_email,
        passwordHash: row.password_hash,
        ...(isVerificationMethod(row.preferred_method)
          ? { preferredMethod: row.preferred_method }
          : {}),
        privilegedRecoveryRequired: row.privileged_recovery_required,
        role,
        ...(row.site_id ? { siteId: row.site_id } : {}),
        ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
        userId: row.user_id,
        verificationRequired: row.second_step_requirement === 'required',
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

  async consumeTotpCounter(input: { counter: number; factorId: string }): Promise<boolean> {
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{ id: string }>(
        client,
        `UPDATE mfa_factors
            SET last_used_counter = $1
          WHERE id = $2 AND kind = 'totp' AND verified_at IS NOT NULL
            AND revoked_at IS NULL
            AND (last_used_counter IS NULL OR last_used_counter < $1)
          RETURNING id`,
        [input.counter, input.factorId],
      );
      return result.rows.length === 1;
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
    assuranceLevel: AuthenticationAssurance;
    authenticationMethod: SessionAuthenticationMethod;
    expectedAuthStateVersion: string;
    expectedPasswordHash: string;
    expiresAt: Date;
    factorId?: string;
    host: string;
    recoveryRestricted: boolean;
    recoveryCodeHash?: string;
    role: Role;
    siteId?: string;
    tenantId?: string;
    tokenHash: string;
    traceId: string;
    userId: string;
    verifiedAt?: Date;
  }): Promise<boolean> {
    if (Boolean(input.siteId) !== Boolean(input.tenantId)) {
      throw new Error('Session tenant and site scope must be provided together');
    }
    const host = normalizeHost(input.host);
    const recoveryCodeSession = input.authenticationMethod === 'recovery_code';
    if (
      recoveryCodeSession &&
      (!input.tenantId ||
        !input.siteId ||
        !input.role.startsWith('customer_') ||
        !input.recoveryRestricted ||
        input.assuranceLevel !== 'recovery')
    ) {
      return false;
    }
    return withAuthTransaction(this.pool, async (client) => {
      // Account recovery rotates the entire active code set and advances the
      // authentication state. Serialize those changes before taking any code,
      // credential, membership, or policy locks so simultaneous sibling-code
      // claims cannot deadlock or each issue a restricted session.
      if (recoveryCodeSession) {
        const account = await query<{ id: string }>(
          client,
          `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
          [input.userId],
        );
        if (account.rows.length !== 1) return false;
      }
      // Serialize issuance with password changes. If issuance wins, a following reset
      // waits and revokes this session; if reset wins, this expected hash no longer
      // matches and no session is created.
      const credential = await query<{ password_hash: string }>(
        client,
        `SELECT c.password_hash
          FROM credentials c
          JOIN users u ON u.id = c.user_id AND u.status = 'active'
          WHERE c.user_id = $1 AND c.password_hash = $2
          FOR SHARE OF c, u`,
        [input.userId, input.expectedPasswordHash],
      );
      if (credential.rows.length !== 1) return false;

      // Lock only authentication-managed authorization rows. Tenant, site, and domain
      // controls are read-only to this role and are revalidated on every authenticated request.
      const scope =
        input.tenantId && input.siteId
          ? await query<{
              auth_state_version: string;
              email_code_enabled: boolean;
              has_active_platform_membership: boolean;
              role: string;
              second_step_requirement: string;
            }>(
              client,
              `SELECT m.role, policy.auth_state_version::text,
                      EXISTS (
                        SELECT 1 FROM platform_memberships platform_membership
                         WHERE platform_membership.user_id = m.user_id
                           AND platform_membership.active
                      ) AS has_active_platform_membership,
                      policy.second_step_requirement, policy.email_code_enabled
                 FROM memberships m
                 JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
                 JOIN sites st ON st.tenant_id = m.tenant_id AND st.id = m.site_id
                   AND st.status = 'active'
                 JOIN domains d ON d.tenant_id = m.tenant_id AND d.site_id = m.site_id
                   AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
                 JOIN account_authentication_policies policy ON policy.user_id = m.user_id
                WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.site_id = $3
                  AND m.active AND d.hostname = $4 AND $4 <> $5
                LIMIT 2
                FOR SHARE OF m, policy`,
              [input.userId, input.tenantId, input.siteId, host, this.#orapHostname],
            )
          : await query<{
              auth_state_version: string;
              email_code_enabled: boolean;
              has_active_platform_membership: boolean;
              role: string;
              second_step_requirement: string;
            }>(
              client,
              `SELECT membership.role, policy.auth_state_version::text,
                      true AS has_active_platform_membership,
                      policy.second_step_requirement,
                      policy.email_code_enabled
                 FROM platform_memberships membership
                 JOIN account_authentication_policies policy
                   ON policy.user_id = membership.user_id
                WHERE membership.user_id = $1 AND membership.active AND $2 = $3
                LIMIT 2
                FOR SHARE OF membership, policy`,
              [input.userId, host, this.#orapHostname],
            );
      if (scope.rows.length !== 1 || scope.rows[0]?.role !== input.role) return false;
      const currentScope = scope.rows[0];
      if (currentScope.auth_state_version !== input.expectedAuthStateVersion) return false;
      if (
        input.authenticationMethod === 'password' &&
        (currentScope.second_step_requirement !== 'optional' || !input.role.startsWith('customer_'))
      ) {
        return false;
      }
      if (input.authenticationMethod === 'email_code' && !currentScope.email_code_enabled) {
        return false;
      }
      if (input.authenticationMethod === 'webauthn') return false;
      if (input.authenticationMethod === 'totp') {
        if (!input.factorId) return false;
        const factor = await query<{ id: string }>(
          client,
          `SELECT id FROM mfa_factors
            WHERE id = $1 AND user_id = $2 AND kind = 'totp'
              AND verified_at IS NOT NULL AND revoked_at IS NULL
            FOR SHARE`,
          [input.factorId, input.userId],
        );
        if (factor.rows.length !== 1) return false;
      }
      if (input.authenticationMethod === 'recovery_code') {
        if (
          !input.recoveryCodeHash ||
          currentScope.second_step_requirement !== 'required' ||
          currentScope.has_active_platform_membership ||
          !input.role.startsWith('customer_')
        ) {
          return false;
        }
        const recovery = await query<{ id: string; set_version: number }>(
          client,
          `UPDATE account_recovery_codes
              SET used_at = now()
            WHERE user_id = $1 AND code_hash = $2
              AND used_at IS NULL AND revoked_at IS NULL
              AND set_version = (
                SELECT max(newest.set_version)
                  FROM account_recovery_codes newest
                 WHERE newest.user_id = $1 AND newest.used_at IS NULL
                   AND newest.revoked_at IS NULL
              )
            RETURNING id, set_version`,
          [input.userId, input.recoveryCodeHash],
        );
        if (recovery.rows.length !== 1 || !recovery.rows[0]) return false;
        await client.query(
          `UPDATE account_recovery_codes
              SET revoked_at = COALESCE(revoked_at, now())
            WHERE user_id = $1 AND set_version = $2 AND id <> $3
              AND used_at IS NULL AND revoked_at IS NULL`,
          [input.userId, recovery.rows[0].set_version, recovery.rows[0].id],
        );
        await client.query(
          `UPDATE account_authentication_policies
              SET auth_state_version = auth_state_version + 1,
                  updated_at = now()
            WHERE user_id = $1`,
          [input.userId],
        );
      }
      await client.query(
        `INSERT INTO sessions
           (user_id, tenant_id, site_id, host, token_hash, expires_at,
            authentication_method, authentication_assurance, verified_at, recovery_restricted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.userId,
          input.tenantId ?? null,
          input.siteId ?? null,
          host,
          input.tokenHash,
          input.expiresAt,
          input.authenticationMethod,
          input.assuranceLevel,
          input.verifiedAt ?? null,
          input.recoveryRestricted,
        ],
      );
      await insertAudit(client, {
        action: 'auth.login.succeeded',
        actorId: input.userId,
        metadata: {
          authenticationMethod: input.authenticationMethod,
          assuranceLevel: input.assuranceLevel,
          host,
        },
        ...(input.siteId ? { siteId: input.siteId } : {}),
        targetId: input.userId,
        targetType: 'user',
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        traceId: input.traceId,
      });
      if (input.authenticationMethod !== 'password') {
        await insertAudit(client, {
          action: 'auth.mfa.verified',
          actorId: input.userId,
          metadata: {
            assuranceLevel: input.assuranceLevel,
            host,
            method: input.authenticationMethod,
            recoveryRestricted: input.recoveryRestricted,
          },
          ...(input.siteId ? { siteId: input.siteId } : {}),
          targetId: input.userId,
          targetType: 'user',
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          traceId: input.traceId,
        });
      }
      return true;
    });
  }

  async createPasswordRecovery(input: {
    expiresAt: Date;
    host: string;
    normalizedEmail: string;
    traceId: string;
    tokenHash: string;
  }): Promise<{ normalizedEmail: string } | undefined> {
    const host = normalizeHost(input.host);
    if (host === this.#orapHostname) return undefined;
    return withAuthTransaction(this.pool, async (client) => {
      const user = await query<{ normalized_email: string; user_id: string }>(
        client,
        `SELECT DISTINCT u.id AS user_id, u.normalized_email
           FROM users u
           JOIN memberships m ON m.user_id = u.id AND m.active
           JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
           JOIN sites st ON st.tenant_id = m.tenant_id AND st.id = m.site_id
             AND st.status = 'active'
           JOIN domains d ON d.tenant_id = m.tenant_id AND d.site_id = m.site_id
             AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
          WHERE u.normalized_email = $1 AND u.status = 'active' AND d.hostname = $2
            AND NOT EXISTS (
              SELECT 1 FROM platform_memberships pm
               WHERE pm.user_id = u.id AND pm.active
            )
         LIMIT 2`,
        [input.normalizedEmail, host],
      );
      if (user.rows.length !== 1 || !user.rows[0]) return undefined;
      // Serialize replacement of the active reset token for this identity. The
      // first lookup is deliberately non-locking because DISTINCT join results
      // cannot be row-locked; after obtaining the identity lock, re-evaluate
      // host/customer eligibility in a fresh READ COMMITTED statement.
      const userLock = await query<{ id: string }>(
        client,
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [user.rows[0].user_id],
      );
      if (userLock.rows.length !== 1) return undefined;
      const eligible = await query<{ id: string }>(
        client,
        `SELECT u.id
           FROM users u
          WHERE u.id = $1 AND u.status = 'active'
            AND EXISTS (
              SELECT 1
                FROM memberships m
                JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
                JOIN sites st ON st.tenant_id = m.tenant_id AND st.id = m.site_id
                  AND st.status = 'active'
                JOIN domains d ON d.tenant_id = m.tenant_id AND d.site_id = m.site_id
                  AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
               WHERE m.user_id = u.id AND m.active AND d.hostname = $2
            )
            AND NOT EXISTS (
              SELECT 1 FROM platform_memberships pm
               WHERE pm.user_id = u.id AND pm.active
            )
          LIMIT 1`,
        [user.rows[0].user_id, host],
      );
      if (eligible.rows.length !== 1) return undefined;
      await client.query(
        `UPDATE password_recovery_tokens
            SET used_at = now()
          WHERE user_id = $1 AND used_at IS NULL`,
        [user.rows[0].user_id],
      );
      await client.query(
        `INSERT INTO password_recovery_tokens (user_id, token_hash, expires_at, host)
         VALUES ($1, $2, $3, $4)`,
        [user.rows[0].user_id, input.tokenHash, input.expiresAt, host],
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
    host: string;
    newPasswordHash: string;
    now: Date;
    traceId: string;
    tokenHash: string;
  }): Promise<boolean> {
    if (normalizeHost(input.host) === this.#orapHostname) return false;
    return withAuthTransaction(this.pool, async (client) => {
      const token = await query<{ id: string; user_id: string }>(
        client,
        `SELECT id, user_id
           FROM password_recovery_tokens
          WHERE token_hash = $1 AND host = $2 AND used_at IS NULL AND expires_at > $3
            AND NOT EXISTS (
              SELECT 1 FROM platform_memberships pm
               WHERE pm.user_id = password_recovery_tokens.user_id AND pm.active
            )
          FOR UPDATE`,
        [input.tokenHash, normalizeHost(input.host), input.now],
      );
      if (token.rows.length !== 1 || !token.rows[0]) return false;
      const userLock = await query<{ id: string }>(
        client,
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [token.rows[0].user_id],
      );
      if (userLock.rows.length !== 1) return false;
      // The token lookup and the user-row lock are separate statements. Recheck
      // privileged membership in a fresh READ COMMITTED snapshot after acquiring
      // the shared account lock so a concurrent platform-role activation cannot
      // turn an ordinary customer recovery into a privileged password reset.
      // A plain SELECT is sufficient: every platform-membership activation must
      // acquire this same user-row lock before commit. Taking a membership-row
      // lock here would invert that order and permit a user<->membership deadlock.
      const privileged = await query<{ id: string }>(
        client,
        `SELECT id
           FROM platform_memberships
          WHERE user_id = $1 AND active
          LIMIT 1`,
        [token.rows[0].user_id],
      );
      if (privileged.rows.length !== 0) return false;
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

  async completeCustomerRecovery(input: {
    confirmed: boolean;
    host: string;
    now: Date;
    recoveryCodeHashes: string[];
    sessionTokenHash: string;
    traceId: string;
    verifyCurrentPassword(passwordHash: string): Promise<boolean>;
  }): Promise<boolean> {
    if (input.confirmed !== true || input.recoveryCodeHashes.length === 0) return false;
    const host = normalizeHost(input.host);
    if (host === this.#orapHostname) return false;
    return withAuthTransaction(this.pool, async (client) => {
      const scope = await query<{ site_id: string; tenant_id: string; user_id: string }>(
        client,
        `SELECT s.user_id, s.tenant_id, s.site_id
           FROM sessions s
           JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
             AND m.site_id = s.site_id AND m.active
             AND m.role IN ('customer_owner', 'customer_editor', 'customer_viewer')
           JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
           JOIN sites st ON st.tenant_id = m.tenant_id AND st.id = m.site_id
             AND st.status = 'active'
           JOIN domains d ON d.tenant_id = m.tenant_id AND d.site_id = m.site_id
             AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
             AND d.hostname = $2
           WHERE s.token_hash = $1 AND s.host = $2 AND s.revoked_at IS NULL
             AND s.expires_at > $3 AND s.recovery_restricted
            AND s.authentication_method = 'recovery_code'
            AND s.authentication_assurance = 'recovery' AND s.verified_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM platform_memberships pm
               WHERE pm.user_id = s.user_id AND pm.active
            )
          LIMIT 2`,
        [input.sessionTokenHash, host, input.now],
      );
      if (scope.rows.length !== 1 || !scope.rows[0]) return false;
      const account = scope.rows[0];
      const userLock = await query<{ id: string }>(
        client,
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [account.user_id],
      );
      if (userLock.rows.length !== 1) return false;
      // Platform-membership activation must take the same user-row lock before it
      // commits. Rechecking after that lock prevents an in-flight promotion from
      // using this customer-only recovery path.
      const privileged = await query<{ id: string }>(
        client,
        `SELECT id
           FROM platform_memberships
          WHERE user_id = $1 AND active
          LIMIT 1`,
        [account.user_id],
      );
      if (privileged.rows.length !== 0) return false;
      // Verify the submitted password while holding the credential-row lock. Any
      // password change must wait for this transaction; if it wins first, this reads
      // and verifies the replacement hash instead of a stale pre-lock snapshot.
      const credentialLock = await query<{ password_hash: string; user_id: string }>(
        client,
        `SELECT user_id, password_hash
           FROM credentials
          WHERE user_id = $1
          FOR UPDATE`,
        [account.user_id],
      );
      if (
        credentialLock.rows.length !== 1 ||
        !credentialLock.rows[0] ||
        !(await input.verifyCurrentPassword(credentialLock.rows[0].password_hash))
      ) {
        return false;
      }
      const sessionLock = await query<{ id: string; site_id: string; tenant_id: string }>(
        client,
        `SELECT s.id, s.tenant_id, s.site_id
           FROM sessions s
           JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
             AND m.site_id = s.site_id AND m.active
             AND m.role IN ('customer_owner', 'customer_editor', 'customer_viewer')
           JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
           JOIN sites st ON st.tenant_id = m.tenant_id AND st.id = m.site_id
             AND st.status = 'active'
           JOIN domains d ON d.tenant_id = m.tenant_id AND d.site_id = m.site_id
             AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
             AND d.hostname = $3
          WHERE s.token_hash = $1 AND s.user_id = $2 AND s.host = $3
            AND revoked_at IS NULL AND expires_at > $4 AND recovery_restricted
            AND authentication_method = 'recovery_code'
            AND authentication_assurance = 'recovery' AND verified_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM platform_memberships platform_membership
               WHERE platform_membership.user_id = s.user_id AND platform_membership.active
            )
          LIMIT 2
          FOR UPDATE OF s, m, t, st, d`,
        [input.sessionTokenHash, account.user_id, host, input.now],
      );
      if (sessionLock.rows.length !== 1) return false;
      const lockedSession = sessionLock.rows[0];
      if (!lockedSession) return false;
      const policy = await query<{
        email_code_enabled: boolean;
        second_step_requirement: string;
        user_id: string;
      }>(
        client,
        `SELECT user_id, second_step_requirement, email_code_enabled
           FROM account_authentication_policies
          WHERE user_id = $1
          FOR UPDATE`,
        [account.user_id],
      );
      if (policy.rows.length !== 1 || !policy.rows[0]) return false;
      const lockedPolicy = policy.rows[0];
      const nextSet = requiredRow(
        await query<{ set_version: number }>(
          client,
          `SELECT COALESCE(max(set_version), 0)::integer + 1 AS set_version
             FROM account_recovery_codes
            WHERE user_id = $1`,
          [account.user_id],
        ),
        'Recovery-code version was not available',
      );
      const recoveryCodesRevoked = await query<{ id: string }>(
        client,
        `UPDATE account_recovery_codes
            SET revoked_at = COALESCE(revoked_at, $1)
          WHERE user_id = $2 AND revoked_at IS NULL
          RETURNING id`,
        [input.now, account.user_id],
      );
      const totpRevoked = await query<{ id: string }>(
        client,
        `UPDATE mfa_factors
            SET revoked_at = $1
          WHERE user_id = $2 AND kind = 'totp'
            AND verified_at IS NOT NULL AND revoked_at IS NULL
          RETURNING id`,
        [input.now, account.user_id],
      );
      const webauthnRevoked = await query<{ id: string }>(
        client,
        `UPDATE webauthn_credentials credential
            SET revoked_at = $1,
                revoke_reason = 'customer-account-recovery',
                updated_at = $1
           FROM webauthn_scopes scope
          WHERE credential.scope_id = scope.id
            AND scope.user_id = $2
            AND credential.revoked_at IS NULL
          RETURNING credential.id`,
        [input.now, account.user_id],
      );
      await client.query(
        `UPDATE account_authentication_policies
            SET second_step_requirement = 'optional',
                email_code_enabled = false,
                preferred_method = NULL,
                auth_state_version = auth_state_version + 1,
                updated_at = $2
          WHERE user_id = $1`,
        [account.user_id, input.now],
      );
      await client.query(
        `INSERT INTO account_recovery_codes (user_id, set_version, code_hash)
         SELECT $1, $2, unnest($3::text[])`,
        [account.user_id, nextSet.set_version, input.recoveryCodeHashes],
      );
      const resetTokensRevoked = await query<{ id: string }>(
        client,
        `UPDATE password_recovery_tokens
            SET used_at = $1
          WHERE user_id = $2 AND used_at IS NULL
          RETURNING id`,
        [input.now, account.user_id],
      );
      const sessionsRevoked = await query<{ id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = $1, revoke_reason = 'account-recovery-completed'
          WHERE user_id = $2 AND revoked_at IS NULL
          RETURNING id`,
        [input.now, account.user_id],
      );
      await insertAudit(client, {
        action: 'auth.customer_recovery.completed',
        actorId: account.user_id,
        metadata: {
          accountWide: true,
          emailCodeDisabled: true,
          emailCodePreviouslyEnabled: lockedPolicy.email_code_enabled,
          previousSecondStepRequirement: lockedPolicy.second_step_requirement,
          reason: 'customer-recovery-lockout-reset',
          recoveryCodesIssued: input.recoveryCodeHashes.length,
          recoveryCodesRevoked: recoveryCodesRevoked.rows.length,
          resetTokensRevoked: resetTokensRevoked.rows.length,
          sessionsRevoked: sessionsRevoked.rows.length,
          totpFactorsRevoked: totpRevoked.rows.length,
          webauthnCredentialsRevoked: webauthnRevoked.rows.length,
        },
        siteId: lockedSession.site_id,
        targetId: account.user_id,
        targetType: 'user',
        tenantId: lockedSession.tenant_id,
        traceId: input.traceId,
      });
      return true;
    });
  }

  async findAccountSecurityTarget(input: {
    host: string;
    tokenHash: string;
  }): Promise<AccountSecurityTarget | undefined> {
    const host = normalizeHost(input.host);
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{
        email_code_enabled: boolean;
        has_totp: boolean;
        has_webauthn: boolean;
        host: string;
        normalized_email: string;
        password_hash: string;
        role: string;
        second_step_requirement: string;
        site_id: string | null;
        tenant_id: string | null;
        user_id: string;
      }>(
        client,
        `WITH customer_target AS (
           SELECT u.id AS user_id, u.normalized_email, c.password_hash, m.role,
                  s.tenant_id, s.site_id, s.host,
                  COALESCE(policy.email_code_enabled, false) AS email_code_enabled,
                  COALESCE(policy.second_step_requirement, 'optional') AS second_step_requirement,
                  EXISTS (
                    SELECT 1 FROM mfa_factors factor
                     WHERE factor.user_id = u.id AND factor.kind = 'totp'
                       AND factor.verified_at IS NOT NULL AND factor.revoked_at IS NULL
                  ) AS has_totp,
                  EXISTS (
                    SELECT 1
                      FROM webauthn_scopes webauthn_scope
                      JOIN webauthn_credentials webauthn_credential
                        ON webauthn_credential.scope_id = webauthn_scope.id
                       AND webauthn_credential.revoked_at IS NULL
                     WHERE webauthn_scope.user_id = u.id
                       AND webauthn_scope.tenant_id = s.tenant_id
                       AND webauthn_scope.site_id = s.site_id
                       AND webauthn_scope.rp_id = s.host
                  ) AS has_webauthn
             FROM sessions s
             JOIN users u ON u.id = s.user_id AND u.status = 'active'
             JOIN credentials c ON c.user_id = u.id
             JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
               AND m.site_id = s.site_id AND m.active
             JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
             JOIN sites st ON st.tenant_id = m.tenant_id AND st.id = m.site_id
               AND st.status = 'active'
             JOIN domains d ON d.tenant_id = m.tenant_id AND d.site_id = m.site_id
               AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
               AND d.hostname = $2
             LEFT JOIN account_authentication_policies policy ON policy.user_id = u.id
             WHERE s.token_hash = $1 AND s.host = $2 AND s.revoked_at IS NULL
               AND $2 <> $3
               AND NOT EXISTS (
                 SELECT 1 FROM platform_memberships platform_membership
                  WHERE platform_membership.user_id = u.id AND platform_membership.active
               )
               AND s.expires_at > now() AND NOT s.recovery_restricted
              AND s.last_seen_at > now() - interval '30 minutes'
              AND (
                COALESCE(policy.second_step_requirement, 'optional') = 'optional'
                OR (s.authentication_assurance IN ('baseline', 'strong')
                    AND s.verified_at IS NOT NULL)
              )
         ), platform_target AS (
           SELECT u.id AS user_id, u.normalized_email, c.password_hash, pm.role,
                  NULL::uuid AS tenant_id, NULL::uuid AS site_id, s.host,
                  COALESCE(policy.email_code_enabled, false) AS email_code_enabled,
                  'required'::text AS second_step_requirement,
                  EXISTS (
                    SELECT 1 FROM mfa_factors factor
                     WHERE factor.user_id = u.id AND factor.kind = 'totp'
                       AND factor.verified_at IS NOT NULL AND factor.revoked_at IS NULL
                  ) AS has_totp,
                  EXISTS (
                    SELECT 1
                      FROM webauthn_scopes webauthn_scope
                      JOIN webauthn_credentials webauthn_credential
                        ON webauthn_credential.scope_id = webauthn_scope.id
                       AND webauthn_credential.revoked_at IS NULL
                     WHERE webauthn_scope.user_id = u.id
                       AND webauthn_scope.tenant_id IS NULL
                       AND webauthn_scope.site_id IS NULL
                       AND webauthn_scope.rp_id = s.host
                  ) AS has_webauthn
             FROM sessions s
             JOIN users u ON u.id = s.user_id AND u.status = 'active'
             JOIN credentials c ON c.user_id = u.id
             JOIN platform_memberships pm ON pm.user_id = u.id AND pm.active
             LEFT JOIN account_authentication_policies policy ON policy.user_id = u.id
            WHERE s.token_hash = $1 AND s.host = $2 AND $2 = $3
              AND s.revoked_at IS NULL AND s.expires_at > now()
              AND NOT s.recovery_restricted
              AND s.last_seen_at > now() - interval '30 minutes'
              AND s.authentication_assurance IN ('baseline', 'strong')
              AND s.verified_at IS NOT NULL
         )
         SELECT * FROM customer_target
         UNION ALL
         SELECT * FROM platform_target
         LIMIT 2`,
        [input.tokenHash, host, this.#orapHostname],
      );
      if (result.rows.length !== 1 || !result.rows[0]) return undefined;
      const row = result.rows[0];
      const role = parseRole(row.role);
      if (!role) return undefined;
      if (!(await refreshAuthenticatedSession(client, input.tokenHash, host))) return undefined;
      return {
        emailCodeEnabled: row.email_code_enabled,
        hasTotp: row.has_totp,
        hasWebAuthn: row.has_webauthn,
        host: row.host,
        normalizedEmail: row.normalized_email,
        passwordHash: row.password_hash,
        role,
        secondStepRequired: row.second_step_requirement === 'required',
        ...(row.site_id ? { siteId: row.site_id } : {}),
        ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
        userId: row.user_id,
      };
    });
  }

  async updateCustomerEmailCodePolicy(input: {
    enabled: boolean;
    host: string;
    now: Date;
    recoveryCodeHashes: string[];
    sessionTokenHash: string;
    traceId: string;
    userId: string;
  }): Promise<boolean> {
    const host = normalizeHost(input.host);
    if (host === this.#orapHostname) return false;
    return withAuthTransaction(this.pool, async (client) => {
      const userLock = await query<{ id: string }>(
        client,
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [input.userId],
      );
      if (userLock.rows.length !== 1) return false;
      const privileged = await query<{ id: string }>(
        client,
        `SELECT id
           FROM platform_memberships
          WHERE user_id = $1 AND active
          LIMIT 1`,
        [input.userId],
      );
      if (privileged.rows.length !== 0) return false;
      const credentialLock = await query<{ user_id: string }>(
        client,
        `SELECT user_id FROM credentials WHERE user_id = $1 FOR UPDATE`,
        [input.userId],
      );
      if (credentialLock.rows.length !== 1) return false;
      const scope = await query<{ site_id: string; tenant_id: string }>(
        client,
        `SELECT s.tenant_id, s.site_id
           FROM sessions s
           JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
             AND m.site_id = s.site_id AND m.active
             AND m.role IN ('customer_owner', 'customer_editor', 'customer_viewer')
           JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
           JOIN sites st ON st.tenant_id = m.tenant_id AND st.id = m.site_id
             AND st.status = 'active'
           JOIN domains d ON d.tenant_id = m.tenant_id AND d.site_id = m.site_id
             AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
             AND d.hostname = $3
           LEFT JOIN account_authentication_policies policy ON policy.user_id = s.user_id
          WHERE s.token_hash = $1 AND s.user_id = $2 AND s.host = $3
            AND s.revoked_at IS NULL AND s.expires_at > $4 AND NOT s.recovery_restricted
            AND s.last_seen_at > $4 - interval '30 minutes'
            AND (
              COALESCE(policy.second_step_requirement, 'optional') = 'optional'
              OR (s.authentication_assurance IN ('baseline', 'strong')
                  AND s.verified_at IS NOT NULL)
            )
          LIMIT 2
          FOR UPDATE OF s`,
        [input.sessionTokenHash, input.userId, host, input.now],
      );
      if (scope.rows.length !== 1 || !scope.rows[0]) return false;
      const policy = await query<{ user_id: string }>(
        client,
        `SELECT user_id FROM account_authentication_policies
          WHERE user_id = $1
          FOR UPDATE`,
        [input.userId],
      );
      if (policy.rows.length !== 1) return false;
      const hasTotp = requiredRow(
        await query<{ enabled: boolean }>(
          client,
          `SELECT EXISTS (
             SELECT 1 FROM mfa_factors
              WHERE user_id = $1 AND kind = 'totp'
                AND verified_at IS NOT NULL AND revoked_at IS NULL
           ) AS enabled`,
          [input.userId],
        ),
        'Account factor state was not found',
      ).enabled;
      const secondStepRequired = input.enabled || hasTotp;
      await client.query(
        `INSERT INTO account_authentication_policies
           (user_id, second_step_requirement, email_code_enabled, preferred_method, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
           SET second_step_requirement = EXCLUDED.second_step_requirement,
               email_code_enabled = EXCLUDED.email_code_enabled,
               preferred_method = EXCLUDED.preferred_method,
               updated_at = EXCLUDED.updated_at`,
        [
          input.userId,
          secondStepRequired ? 'required' : 'optional',
          input.enabled,
          input.enabled ? 'email_code' : hasTotp ? 'totp' : null,
          input.now,
        ],
      );
      if (input.enabled || !hasTotp) {
        await client.query(
          `UPDATE account_recovery_codes
              SET revoked_at = COALESCE(revoked_at, $1)
            WHERE user_id = $2 AND used_at IS NULL AND revoked_at IS NULL`,
          [input.now, input.userId],
        );
      }
      if (input.enabled) {
        if (input.recoveryCodeHashes.length === 0) {
          throw new Error('Email verification recovery codes are missing');
        }
        const nextSet = requiredRow(
          await query<{ set_version: number }>(
            client,
            `SELECT COALESCE(max(set_version), 0)::integer + 1 AS set_version
               FROM account_recovery_codes
              WHERE user_id = $1`,
            [input.userId],
          ),
          'Recovery-code version was not available',
        );
        await client.query(
          `INSERT INTO account_recovery_codes (user_id, set_version, code_hash)
           SELECT $1, $2, unnest($3::text[])`,
          [input.userId, nextSet.set_version, input.recoveryCodeHashes],
        );
      }
      await client.query(
        `UPDATE sessions
            SET revoked_at = $1, revoke_reason = 'authentication-policy-changed'
          WHERE user_id = $2 AND revoked_at IS NULL`,
        [input.now, input.userId],
      );
      await insertAudit(client, {
        action: 'auth.email_code_policy.changed',
        actorId: input.userId,
        metadata: {
          emailCodeEnabled: input.enabled,
          recoveryCodesReplaced: input.enabled,
          sessionsRevoked: true,
        },
        siteId: scope.rows[0].site_id,
        targetId: input.userId,
        targetType: 'account_authentication_policy',
        tenantId: scope.rows[0].tenant_id,
        traceId: input.traceId,
      });
      return true;
    });
  }

  async updateCustomerTotpPolicy(input: {
    enabled: boolean;
    encryptedSecret?: Uint8Array;
    host: string;
    keyVersion?: number;
    lastUsedCounter?: number;
    now: Date;
    recoveryCodeHashes: string[];
    sessionTokenHash: string;
    traceId: string;
    userId: string;
  }): Promise<boolean> {
    const host = normalizeHost(input.host);
    if (host === this.#orapHostname) return false;
    if (
      input.enabled &&
      (!input.encryptedSecret ||
        !input.keyVersion ||
        input.lastUsedCounter === undefined ||
        input.recoveryCodeHashes.length === 0)
    ) {
      throw new Error('Verified TOTP enrollment material is missing');
    }
    return withAuthTransaction(this.pool, async (client) => {
      const users = await query<{ id: string }>(
        client,
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [input.userId],
      );
      if (users.rows.length !== 1) return false;
      const credentials = await query<{ user_id: string }>(
        client,
        `SELECT user_id FROM credentials WHERE user_id = $1 FOR UPDATE`,
        [input.userId],
      );
      if (credentials.rows.length !== 1) return false;
      const sessions = await query<{ site_id: string; tenant_id: string }>(
        client,
        `SELECT session.tenant_id, session.site_id
           FROM sessions session
           JOIN memberships membership
             ON membership.user_id = session.user_id
            AND membership.tenant_id = session.tenant_id
            AND membership.site_id = session.site_id
            AND membership.active
            AND membership.role IN ('customer_owner','customer_editor','customer_viewer')
           JOIN tenants tenant ON tenant.id = membership.tenant_id AND tenant.status = 'active'
           JOIN sites site ON site.tenant_id = membership.tenant_id
             AND site.id = membership.site_id AND site.status = 'active'
           JOIN domains domain ON domain.tenant_id = membership.tenant_id
             AND domain.site_id = membership.site_id AND domain.kind = 'admin'
             AND domain.active AND domain.verification_status = 'verified'
             AND domain.hostname = $3
          WHERE session.token_hash = $1 AND session.user_id = $2 AND session.host = $3
            AND session.revoked_at IS NULL AND session.expires_at > $4
            AND session.last_seen_at > $4 - interval '30 minutes'
            AND NOT session.recovery_restricted
            AND NOT EXISTS (
              SELECT 1 FROM platform_memberships platform
               WHERE platform.user_id = session.user_id AND platform.active
            )
          FOR UPDATE OF session, membership, tenant, site, domain`,
        [input.sessionTokenHash, input.userId, host, input.now],
      );
      if (sessions.rows.length !== 1 || !sessions.rows[0]) return false;
      const policy = await query<{
        email_code_enabled: boolean;
        user_id: string;
      }>(
        client,
        `SELECT user_id, email_code_enabled FROM account_authentication_policies
          WHERE user_id = $1 FOR UPDATE`,
        [input.userId],
      );
      if (policy.rows.length !== 1 || !policy.rows[0]) return false;
      const factors = await query<{ id: string }>(
        client,
        `SELECT id FROM mfa_factors
          WHERE user_id = $1 AND kind = 'totp' AND revoked_at IS NULL
          FOR UPDATE`,
        [input.userId],
      );
      const webauthn = await query<{ enabled: boolean }>(
        client,
        `SELECT EXISTS (
           SELECT 1 FROM webauthn_scopes scope
           JOIN webauthn_credentials credential
             ON credential.scope_id = scope.id AND credential.revoked_at IS NULL
          WHERE scope.user_id = $1 AND scope.tenant_id = $2
            AND scope.site_id = $3 AND scope.rp_id = $4
         ) AS enabled`,
        [input.userId, sessions.rows[0].tenant_id, sessions.rows[0].site_id, host],
      );
      let factorId: string | undefined;
      if (input.enabled) {
        if (factors.rows.length !== 0) return false;
        const created = await query<{ id: string }>(
          client,
          `INSERT INTO mfa_factors
             (user_id, kind, encrypted_secret, key_version, last_used_counter, verified_at)
           VALUES ($1, 'totp', $2, $3, $4, $5)
           RETURNING id`,
          [input.userId, input.encryptedSecret, input.keyVersion, input.lastUsedCounter, input.now],
        );
        factorId = created.rows[0]?.id;
        if (!factorId) throw new Error('TOTP factor creation failed');
        await client.query(
          `UPDATE account_recovery_codes SET revoked_at = COALESCE(revoked_at, $2)
            WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
          [input.userId, input.now],
        );
        const nextSet = requiredRow(
          await query<{ set_version: number }>(
            client,
            `SELECT COALESCE(max(set_version), 0)::integer + 1 AS set_version
               FROM account_recovery_codes WHERE user_id = $1`,
            [input.userId],
          ),
          'Recovery-code version was not available',
        );
        await client.query(
          `INSERT INTO account_recovery_codes
             (user_id, set_version, code_hash, source_factor_id)
           SELECT $1, $2, unnest($3::text[]), $4`,
          [input.userId, nextSet.set_version, input.recoveryCodeHashes, factorId],
        );
      } else {
        const revoked = await query<{ id: string }>(
          client,
          `UPDATE mfa_factors SET revoked_at = $2
            WHERE user_id = $1 AND kind = 'totp' AND revoked_at IS NULL
            RETURNING id`,
          [input.userId, input.now],
        );
        factorId = revoked.rows[0]?.id;
        if (revoked.rows.length !== 1 || !factorId) return false;
        await client.query(
          `UPDATE account_recovery_codes SET revoked_at = COALESCE(revoked_at, $2)
            WHERE user_id = $1 AND source_factor_id = $3
              AND used_at IS NULL AND revoked_at IS NULL`,
          [input.userId, input.now, factorId],
        );
      }
      const hasWebAuthn = webauthn.rows[0]?.enabled === true;
      const emailEnabled = policy.rows[0].email_code_enabled;
      await client.query(
        `UPDATE account_authentication_policies
            SET second_step_requirement = $2,
                preferred_method = $3,
                updated_at = $4
          WHERE user_id = $1`,
        [
          input.userId,
          input.enabled || emailEnabled || hasWebAuthn ? 'required' : 'optional',
          input.enabled ? 'totp' : hasWebAuthn ? 'webauthn' : emailEnabled ? 'email_code' : null,
          input.now,
        ],
      );
      await client.query(
        `UPDATE sessions SET revoked_at = $2, revoke_reason = 'authentication-policy-changed'
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [input.userId, input.now],
      );
      await insertAudit(client, {
        action: 'auth.totp_policy.changed',
        actorId: input.userId,
        metadata: {
          enabled: input.enabled,
          recoveryCodesReplaced: input.enabled,
          sessionsRevoked: true,
        },
        siteId: sessions.rows[0].site_id,
        targetId: factorId,
        targetType: 'mfa_factor',
        tenantId: sessions.rows[0].tenant_id,
        traceId: input.traceId,
      });
      return true;
    });
  }

  async findSessionOwner(input: {
    host: string;
    tokenHash: string;
  }): Promise<SessionOwner | undefined> {
    const host = normalizeHost(input.host);
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{
        host: string;
        site_id: string | null;
        tenant_id: string | null;
        user_id: string;
      }>(
        client,
        `SELECT s.user_id, s.tenant_id, s.site_id, s.host
           FROM sessions s
          WHERE s.token_hash = $1 AND s.host = $2 AND s.revoked_at IS NULL
            AND s.expires_at > now() AND NOT s.recovery_restricted
            AND s.last_seen_at > now() - interval '30 minutes'
            AND (
              (s.tenant_id IS NULL AND s.site_id IS NULL AND $2 = $3
               AND s.authentication_assurance IN ('baseline', 'strong')
               AND s.verified_at IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM platform_memberships pm
                  WHERE pm.user_id = s.user_id AND pm.active
               ))
              OR ($2 <> $3 AND
                EXISTS (
                  SELECT 1
                    FROM memberships m
                    JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
                    JOIN sites st ON st.tenant_id = m.tenant_id AND st.id = m.site_id
                      AND st.status = 'active'
                    JOIN domains d ON d.tenant_id = m.tenant_id AND d.site_id = m.site_id
                      AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
                   WHERE m.user_id = s.user_id AND m.tenant_id = s.tenant_id
                     AND m.site_id = s.site_id AND m.active AND d.hostname = $2
                )
                AND (
                  NOT EXISTS (
                    SELECT 1 FROM account_authentication_policies policy
                     WHERE policy.user_id = s.user_id
                       AND policy.second_step_requirement = 'required'
                  )
                  OR (s.authentication_assurance IN ('baseline', 'strong')
                      AND s.verified_at IS NOT NULL)
                )
              )
            )
          LIMIT 2`,
        [input.tokenHash, host, this.#orapHostname],
      );
      if (result.rows.length !== 1 || !result.rows[0]) return undefined;
      const row = result.rows[0];
      if (!(await refreshAuthenticatedSession(client, input.tokenHash, host))) return undefined;
      return {
        host: row.host,
        ...(row.site_id ? { siteId: row.site_id } : {}),
        ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
        userId: row.user_id,
      };
    });
  }

  async listSessions(owner: SessionOwner): Promise<SessionRecord[]> {
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{
        authentication_assurance: AuthenticationAssurance;
        authentication_method: SessionAuthenticationMethod;
        created_at: Date;
        expires_at: Date;
        host: string;
        id: string;
        last_seen_at: Date;
      }>(
        client,
        `SELECT id, host, authentication_method, authentication_assurance,
                created_at, last_seen_at, expires_at
           FROM sessions
          WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
            AND last_seen_at > now() - interval '30 minutes'
            AND NOT recovery_restricted
            AND host = $2
            AND tenant_id IS NOT DISTINCT FROM $3::uuid
            AND site_id IS NOT DISTINCT FROM $4::uuid
          ORDER BY last_seen_at DESC`,
        [owner.userId, normalizeHost(owner.host), owner.tenantId ?? null, owner.siteId ?? null],
      );
      return result.rows.map((row) => ({
        assuranceLevel: row.authentication_assurance,
        authenticationMethod: row.authentication_method,
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
    host: string;
    now: Date;
    sessionId: string;
    siteId?: string;
    tenantId?: string;
    traceId: string;
  }): Promise<boolean> {
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{ id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = $1, revoke_reason = 'user-revoked'
          WHERE id = $2 AND user_id = $3 AND host = $4
            AND tenant_id IS NOT DISTINCT FROM $5::uuid
            AND site_id IS NOT DISTINCT FROM $6::uuid
            AND revoked_at IS NULL AND NOT recovery_restricted
          RETURNING id`,
        [
          input.now,
          input.sessionId,
          input.currentUserId,
          normalizeHost(input.host),
          input.tenantId ?? null,
          input.siteId ?? null,
        ],
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
    host: string;
    now: Date;
    tokenHash: string;
    traceId: string;
  }): Promise<void> {
    await withAuthTransaction(this.pool, async (client) => {
      const revoked = await query<{ id: string; user_id: string }>(
        client,
        `UPDATE sessions
            SET revoked_at = $1, revoke_reason = 'logout'
          WHERE token_hash = $2 AND host = $3 AND revoked_at IS NULL
          RETURNING id, user_id`,
        [input.now, input.tokenHash, normalizeHost(input.host)],
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

  async checkRecoveryCode(input: { codeHash: string; userId: string }): Promise<boolean> {
    return withAuthTransaction(this.pool, async (client) => {
      const result = await query<{ id: string }>(
        client,
        `SELECT id FROM account_recovery_codes
          WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL AND revoked_at IS NULL
            AND set_version = (
              SELECT max(newest.set_version)
                FROM account_recovery_codes newest
               WHERE newest.user_id = $1 AND newest.used_at IS NULL
                 AND newest.revoked_at IS NULL
            )
          LIMIT 1`,
        [input.userId, input.codeHash],
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
    encryptedMfaSecret?: Uint8Array;
    keyVersion?: number;
    lastUsedCounter?: number;
    method: 'email_code' | 'totp';
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
        `INSERT INTO account_authentication_policies
           (user_id, second_step_requirement, email_code_enabled, preferred_method)
         VALUES ($1, 'required', $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET second_step_requirement = 'required',
               email_code_enabled = EXCLUDED.email_code_enabled,
               preferred_method = EXCLUDED.preferred_method,
               updated_at = $4`,
        [user.rows[0].id, input.method === 'email_code', input.method, input.now],
      );
      await client.query(
        `INSERT INTO platform_memberships (user_id, role)
         VALUES ($1, 'platform_owner')`,
        [user.rows[0].id],
      );
      if (input.method === 'totp') {
        if (!input.encryptedMfaSecret || !input.keyVersion) {
          throw new Error('Owner TOTP material is missing');
        }
        const factor = await query<{ id: string }>(
          client,
          `INSERT INTO mfa_factors
             (user_id, kind, encrypted_secret, key_version, verified_at, last_used_counter)
           VALUES ($1, 'totp', $2, $3, $4, $5)
           RETURNING id`,
          [
            user.rows[0].id,
            Buffer.from(input.encryptedMfaSecret),
            input.keyVersion,
            input.now,
            input.lastUsedCounter ?? null,
          ],
        );
        if (!factor.rows[0]) throw new Error('Owner MFA creation failed');
      }
      await client.query(
        `INSERT INTO account_recovery_codes (user_id, set_version, code_hash)
         SELECT $1, 1, unnest($2::text[])`,
        [user.rows[0].id, input.recoveryCodeHashes],
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
        metadata: { method: input.method, recoveryCodesConfigured: true },
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

async function refreshAuthenticatedSession(
  client: AuthenticationTransactionClient,
  tokenHash: string,
  host: string,
): Promise<boolean> {
  const refreshed = await query<{ id: string }>(
    client,
    `UPDATE sessions
        SET last_seen_at = now()
      WHERE token_hash = $1 AND host = $2
        AND revoked_at IS NULL AND expires_at > now()
        AND last_seen_at > now() - interval '30 minutes'
        AND NOT recovery_restricted
      RETURNING id`,
    [tokenHash, host],
  );
  return refreshed.rows.length === 1;
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
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
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
      if (!isRetryableTransactionError(error) || attempt === maximumAttempts) throw error;
    } finally {
      client.release();
    }
  }
  throw new Error('Authentication transaction retry limit reached');
}

function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === '40P01' || code === '40001';
}

function parseRole(value: string | undefined): Role | undefined {
  return roles.find((role) => role === value);
}

function isVerificationMethod(value: string | null | undefined): value is VerificationMethod {
  return value === 'email_code' || value === 'totp' || value === 'webauthn';
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
