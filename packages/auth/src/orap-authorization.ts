import {
  getOrapCapability,
  type OrapCapabilityKey,
  type OrapCapabilityScope,
} from './orap-capabilities.ts';
import type { Role } from './roles.ts';

export interface OrapAssignmentGrant {
  readonly assignmentId: string;
  readonly permissionKeys: readonly string[];
  readonly portfolio: boolean;
  readonly siteIds: readonly string[];
  readonly tenantIds: readonly string[];
}

export interface OrapAuthorizationState {
  readonly grants: readonly OrapAssignmentGrant[];
  readonly membershipId: string;
  readonly version: number;
}

export interface OrapAuthorizationActor {
  readonly authenticationAssurance?: string;
  readonly authorization?: OrapAuthorizationState;
  readonly role: Role;
  readonly verifiedAt?: Date;
}

export interface OrapResourceTarget {
  readonly siteId?: string;
  readonly tenantId?: string;
}

export interface OrapVisibleScope {
  readonly portfolio: boolean;
  readonly siteIds: ReadonlySet<string>;
  readonly tenantIds: ReadonlySet<string>;
}

export function isPlatformOwnerIdentity(actor: OrapAuthorizationActor): boolean {
  return actor.role === 'platform_owner';
}

export function canOrap(
  actor: OrapAuthorizationActor,
  capabilityKey: OrapCapabilityKey,
  target: OrapResourceTarget = {},
): boolean {
  const definition = getOrapCapability(capabilityKey);
  if (!definition) return false;
  if (isPlatformOwnerIdentity(actor)) return true;
  if (definition.ownerOnly || !actor.authorization) return false;
  return actor.authorization.grants.some(
    (grant) =>
      grant.permissionKeys.includes(capabilityKey) && grantAllows(grant, definition.scope, target),
  );
}

export function orapVisibleScope(
  actor: OrapAuthorizationActor,
  capabilityKey: OrapCapabilityKey,
): OrapVisibleScope {
  if (isPlatformOwnerIdentity(actor)) {
    return { portfolio: true, siteIds: new Set(), tenantIds: new Set() };
  }
  const definition = getOrapCapability(capabilityKey);
  if (!definition || definition.ownerOnly || !actor.authorization) {
    return { portfolio: false, siteIds: new Set(), tenantIds: new Set() };
  }
  const relevant = actor.authorization.grants.filter(({ permissionKeys }) =>
    permissionKeys.includes(capabilityKey),
  );
  return {
    portfolio: relevant.some(({ portfolio }) => portfolio),
    siteIds: new Set(relevant.flatMap(({ siteIds }) => siteIds)),
    tenantIds: new Set(relevant.flatMap(({ tenantIds }) => tenantIds)),
  };
}

export function assertOrapCapability(
  actor: OrapAuthorizationActor,
  capabilityKey: OrapCapabilityKey,
  target: OrapResourceTarget = {},
): void {
  if (!canOrap(actor, capabilityKey, target)) {
    throw new OrapAuthorizationDeniedError(capabilityKey);
  }
}

export function assertPlatformOwnerIdentity(actor: OrapAuthorizationActor): void {
  if (!isPlatformOwnerIdentity(actor)) throw new OrapOwnerIdentityRequiredError();
}

export function assertRecentStrongOrapStepUp(
  actor: OrapAuthorizationActor,
  now = new Date(),
  maximumAgeMs = 10 * 60_000,
): void {
  const verifiedAt = actor.verifiedAt;
  if (
    actor.authenticationAssurance !== 'strong' ||
    !verifiedAt ||
    now.getTime() - verifiedAt.getTime() < 0 ||
    now.getTime() - verifiedAt.getTime() > maximumAgeMs
  ) {
    throw new OrapStrongStepUpRequiredError();
  }
}

export class OrapAuthorizationDeniedError extends Error {
  readonly code = 'orap_authorization_denied';

  constructor(readonly capabilityKey: string) {
    super('The current ORAP account is not authorized for this action');
    this.name = 'OrapAuthorizationDeniedError';
  }
}

export class OrapOwnerIdentityRequiredError extends Error {
  readonly code = 'orap_owner_identity_required';

  constructor() {
    super('A current verified Platform Owner identity is required');
    this.name = 'OrapOwnerIdentityRequiredError';
  }
}

export class OrapStrongStepUpRequiredError extends Error {
  readonly code = 'orap_strong_step_up_required';

  constructor() {
    super('Recent authenticator or passkey verification is required for this owner action');
    this.name = 'OrapStrongStepUpRequiredError';
  }
}

function grantAllows(
  grant: OrapAssignmentGrant,
  capabilityScope: OrapCapabilityScope,
  target: OrapResourceTarget,
): boolean {
  if (capabilityScope === 'platform') return grant.portfolio;
  const hasTarget = target.siteId !== undefined || target.tenantId !== undefined;
  if (!hasTarget) {
    return grant.portfolio || grant.siteIds.length > 0 || grant.tenantIds.length > 0;
  }
  if (grant.portfolio) return true;
  if (target.siteId && grant.siteIds.includes(target.siteId)) return true;
  if (target.tenantId && grant.tenantIds.includes(target.tenantId)) return true;
  return false;
}
