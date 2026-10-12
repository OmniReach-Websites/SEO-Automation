import { platformRoles, type Role } from '@omnireach/auth';

export type CustomerRole = Extract<Role, 'customer_owner' | 'customer_editor' | 'customer_viewer'>;

export interface AdminActor {
  id: string;
  role: Role;
  traceId: string;
}
export interface AdminAuditEvent {
  action: string;
  actorId: string;
  after: unknown;
  before: unknown;
  reason: string;
  targetId: string;
  traceId: string;
}
export interface AdminMutationStore {
  transaction<T>(
    operation: (commands: {
      audit(event: AdminAuditEvent): Promise<void>;
      createSite(input: {
        name: string;
        tenantId: string;
      }): Promise<{ id: string; name: string; status: 'active'; tenantId: string }>;
      createTenant(input: {
        name: string;
      }): Promise<{ id: string; name: string; status: 'active' }>;
      disableSite(
        siteId: string,
      ): Promise<{ id: string; name: string; status: 'disabled'; tenantId: string }>;
    }) => Promise<T>,
  ): Promise<T>;
}

export interface CustomerAccessMutationStore {
  transaction<T>(
    operation: (commands: {
      audit(event: AdminAuditEvent): Promise<void>;
      changeMembershipRole(input: {
        membershipId: string;
        role: CustomerRole;
        siteId: string;
      }): Promise<{ before: CustomerMembership; after: CustomerMembership }>;
      createInvitation(input: {
        email: string;
        role: CustomerRole;
        siteId: string;
        tenantId: string;
      }): Promise<{ id: string; membership: CustomerMembership }>;
      disableMembership(input: {
        membershipId: string;
        siteId: string;
      }): Promise<{ before: CustomerMembership; after: CustomerMembership }>;
      initiatePasswordReset(userId: string): Promise<{ requestId: string }>;
      revokeUserSiteSessions(input: { siteId: string; userId: string }): Promise<number>;
    }) => Promise<T>,
  ): Promise<T>;
}

export interface CustomerMembership {
  active: boolean;
  id: string;
  role: CustomerRole;
  siteId: string;
  tenantId: string;
  userId: string;
}

export class TenantAdministrationService {
  constructor(private readonly store: AdminMutationStore) {}

  async createTenantAndSite(
    actor: AdminActor,
    input: { reason: string; siteName: string; tenantName: string },
  ) {
    authorize(actor, input.reason);
    return this.store.transaction(async (commands) => {
      const tenant = await commands.createTenant({ name: input.tenantName.trim() });
      const site = await commands.createSite({ name: input.siteName.trim(), tenantId: tenant.id });
      await commands.audit({
        action: 'site.created',
        actorId: actor.id,
        after: { site, tenant },
        before: null,
        reason: input.reason.trim(),
        targetId: site.id,
        traceId: actor.traceId,
      });
      return { site, tenant };
    });
  }

  async disableSite(actor: AdminActor, siteId: string, reason: string) {
    authorize(actor, reason);
    return this.store.transaction(async (commands) => {
      const site = await commands.disableSite(siteId);
      await commands.audit({
        action: 'site.disabled',
        actorId: actor.id,
        after: site,
        before: { status: 'active' },
        reason: reason.trim(),
        targetId: site.id,
        traceId: actor.traceId,
      });
      return site;
    });
  }
}

export class CustomerAccessAdministrationService {
  constructor(private readonly store: CustomerAccessMutationStore) {}

  async invite(
    actor: AdminActor,
    input: {
      email: string;
      reason: string;
      role: CustomerRole;
      siteId: string;
      tenantId: string;
    },
  ) {
    authorize(actor, input.reason);
    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes('@')) throw new Error('A valid customer email is required');
    return this.store.transaction(async (commands) => {
      const invitation = await commands.createInvitation({
        email,
        role: input.role,
        siteId: input.siteId,
        tenantId: input.tenantId,
      });
      await commands.audit({
        action: 'customer.invited',
        actorId: actor.id,
        after: { invitationId: invitation.id, membership: invitation.membership },
        before: null,
        reason: input.reason.trim(),
        targetId: invitation.membership.id,
        traceId: actor.traceId,
      });
      return invitation;
    });
  }

  async changeRole(
    actor: AdminActor,
    input: { membershipId: string; reason: string; role: CustomerRole; siteId: string },
  ) {
    authorize(actor, input.reason);
    return this.store.transaction(async (commands) => {
      const result = await commands.changeMembershipRole(input);
      assertSameSite(input.siteId, result.before, result.after);
      const revokedSessions = await commands.revokeUserSiteSessions({
        siteId: input.siteId,
        userId: result.after.userId,
      });
      await commands.audit({
        action: 'membership.role_changed',
        actorId: actor.id,
        after: { membership: result.after, revokedSessions },
        before: result.before,
        reason: input.reason.trim(),
        targetId: input.membershipId,
        traceId: actor.traceId,
      });
      return { membership: result.after, revokedSessions };
    });
  }

  async disable(
    actor: AdminActor,
    input: { membershipId: string; reason: string; siteId: string },
  ) {
    authorize(actor, input.reason);
    return this.store.transaction(async (commands) => {
      const result = await commands.disableMembership(input);
      assertSameSite(input.siteId, result.before, result.after);
      const revokedSessions = await commands.revokeUserSiteSessions({
        siteId: input.siteId,
        userId: result.after.userId,
      });
      await commands.audit({
        action: 'membership.disabled',
        actorId: actor.id,
        after: { membership: result.after, revokedSessions },
        before: result.before,
        reason: input.reason.trim(),
        targetId: input.membershipId,
        traceId: actor.traceId,
      });
      return { membership: result.after, revokedSessions };
    });
  }

  async initiateReset(
    actor: AdminActor,
    input: { reason: string; siteId: string; userId: string },
  ) {
    authorize(actor, input.reason);
    return this.store.transaction(async (commands) => {
      const reset = await commands.initiatePasswordReset(input.userId);
      await commands.audit({
        action: 'customer.password_reset_requested',
        actorId: actor.id,
        after: { requestId: reset.requestId, siteId: input.siteId, userId: input.userId },
        before: null,
        reason: input.reason.trim(),
        targetId: input.userId,
        traceId: actor.traceId,
      });
      return reset;
    });
  }
}

function authorize(actor: AdminActor, reason: string): void {
  if (!platformRoles.has(actor.role)) throw new Error('Platform staff authorization required');
  if (!reason.trim()) throw new Error('Administrative mutations require a reason');
}

function assertSameSite(
  expectedSiteId: string,
  before: CustomerMembership,
  after: CustomerMembership,
): void {
  if (before.siteId !== expectedSiteId || after.siteId !== expectedSiteId) {
    throw new Error('Membership site scope mismatch');
  }
  if (before.tenantId !== after.tenantId || before.userId !== after.userId) {
    throw new Error('Membership identity cannot be reassigned');
  }
}
