export type FeatureKey = string;

export interface PolicyInputs {
  customerPreferences?: ReadonlyMap<FeatureKey, boolean>;
  killSwitches: ReadonlySet<FeatureKey>;
  nonOverrideableDenied: ReadonlySet<FeatureKey>;
  planDefaults: ReadonlyMap<FeatureKey, boolean>;
  safeDefaults: ReadonlyMap<FeatureKey, boolean>;
  siteOverrides: ReadonlyMap<FeatureKey, boolean>;
}

export interface EffectiveFeature {
  enabled: boolean;
  source:
    | 'system-rule'
    | 'kill-switch'
    | 'site-override'
    | 'plan-default'
    | 'customer-preference'
    | 'safe-default';
}

export function resolveFeature(key: FeatureKey, input: PolicyInputs): EffectiveFeature {
  if (input.nonOverrideableDenied.has(key)) return { enabled: false, source: 'system-rule' };
  if (input.killSwitches.has(key)) return { enabled: false, source: 'kill-switch' };
  if (input.siteOverrides.has(key))
    return { enabled: input.siteOverrides.get(key) ?? false, source: 'site-override' };
  if (input.planDefaults.has(key))
    return { enabled: input.planDefaults.get(key) ?? false, source: 'plan-default' };
  if (input.customerPreferences?.has(key)) {
    return { enabled: input.customerPreferences.get(key) ?? false, source: 'customer-preference' };
  }
  return { enabled: input.safeDefaults.get(key) ?? false, source: 'safe-default' };
}

export interface SubscriptionEffects {
  automationAllowed: boolean;
  editingAllowed: boolean;
  publicServingAllowed: true;
  state: 'active' | 'grace' | 'suspended';
}

export function subscriptionEffects(input: {
  graceEndsAt?: Date;
  now: Date;
  status: 'active' | 'past_due' | 'cancelled';
}): SubscriptionEffects {
  if (input.status === 'active') {
    return {
      automationAllowed: true,
      editingAllowed: true,
      publicServingAllowed: true,
      state: 'active',
    };
  }
  if (input.graceEndsAt && input.now <= input.graceEndsAt) {
    return {
      automationAllowed: true,
      editingAllowed: true,
      publicServingAllowed: true,
      state: 'grace',
    };
  }
  return {
    automationAllowed: false,
    editingAllowed: false,
    publicServingAllowed: true,
    state: 'suspended',
  };
}

export interface SitePolicyActor {
  id: string;
  role: 'platform_admin' | 'platform_owner' | 'staff';
  traceId: string;
}

export interface PolicyAuditEvent {
  action: string;
  actorId: string;
  after: unknown;
  before: unknown;
  reason: string;
  siteId: string;
  traceId: string;
}

export interface SitePolicyAdministrationStore {
  transaction<T>(operation: (commands: SitePolicyCommands) => Promise<T>): Promise<T>;
}

export interface SitePolicyCommands {
  audit(event: PolicyAuditEvent): Promise<void>;
  setEmergencyControls(input: EmergencyControlChange): Promise<{ before: unknown; after: unknown }>;
  setFeatureOverride(input: FeatureOverrideChange): Promise<{ before: unknown; after: unknown }>;
  setSubscriptionState(
    input: SubscriptionStateChange,
  ): Promise<{ before: unknown; after: unknown }>;
}

export interface FeatureOverrideChange {
  cancelQueuedWork: boolean;
  enabled: boolean;
  featureKey: string;
  policyVersion: number;
  reason: string;
  siteId: string;
  tenantId: string;
}

export interface EmergencyControlChange {
  autonomousChangesStopped: boolean;
  automationStopped: boolean;
  editingFrozen: boolean;
  policyVersion: number;
  reason: string;
  siteId: string;
  tenantId: string;
}

export interface SubscriptionStateChange {
  graceEndsAt?: Date;
  reason: string;
  siteId: string;
  status: 'active' | 'cancelled' | 'past_due';
  tenantId: string;
}

export class SitePolicyAdministrationService {
  constructor(private readonly store: SitePolicyAdministrationStore) {}

  async setFeatureOverride(
    actor: SitePolicyActor,
    input: FeatureOverrideChange & { overrideable: boolean },
  ): Promise<unknown> {
    assertPolicyMutation(actor, input.reason);
    if (!input.overrideable || input.featureKey === 'content.ai.protected-facts') {
      throw new Error('Feature is protected by a nonoverrideable system rule');
    }
    return this.mutate(
      actor,
      'site.feature_override_changed',
      input.siteId,
      input.reason,
      (commands) => commands.setFeatureOverride(input),
    );
  }

  async setEmergencyControls(
    actor: SitePolicyActor,
    input: EmergencyControlChange,
  ): Promise<unknown> {
    assertPolicyMutation(actor, input.reason);
    return this.mutate(
      actor,
      'site.emergency_controls_changed',
      input.siteId,
      input.reason,
      (commands) => commands.setEmergencyControls(input),
    );
  }

  async setSubscriptionState(
    actor: SitePolicyActor,
    input: SubscriptionStateChange,
  ): Promise<unknown> {
    assertPolicyMutation(actor, input.reason);
    const effectiveInput =
      input.status === 'past_due' && !input.graceEndsAt
        ? { ...input, graceEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000) }
        : input;
    return this.mutate(
      actor,
      'site.subscription_state_changed',
      input.siteId,
      input.reason,
      (commands) => commands.setSubscriptionState(effectiveInput),
    );
  }

  private async mutate(
    actor: SitePolicyActor,
    action: string,
    siteId: string,
    reasonValue: string,
    operation: (commands: SitePolicyCommands) => Promise<{ before: unknown; after: unknown }>,
  ): Promise<unknown> {
    return this.store.transaction(async (commands) => {
      const result = await operation(commands);
      await commands.audit({
        action,
        actorId: actor.id,
        after: result.after,
        before: result.before,
        reason: reasonValue.trim(),
        siteId,
        traceId: actor.traceId,
      });
      return result.after;
    });
  }
}

function assertPolicyMutation(actor: SitePolicyActor, reasonValue: string): void {
  if (!['platform_owner', 'platform_admin', 'staff'].includes(actor.role)) {
    throw new Error('Platform staff authorization required');
  }
  if (!reasonValue.trim()) throw new Error('Policy mutations require a reason');
}
