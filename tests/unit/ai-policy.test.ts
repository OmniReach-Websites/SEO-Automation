import { describe, expect, it } from 'vitest';
import {
  authorizeProposalAcceptance,
  effectiveAiMode,
  validateAiFieldMutation,
} from '@omnireach/content';
import { renderProposalReview } from '@omnireach/customer-admin';

const field = { aiMode: 'auto' as const, id: 'hero', protected: false, type: 'text' };
describe('effective AI modes and protected facts', () => {
  it('downgrades AUTO to SUGGEST and makes protected fields absolute', () => {
    expect(
      effectiveAiMode({
        autonomousChangesStopped: false,
        field,
        globalGenerationEnabled: true,
        policyVersion: 1,
        siteAutoEditingEnabled: true,
      }),
    ).toBe('AUTO');
    expect(
      effectiveAiMode({
        autonomousChangesStopped: false,
        field,
        globalGenerationEnabled: true,
        policyVersion: 1,
        siteAutoEditingEnabled: false,
      }),
    ).toBe('SUGGEST');
    expect(
      effectiveAiMode({
        autonomousChangesStopped: false,
        field: { ...field, protected: true },
        globalGenerationEnabled: true,
        policyVersion: 1,
        siteAutoEditingEnabled: true,
      }),
    ).toBe('PROTECTED');
  });
  it('rejects protected price, phone, address, hours, legal, Unicode, and duplicate mutations', () => {
    for (const fact of [
      '$25.00',
      '+1 (555) 010-2000',
      '10 Main St.',
      '9:00 AM–5:00 PM',
      'Terms apply',
    ]) {
      expect(() =>
        validateAiFieldMutation({
          after: `Better copy without the verified detail`,
          before: `Welcome ${fact}`,
          facts: [fact],
          mode: 'AUTO',
        }),
      ).toThrow(/protected business/u);
      expect(() =>
        validateAiFieldMutation({
          after: `Welcome ${fact} and again ${fact}`,
          before: `Welcome ${fact}`,
          facts: [fact],
          mode: 'AUTO',
        }),
      ).toThrow(/protected business/u);
    }
    expect(() =>
      validateAiFieldMutation({
        after: 'anything',
        before: 'anything',
        facts: [],
        mode: 'PROTECTED',
      }),
    ).toThrow(/forbidden/u);
  });
  it('reauthorizes current proposal revision, policy, expiry, and publish grant', () => {
    const proposal = {
      baseRevision: 4,
      expiresAt: '2026-10-11T00:00:00.000Z',
      fieldId: 'hero',
      policyVersion: 2,
      state: 'pending' as const,
    };
    expect(
      authorizeProposalAcceptance({
        canPublish: true,
        currentPolicyVersion: 2,
        currentRevision: 4,
        now: new Date('2026-10-10T00:00:00.000Z'),
        proposal,
      }),
    ).toBe('approved');
    expect(() =>
      authorizeProposalAcceptance({
        canPublish: true,
        currentPolicyVersion: 2,
        currentRevision: 5,
        now: new Date('2026-10-10T00:00:00.000Z'),
        proposal,
      }),
    ).toThrow(/stale/u);
    expect(() =>
      authorizeProposalAcceptance({
        canPublish: false,
        currentPolicyVersion: 2,
        currentRevision: 4,
        now: new Date('2026-10-10T00:00:00.000Z'),
        proposal,
      }),
    ).toThrow(/permission/u);
  });
  it('renders accessible accept, reject, edit, and stale review controls', () => {
    const html = renderProposalReview(
      [
        {
          expiresAt: '2026-10-11',
          fieldLabel: 'Hero',
          id: 'proposal-1',
          rationale: 'Clearer',
          replacement: 'New value',
          stale: true,
        },
      ],
      'csrf-fixture',
    );
    expect(html).toContain('Accept and preview');
    expect(html).toContain('value="reject"');
    expect(html).toContain('value="edit"');
    expect(html).toContain('role="status"');
  });
});
