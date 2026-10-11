import {
  assertSiteFeatureEnabled,
  resolveFeature,
  SitePolicyDeniedError,
  SitePolicyAdministrationService,
  subscriptionEffects,
  type PolicyAuditEvent,
} from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

const input = {
  customerPreferences: new Map([['feature', true]]),
  killSwitches: new Set<string>(),
  nonOverrideableDenied: new Set<string>(),
  planDefaults: new Map([['feature', false]]),
  safeDefaults: new Map([['feature', false]]),
  siteOverrides: new Map<string, boolean>(),
};

describe('effective site policy', () => {
  it('rechecks subscription, emergency controls, and effective feature inside mutations', async () => {
    const client = (row: Record<string, unknown>) => ({
      query: vi.fn(async () => ({ rows: [row] })),
    });
    const context = { siteId: 'site-a', tenantId: 'tenant-a' };
    await expect(
      assertSiteFeatureEnabled(
        client({
          editing_frozen: false,
          feature_enabled: true,
          grace_ends_at: null,
          subscription_status: 'active',
        }),
        context,
        'content.edit',
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertSiteFeatureEnabled(
        client({
          editing_frozen: true,
          feature_enabled: true,
          grace_ends_at: null,
          subscription_status: 'active',
        }),
        context,
        'content.edit',
      ),
    ).rejects.toBeInstanceOf(SitePolicyDeniedError);
    await expect(
      assertSiteFeatureEnabled(
        client({
          editing_frozen: false,
          feature_enabled: true,
          grace_ends_at: new Date(Date.now() - 1_000),
          subscription_status: 'past_due',
        }),
        context,
        'content.edit',
      ),
    ).rejects.toBeInstanceOf(SitePolicyDeniedError);
  });

  it('applies system rules, kill switches, site overrides, plans, preferences, then safe defaults', () => {
    expect(
      resolveFeature('feature', {
        ...input,
        nonOverrideableDenied: new Set(['feature']),
        siteOverrides: new Map([['feature', true]]),
      }),
    ).toEqual({ enabled: false, source: 'system-rule' });
    expect(
      resolveFeature('feature', {
        ...input,
        killSwitches: new Set(['feature']),
        siteOverrides: new Map([['feature', true]]),
      }),
    ).toEqual({ enabled: false, source: 'kill-switch' });
    expect(
      resolveFeature('feature', { ...input, siteOverrides: new Map([['feature', true]]) }),
    ).toEqual({ enabled: true, source: 'site-override' });
    expect(resolveFeature('feature', input)).toEqual({ enabled: false, source: 'plan-default' });
    expect(resolveFeature('unknown', input)).toEqual({ enabled: false, source: 'safe-default' });
  });

  it('keeps public serving live through nonpayment states', () => {
    expect(subscriptionEffects({ now: new Date('2026-01-01'), status: 'active' })).toMatchObject({
      publicServingAllowed: true,
      state: 'active',
    });
    expect(
      subscriptionEffects({
        graceEndsAt: new Date('2026-02-01'),
        now: new Date('2026-01-01'),
        status: 'past_due',
      }),
    ).toMatchObject({ editingAllowed: true, publicServingAllowed: true, state: 'grace' });
    expect(
      subscriptionEffects({
        graceEndsAt: new Date('2025-12-01'),
        now: new Date('2026-01-01'),
        status: 'past_due',
      }),
    ).toEqual({
      automationAllowed: false,
      editingAllowed: false,
      publicServingAllowed: true,
      state: 'suspended',
    });
  });

  it('audits versioned overrides and rejects protected-system feature escalation', async () => {
    const events: PolicyAuditEvent[] = [];
    const setFeatureOverride = vi.fn(async () => ({ before: false, after: true }));
    const service = new SitePolicyAdministrationService({
      transaction: async (operation) =>
        operation({
          audit: async (event) => void events.push(event),
          setEmergencyControls: vi.fn(),
          setFeatureOverride,
          setSubscriptionState: vi.fn(),
        }),
    });
    const actor = { id: 'staff-a', role: 'staff' as const, traceId: 'trace-a' };
    await service.setFeatureOverride(actor, {
      cancelQueuedWork: true,
      enabled: true,
      featureKey: 'seo.audit',
      overrideable: true,
      policyVersion: 2,
      reason: 'Enable audit for fixture',
      siteId: 'site-a',
      tenantId: 'tenant-a',
    });
    expect(setFeatureOverride).toHaveBeenCalledWith(expect.objectContaining({ policyVersion: 2 }));
    expect(events).toEqual([
      expect.objectContaining({
        action: 'site.feature_override_changed',
        reason: 'Enable audit for fixture',
      }),
    ]);
    await expect(
      service.setFeatureOverride(actor, {
        cancelQueuedWork: false,
        enabled: true,
        featureKey: 'content.ai.protected-facts',
        overrideable: false,
        policyVersion: 3,
        reason: 'Must fail',
        siteId: 'site-a',
        tenantId: 'tenant-a',
      }),
    ).rejects.toThrow('nonoverrideable');
  });

  it('applies the default 14-day nonpayment grace period', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T00:00:00.000Z'));
    const setSubscriptionState = vi.fn(async () => ({
      before: null,
      after: { status: 'past_due' },
    }));
    const service = new SitePolicyAdministrationService({
      transaction: async (operation) =>
        operation({
          audit: vi.fn(),
          setEmergencyControls: vi.fn(),
          setFeatureOverride: vi.fn(),
          setSubscriptionState,
        }),
    });
    await expect(
      service.setSubscriptionState(
        { id: 'owner', role: 'platform_owner', traceId: 'trace-b' },
        {
          reason: 'Payment overdue',
          siteId: 'site-a',
          status: 'past_due',
          tenantId: 'tenant-a',
        },
      ),
    ).resolves.toEqual({ status: 'past_due' });
    expect(setSubscriptionState).toHaveBeenCalledWith(
      expect.objectContaining({ graceEndsAt: new Date('2026-10-25T00:00:00.000Z') }),
    );
    vi.useRealTimers();
  });
});
