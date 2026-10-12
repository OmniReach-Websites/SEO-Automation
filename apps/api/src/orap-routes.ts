import {
  assertPlatformOwnerIdentity,
  canOrap,
  type OrapCapabilityKey,
  type OrapResourceTarget,
} from '@omnireach/auth';
import type { AdminActor, CustomerRole } from '@omnireach/tenant';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { clientNetworkIdentifier } from './client-network.ts';
import { OrapResourceNotFoundError } from './orap-errors.ts';
import { assertOrapRoutePolicyRegistry } from './orap-route-policy.ts';
import { requireSameOrigin } from './request-security.ts';

const reason = z.string().trim().min(3).max(500);
const customerRole = z.enum(['customer_owner', 'customer_editor', 'customer_viewer']);

export interface PlanEntitlementsInput {
  aiReviewCyclesPerMonth: number;
  businessLocationLimit: number;
  commercialStatus: 'approved' | 'proposal';
  currency: 'USD';
  customerSeatLimit: number;
  monthlyPriceCents: number;
  pendingInvitationsCountAsSeats: boolean;
  seoAuditIntervalHours: 24 | 168;
  standardPageLimit: number;
}

export interface OrapAdministrationEndpointService {
  acknowledgeAlert?(
    actor: AdminActor,
    input: { alertId: string; reason: string },
  ): Promise<unknown>;
  assignPlan(
    actor: AdminActor,
    input: { planId: string; reason: string; siteId: string; tenantId: string },
  ): Promise<unknown>;
  cancelJob?(actor: AdminActor, input: { jobId: string; reason: string }): Promise<unknown>;
  changeCustomerRole(
    actor: AdminActor,
    input: { membershipId: string; reason: string; role: CustomerRole; siteId: string },
  ): Promise<unknown>;
  createTenantAndSite(
    actor: AdminActor,
    input: { reason: string; siteName: string; sourcePath: string; tenantName: string },
  ): Promise<unknown>;
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
  ): Promise<unknown>;
  disableCustomer(
    actor: AdminActor,
    input: { membershipId: string; reason: string; siteId: string },
  ): Promise<unknown>;
  disableStaff?(actor: AdminActor, input: { reason: string; userId: string }): Promise<unknown>;
  changeStaffRole?(
    actor: AdminActor,
    input: { reason: string; roleSlug: string; userId: string },
  ): Promise<unknown>;
  inviteStaff?(
    actor: AdminActor,
    input: {
      displayName: string;
      email: string;
      host: string;
      jobTitle?: string;
      reason: string;
      roleSlug: string;
    },
  ): Promise<unknown>;
  inviteCustomer(
    actor: AdminActor,
    input: {
      email: string;
      reason: string;
      role: CustomerRole;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown>;
  listCustomerSessions?(
    actor: AdminActor,
    input: { siteId: string; tenantId: string; userId: string },
  ): Promise<unknown>;
  listSites(actor: AdminActor): Promise<unknown>;
  listOperations?(actor: AdminActor): Promise<unknown>;
  listStaff?(actor: AdminActor): Promise<unknown>;
  listStaffRoles?(actor: AdminActor): Promise<unknown>;
  requestCustomerReset(
    actor: AdminActor,
    input: { networkIdentifier: string; reason: string; siteId: string; userId: string },
  ): Promise<unknown>;
  requestStaffReset?(
    actor: AdminActor,
    input: { host: string; networkIdentifier: string; reason: string; userId: string },
  ): Promise<unknown>;
  revokeAllCustomerSessions?(
    actor: AdminActor,
    input: { reason: string; siteId: string; tenantId: string; userId: string },
  ): Promise<unknown>;
  revokeCustomerSession?(
    actor: AdminActor,
    input: {
      reason: string;
      sessionId: string;
      siteId: string;
      tenantId: string;
      userId: string;
    },
  ): Promise<unknown>;
  revokeStaffSessions?(
    actor: AdminActor,
    input: { reason: string; userId: string },
  ): Promise<unknown>;
  replayJob?(actor: AdminActor, input: { jobId: string; reason: string }): Promise<unknown>;
  resolveAlert?(actor: AdminActor, input: { alertId: string; reason: string }): Promise<unknown>;
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
  ): Promise<unknown>;
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
  ): Promise<unknown>;
  setContactSubmissionHold(
    actor: AdminActor,
    input: {
      hold: boolean;
      reason: string;
      siteId: string;
      submissionId: string;
      tenantId: string;
    },
  ): Promise<unknown>;
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
  ): Promise<unknown>;
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
  ): Promise<unknown>;
  setPlatformAiBudget(
    actor: AdminActor,
    input: { capUsdMicros: number; policyVersion: number; reason: string },
  ): Promise<unknown>;
  setSiteAiBudget(
    actor: AdminActor,
    input: {
      capUsdMicros: number;
      policyVersion: number;
      reason: string;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown>;
  setSubscriptionState(
    actor: AdminActor,
    input: {
      graceEndsAt?: Date;
      reason: string;
      siteId: string;
      status: 'active' | 'cancelled' | 'past_due';
      tenantId: string;
    },
  ): Promise<unknown>;
}

export type ResolvePlatformActor = (request: FastifyRequest) => Promise<AdminActor | undefined>;

export function registerOrapRoutes(
  server: FastifyInstance,
  service: OrapAdministrationEndpointService,
  resolveActor: ResolvePlatformActor,
): void {
  assertOrapRoutePolicyRegistry();
  server.get('/v1/orap/operations', async (request, reply) => {
    const actor = await authorizedActor(request, reply, resolveActor);
    if (!actor) return;
    if (!authorizedCapability(actor, 'dashboard.view', {}, reply)) return;
    if (!service.listOperations) return reply.code(501).send({ error: 'not_available' });
    return service.listOperations(actor);
  });

  server.get('/v1/orap/staff', async (request, reply) => {
    const actor = await authorizedActor(request, reply, resolveActor);
    if (!actor) return;
    try {
      assertPlatformOwnerIdentity(actor);
    } catch {
      return reply.code(403).send({ error: 'orap_owner_identity_required' });
    }
    if (!service.listStaff) return reply.code(501).send({ error: 'not_available' });
    return service.listStaff(actor);
  });

  server.get('/v1/orap/staff/roles', async (request, reply) => {
    const actor = await authorizedActor(request, reply, resolveActor);
    if (!actor) return;
    if (!authorizedOwner(actor, reply)) return;
    if (!service.listStaffRoles) return reply.code(501).send({ error: 'not_available' });
    return service.listStaffRoles(actor);
  });

  server.post(
    '/v1/orap/staff/invitations',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      if (!authorizedOwner(actor, reply)) return;
      if (!service.inviteStaff) return reply.code(501).send({ error: 'not_available' });
      const body = parse(
        z.object({
          displayName: z.string().trim().min(1).max(160),
          email: z.string().trim().email().max(320),
          jobTitle: z.string().trim().max(160).optional(),
          reason,
          roleSlug: z.string().regex(/^[a-z0-9-]{1,100}$/u),
        }),
        request.body,
        reply,
      );
      if (!body) return;
      return reply.code(201).send(
        await service.inviteStaff(actor, {
          displayName: body.displayName,
          email: body.email,
          host: request.hostname,
          ...(body.jobTitle ? { jobTitle: body.jobTitle } : {}),
          reason: body.reason,
          roleSlug: body.roleSlug,
        }),
      );
    },
  );

  server.post(
    '/v1/orap/staff/:userId/role',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      if (!authorizedOwner(actor, reply)) return;
      if (!service.changeStaffRole) return reply.code(501).send({ error: 'not_available' });
      const params = parse(z.object({ userId: z.string().uuid() }), request.params, reply);
      const body = parse(
        z.object({ reason, roleSlug: z.string().regex(/^[a-z0-9-]{1,100}$/u) }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      return service.changeStaffRole(actor, { ...body, ...params });
    },
  );

  server.post(
    '/v1/orap/staff/:userId/disable',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ userId: z.string().uuid() }), request.params, reply);
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedOwner(actor, reply)) return;
      if (!service.disableStaff) return reply.code(501).send({ error: 'not_available' });
      return service.disableStaff(actor, { ...body, ...params });
    },
  );

  server.post(
    '/v1/orap/staff/:userId/sessions/revoke-all',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ userId: z.string().uuid() }), request.params, reply);
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedOwner(actor, reply)) return;
      if (!service.revokeStaffSessions) return reply.code(501).send({ error: 'not_available' });
      return service.revokeStaffSessions(actor, { ...body, ...params });
    },
  );

  server.post(
    '/v1/orap/staff/:userId/reset',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ userId: z.string().uuid() }), request.params, reply);
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedOwner(actor, reply)) return;
      if (!service.requestStaffReset) return reply.code(501).send({ error: 'not_available' });
      return reply.code(202).send(
        await service.requestStaffReset(actor, {
          ...body,
          ...params,
          host: request.hostname,
          networkIdentifier: clientNetworkIdentifier(request.ip),
        }),
      );
    },
  );

  server.post(
    '/v1/orap/alerts/:alertId/acknowledge',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      if (!service.acknowledgeAlert) return reply.code(501).send({ error: 'not_available' });
      const params = parse(z.object({ alertId: z.string().uuid() }), request.params, reply);
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'alerts.acknowledge', {}, reply)) return;
      return service.acknowledgeAlert(actor, { ...params, ...body });
    },
  );

  server.post(
    '/v1/orap/jobs/:jobId/cancel',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      if (!service.cancelJob) return reply.code(501).send({ error: 'not_available' });
      const params = parse(z.object({ jobId: z.string().uuid() }), request.params, reply);
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'automation.jobs.cancel', {}, reply)) return;
      return service.cancelJob(actor, { ...params, ...body });
    },
  );

  server.post(
    '/v1/orap/jobs/:jobId/replay',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      if (!service.replayJob) return reply.code(501).send({ error: 'not_available' });
      const params = parse(z.object({ jobId: z.string().uuid() }), request.params, reply);
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'automation.jobs.replay', {}, reply)) return;
      return reply.code(202).send(await service.replayJob(actor, { ...params, ...body }));
    },
  );

  server.post(
    '/v1/orap/alerts/:alertId/resolve',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      if (!service.resolveAlert) return reply.code(501).send({ error: 'not_available' });
      const params = parse(z.object({ alertId: z.string().uuid() }), request.params, reply);
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'alerts.resolve', {}, reply)) return;
      return service.resolveAlert(actor, { ...params, ...body });
    },
  );

  server.post('/v1/orap/plans', { preHandler: requireSameOrigin }, async (request, reply) => {
    const actor = await authorizedActor(request, reply, resolveActor);
    if (!actor) return;
    const input = parse(
      z.object({
        code: z
          .string()
          .trim()
          .regex(/^(?:STARTER|GROWTH|PRO|ELITE|[a-z][a-z0-9-]{1,79})$/u),
        entitlements: z.object({
          aiReviewCyclesPerMonth: z.number().int().nonnegative(),
          businessLocationLimit: z.number().int().positive(),
          commercialStatus: z.enum(['proposal', 'approved']),
          currency: z.literal('USD'),
          customerSeatLimit: z.number().int().positive(),
          monthlyPriceCents: z.number().int().nonnegative(),
          pendingInvitationsCountAsSeats: z.boolean(),
          seoAuditIntervalHours: z.union([z.literal(24), z.literal(168)]),
          standardPageLimit: z.number().int().positive(),
        }),
        features: z
          .array(
            z.object({
              enabled: z.boolean(),
              key: z.string().trim().min(1).max(120),
              version: z.number().int().positive(),
            }),
          )
          .max(100),
        name: z.string().trim().min(1).max(160),
        reason,
        version: z.number().int().positive(),
      }),
      request.body,
      reply,
    );
    if (!input) return;
    if (!authorizedCapability(actor, 'plans.edit', {}, reply)) return;
    return reply.code(201).send(await service.createPlan(actor, input));
  });

  server.get('/v1/orap/sites', async (request, reply) => {
    const actor = await authorizedActor(request, reply, resolveActor);
    if (!actor) return;
    if (!authorizedCapability(actor, 'websites.list', {}, reply)) return;
    return service.listSites(actor);
  });

  server.post('/v1/orap/sites', { preHandler: requireSameOrigin }, async (request, reply) => {
    const actor = await authorizedActor(request, reply, resolveActor);
    if (!actor) return;
    const input = parse(
      z.object({
        reason,
        siteName: z.string().trim().min(1),
        sourcePath: z
          .string()
          .trim()
          .regex(/^sites\/[a-z0-9_-]+$/u)
          .max(300),
        tenantName: z.string().trim().min(1),
      }),
      request.body,
      reply,
    );
    if (!input) return;
    if (!authorizedCapability(actor, 'customers.create', {}, reply)) return;
    if (!authorizedCapability(actor, 'websites.create', {}, reply)) return;
    return reply.code(201).send(await service.createTenantAndSite(actor, input));
  });

  server.post(
    '/v1/orap/sites/:siteId/invitations',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ siteId: z.string().min(1) }), request.params, reply);
      const body = parse(
        z.object({
          email: z.string().email(),
          reason,
          role: customerRole,
          tenantId: z.string().min(1),
        }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'customers.users.manage', { ...params, ...body }, reply)) {
        return;
      }
      const result = await service.inviteCustomer(actor, { ...body, siteId: params.siteId });
      return reply.code(202).send(result);
    },
  );

  server.patch(
    '/v1/orap/sites/:siteId/memberships/:membershipId',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(
        z.object({ membershipId: z.string().min(1), siteId: z.string().min(1) }),
        request.params,
        reply,
      );
      const body = parse(z.object({ reason, role: customerRole }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'customers.users.manage', params, reply)) return;
      return service.changeCustomerRole(actor, { ...params, ...body });
    },
  );

  server.post(
    '/v1/orap/sites/:siteId/memberships/:membershipId/disable',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(
        z.object({ membershipId: z.string().min(1), siteId: z.string().min(1) }),
        request.params,
        reply,
      );
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'customers.users.manage', params, reply)) return;
      return service.disableCustomer(actor, { ...params, ...body });
    },
  );

  server.post(
    '/v1/orap/sites/:siteId/users/:userId/reset',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(
        z.object({ siteId: z.string().min(1), userId: z.string().min(1) }),
        request.params,
        reply,
      );
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'security.customer_access.manage', params, reply)) return;
      return reply.code(202).send(
        await service.requestCustomerReset(actor, {
          ...params,
          ...body,
          networkIdentifier: clientNetworkIdentifier(request.ip),
        }),
      );
    },
  );

  server.get(
    '/v1/orap/tenants/:tenantId/sites/:siteId/users/:userId/sessions',
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      if (!service.listCustomerSessions) {
        return reply.code(501).send({ error: 'not_available' });
      }
      const params = parse(
        z.object({
          siteId: z.string().uuid(),
          tenantId: z.string().uuid(),
          userId: z.string().uuid(),
        }),
        request.params,
        reply,
      );
      if (!params) return;
      if (!authorizedCapability(actor, 'security.sessions.view', params, reply)) return;
      return respondToOrapOperation(reply, service.listCustomerSessions(actor, params));
    },
  );

  server.post(
    '/v1/orap/tenants/:tenantId/sites/:siteId/users/:userId/sessions/:sessionId/revoke',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      if (!service.revokeCustomerSession) {
        return reply.code(501).send({ error: 'not_available' });
      }
      const params = parse(
        z.object({
          sessionId: z.string().uuid(),
          siteId: z.string().uuid(),
          tenantId: z.string().uuid(),
          userId: z.string().uuid(),
        }),
        request.params,
        reply,
      );
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'security.sessions.revoke', params, reply)) return;
      return respondToOrapOperation(
        reply,
        service.revokeCustomerSession(actor, { ...params, ...body }),
      );
    },
  );

  server.post(
    '/v1/orap/tenants/:tenantId/sites/:siteId/users/:userId/sessions/revoke-all',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      if (!service.revokeAllCustomerSessions) {
        return reply.code(501).send({ error: 'not_available' });
      }
      const params = parse(
        z.object({
          siteId: z.string().uuid(),
          tenantId: z.string().uuid(),
          userId: z.string().uuid(),
        }),
        request.params,
        reply,
      );
      const body = parse(z.object({ reason }), request.body, reply);
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'security.sessions.revoke', params, reply)) return;
      return respondToOrapOperation(
        reply,
        service.revokeAllCustomerSessions(actor, { ...params, ...body }),
      );
    },
  );

  server.put(
    '/v1/orap/sites/:siteId/plan',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ siteId: z.string().uuid() }), request.params, reply);
      const body = parse(
        z.object({ planId: z.string().uuid(), reason, tenantId: z.string().uuid() }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'subscriptions.edit', { ...params, ...body }, reply)) return;
      return service.assignPlan(actor, { ...params, ...body });
    },
  );

  server.put(
    '/v1/orap/sites/:siteId/features/:featureKey',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(
        z.object({ featureKey: z.string().trim().min(1).max(120), siteId: z.string().min(1) }),
        request.params,
        reply,
      );
      const body = parse(
        z.object({
          cancelQueuedWork: z.boolean(),
          enabled: z.boolean(),
          policyVersion: z.number().int().positive(),
          reason,
          tenantId: z.string().min(1),
        }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'entitlements.override', { ...params, ...body }, reply)) {
        return;
      }
      return service.setFeatureOverride(actor, { ...params, ...body });
    },
  );

  server.put(
    '/v1/orap/sites/:siteId/emergency-controls',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ siteId: z.string().min(1) }), request.params, reply);
      const body = parse(
        z.object({
          autonomousChangesStopped: z.boolean(),
          automationStopped: z.boolean(),
          editingFrozen: z.boolean(),
          policyVersion: z.number().int().positive(),
          reason,
          tenantId: z.string().min(1),
        }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (
        !authorizedCapability(
          actor,
          'automation.emergency_controls.manage',
          { ...params, ...body },
          reply,
        )
      ) {
        return;
      }
      return service.setEmergencyControls(actor, { ...params, ...body });
    },
  );

  server.put(
    '/v1/orap/sites/:siteId/contact-forms/:formId',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(
        z.object({ formId: z.string().trim().min(1).max(100), siteId: z.string().uuid() }),
        request.params,
        reply,
      );
      const body = parse(
        z.object({
          confirmationEnabled: z.boolean().default(false),
          enabled: z.boolean(),
          fieldIds: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
          policyVersion: z.number().int().positive(),
          reason,
          recipientEmail: z.string().email().max(320),
          recipientVerified: z.boolean(),
          retentionDays: z.number().int().min(1).max(365).default(30),
          tenantId: z.string().uuid(),
        }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'contact_forms.manage', { ...params, ...body }, reply)) {
        return;
      }
      return service.setContactForm(actor, { ...params, ...body });
    },
  );

  server.put(
    '/v1/orap/sites/:siteId/contact-submissions/:submissionId/hold',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(
        z.object({ siteId: z.string().uuid(), submissionId: z.string().uuid() }),
        request.params,
        reply,
      );
      const body = parse(
        z.object({ hold: z.boolean(), reason, tenantId: z.string().uuid() }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (
        !authorizedCapability(
          actor,
          'contact_forms.submissions.hold',
          { ...params, ...body },
          reply,
        )
      ) {
        return;
      }
      return service.setContactSubmissionHold(actor, { ...params, ...body });
    },
  );

  server.put(
    '/v1/orap/sites/:siteId/quota-overrides/:quotaKey',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(
        z.object({
          quotaKey: z.literal('ai_review_cycles_per_month'),
          siteId: z.string().uuid(),
        }),
        request.params,
        reply,
      );
      const body = parse(
        z.object({
          policyVersion: z.number().int().positive(),
          quotaLimit: z.number().int().nonnegative(),
          reason,
          tenantId: z.string().uuid(),
        }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'entitlements.override', { ...params, ...body }, reply)) {
        return;
      }
      return service.setQuotaOverride(actor, { ...params, ...body });
    },
  );

  server.put(
    '/v1/orap/sites/:siteId/subscription',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ siteId: z.string().min(1) }), request.params, reply);
      const body = parse(
        z.object({
          graceEndsAt: z.string().datetime().optional(),
          reason,
          status: z.enum(['active', 'cancelled', 'past_due']),
          tenantId: z.string().min(1),
        }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'subscriptions.edit', { ...params, ...body }, reply)) return;
      const { graceEndsAt, ...subscription } = body;
      return service.setSubscriptionState(actor, {
        ...params,
        ...subscription,
        ...(graceEndsAt ? { graceEndsAt: new Date(graceEndsAt) } : {}),
      });
    },
  );

  server.put(
    '/v1/orap/sites/:siteId/ai-budget',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ siteId: z.string().uuid() }), request.params, reply);
      const body = parse(
        z.object({
          capUsdMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          policyVersion: z.number().int().positive(),
          reason,
          tenantId: z.string().uuid(),
        }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (!authorizedCapability(actor, 'ai_budget.site.edit', { ...params, ...body }, reply)) {
        return;
      }
      return service.setSiteAiBudget(actor, { ...params, ...body });
    },
  );

  server.put(
    '/v1/orap/platform/ai-budget',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorizedActor(request, reply, resolveActor);
      if (!actor) return;
      const body = parse(
        z.object({
          capUsdMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          policyVersion: z.number().int().positive(),
          reason,
        }),
        request.body,
        reply,
      );
      if (!body) return;
      if (!authorizedCapability(actor, 'ai_budget.platform.edit', {}, reply)) return;
      return service.setPlatformAiBudget(actor, body);
    },
  );
}

async function authorizedActor(
  request: FastifyRequest,
  reply: FastifyReply,
  resolveActor: ResolvePlatformActor,
): Promise<AdminActor | undefined> {
  const actor = await resolveActor(request);
  if (!actor || !['platform_owner', 'platform_admin', 'staff'].includes(actor.role)) {
    await reply.code(403).send({ error: 'forbidden' });
    return undefined;
  }
  return actor;
}

function authorizedCapability(
  actor: AdminActor,
  capabilityKey: OrapCapabilityKey,
  target: OrapResourceTarget,
  reply: FastifyReply,
): boolean {
  if (canOrap(actor, capabilityKey, target)) return true;
  void reply.code(403).send({ error: 'orap_authorization_denied' });
  return false;
}

function authorizedOwner(actor: AdminActor, reply: FastifyReply): boolean {
  try {
    assertPlatformOwnerIdentity(actor);
    return true;
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'orap_owner_identity_required';
    void reply.code(403).send({ error: code });
    return false;
  }
}

async function respondToOrapOperation(
  reply: FastifyReply,
  operation: Promise<unknown>,
): Promise<unknown> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof OrapResourceNotFoundError) {
      return reply.code(404).send({ error: 'not_found' });
    }
    throw error;
  }
}

function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  reply: { code(status: number): { send(body: unknown): unknown } },
): T | undefined {
  const result = schema.safeParse(value);
  if (!result.success) {
    reply.code(400).send({ error: 'invalid_request' });
    return undefined;
  }
  return result.data;
}
