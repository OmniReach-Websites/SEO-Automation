import {
  PlanQuotaExceededError,
  assertCapabilityCanBeSold,
  assertPlanFeatureAllowed,
  assertQuotaAvailable,
  defaultGraceEndsAt,
  isSeoAuditDue,
  selectedPlanProposals,
} from '@omnireach/tenant';
import { describe, expect, it } from 'vitest';

describe('R-011 plan entitlements', () => {
  it('records the exact four selected commercial proposals', () => {
    expect(selectedPlanProposals).toMatchObject({
      STARTER: {
        aiReviewCyclesPerMonth: 2,
        businessLocations: 1,
        commercialStatus: 'proposal',
        customerSeats: 2,
        monthlyPriceCents: 50_000,
        seoAuditIntervalHours: 168,
        standardPages: 5,
      },
      GROWTH: {
        aiReviewCyclesPerMonth: 8,
        customerSeats: 5,
        monthlyPriceCents: 100_000,
        seoAuditIntervalHours: 24,
        standardPages: 10,
      },
      PRO: {
        aiReviewCyclesPerMonth: 16,
        customerSeats: 10,
        monthlyPriceCents: 150_000,
        seoAuditIntervalHours: 24,
        standardPages: 20,
      },
      ELITE: {
        aiReviewCyclesPerMonth: 30,
        customerSeats: 20,
        monthlyPriceCents: 200_000,
        seoAuditIntervalHours: 24,
        standardPages: 30,
      },
    });
  });

  it('enforces numeric boundaries without allowing an over-quota race result', () => {
    expect(() =>
      assertQuotaAvailable(selectedPlanProposals.STARTER, 'customerSeats', 1),
    ).not.toThrow();
    expect(() => assertQuotaAvailable(selectedPlanProposals.STARTER, 'customerSeats', 2)).toThrow(
      PlanQuotaExceededError,
    );
    expect(() =>
      assertQuotaAvailable(selectedPlanProposals.ELITE, 'standardPages', 29),
    ).not.toThrow();
  });

  it('keeps excluded expansion features and unfinished capabilities unsaleable', () => {
    expect(() => assertPlanFeatureAllowed('seo.competitor-monitoring')).toThrow('excluded');
    expect(() => assertPlanFeatureAllowed('content.edit')).not.toThrow();
    expect(() => assertCapabilityCanBeSold('contact.forms', 'tested')).toThrow('cannot be sold');
    expect(() => assertCapabilityCanBeSold('content.edit', 'deployable')).not.toThrow();
  });

  it('calculates the default grace period and tier audit cadence deterministically', () => {
    expect(defaultGraceEndsAt(new Date('2026-10-11T00:00:00.000Z')).toISOString()).toBe(
      '2026-10-25T00:00:00.000Z',
    );
    expect(
      isSeoAuditDue(
        selectedPlanProposals.STARTER,
        new Date('2026-10-05T00:00:00.000Z'),
        new Date('2026-10-11T23:59:59.000Z'),
      ),
    ).toBe(false);
    expect(
      isSeoAuditDue(
        selectedPlanProposals.GROWTH,
        new Date('2026-10-10T00:00:00.000Z'),
        new Date('2026-10-11T00:00:00.000Z'),
      ),
    ).toBe(true);
  });
});
