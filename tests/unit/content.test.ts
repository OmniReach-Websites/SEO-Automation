import {
  ProtectedFieldError,
  ProtectedFactService,
  RevisionConflictError,
  assertProtectedTokensPreserved,
  restoreRevision,
  transitionProposal,
  updateDraft,
  validateManualFactEdit,
  type FieldPolicy,
} from '@omnireach/content';
import { describe, expect, it, vi } from 'vitest';

const policies = new Map<string, FieldPolicy>([
  ['heading', { aiMode: 'auto', id: 'heading', protected: false, type: 'text' }],
  ['body', { aiMode: 'suggestion', id: 'body', protected: false, type: 'richText' }],
  ['hours', { aiMode: 'disabled', id: 'hours', protected: true, type: 'text' }],
]);

describe('content safety and revisions', () => {
  it('uses optimistic concurrency and sanitizes rich text while preserving Unicode', () => {
    const result = updateDraft({
      actor: 'human',
      current: { body: '<p>Old</p>', heading: 'Hello' },
      currentVersion: 2,
      expectedVersion: 2,
      fieldPolicies: policies,
      patch: { body: '<p>Café <strong>nuevo</strong><script>bad()</script></p>' },
    });
    expect(result.version).toBe(3);
    expect(result.content.body).toBe('<p>Café <strong>nuevo</strong></p>');
    expect(() =>
      updateDraft({
        actor: 'human',
        current: {},
        currentVersion: 3,
        expectedVersion: 2,
        fieldPolicies: policies,
        patch: {},
      }),
    ).toThrow(RevisionConflictError);
  });

  it('denies every protected-field mutation path and detects token changes', () => {
    expect(() =>
      updateDraft({
        actor: 'ai',
        current: { hours: '{{fact:business.hours}}' },
        currentVersion: 1,
        expectedVersion: 1,
        fieldPolicies: policies,
        patch: { hours: 'Always open' },
      }),
    ).toThrow(ProtectedFieldError);
    expect(() =>
      assertProtectedTokensPreserved('See {{fact:business.hours}}', 'Always open'),
    ).toThrow(ProtectedFieldError);
    expect(() =>
      updateDraft({
        actor: 'ai',
        current: { heading: 'Open {{fact:business.hours}}' },
        currentVersion: 1,
        expectedVersion: 1,
        fieldPolicies: policies,
        patch: { heading: 'Open every day' },
      }),
    ).toThrow(ProtectedFieldError);
    expect(() =>
      updateDraft({
        actor: 'ai',
        current: { body: 'Welcome' },
        currentVersion: 1,
        expectedVersion: 1,
        fieldPolicies: policies,
        patch: { body: 'Suggested replacement' },
      }),
    ).toThrow(ProtectedFieldError);
  });

  it('enforces proposal states and restores history as a new revision', () => {
    expect(transitionProposal('pending', 'approved')).toBe('approved');
    expect(() => transitionProposal('rejected', 'applied')).toThrow('Invalid proposal transition');
    const restored = restoreRevision(
      [
        { content: { heading: 'One' }, createdAt: '2026-01-01T00:00:00Z', number: 1 },
        { content: { heading: 'Two' }, createdAt: '2026-01-02T00:00:00Z', number: 2 },
      ],
      1,
      '2026-01-03T00:00:00Z',
    );
    expect(restored).toMatchObject({ content: { heading: 'One' }, number: 3, restoredFrom: 1 });
  });

  it('limits manual fact editing to customer owners and platform staff with provenance', () => {
    expect(
      validateManualFactEdit({
        actorId: 'owner',
        factId: 'hours',
        provenance: 'Owner confirmation',
        reason: 'Seasonal change',
        role: 'customer_owner',
        value: '9–5',
      }),
    ).toMatchObject({ role: 'customer_owner' });
    expect(() =>
      validateManualFactEdit({
        actorId: 'editor',
        factId: 'hours',
        provenance: 'Guess',
        reason: 'Change',
        role: 'customer_editor',
        value: 'Always',
      }),
    ).toThrow('Role cannot edit protected facts');
  });

  it('updates protected facts only through an optimistic audited transaction', async () => {
    const appendAudit = vi.fn();
    const updateFact = vi.fn(async () => ({
      after: { id: 'hours', provenance: 'Owner confirmation', value: '10–6', version: 2 },
      before: { id: 'hours', provenance: 'Opening record', value: '9–5', version: 1 },
    }));
    const service = new ProtectedFactService({
      transaction: async (operation) => operation({ appendAudit, updateFact }),
    });
    await expect(
      service.update({
        actorId: 'owner',
        expectedVersion: 1,
        factId: 'hours',
        provenance: 'Owner confirmation',
        reason: 'Seasonal change',
        role: 'customer_owner',
        value: '10–6',
      }),
    ).resolves.toMatchObject({ value: '10–6', version: 2 });
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'owner',
        before: expect.objectContaining({ value: '9–5' }),
        reason: 'Seasonal change',
      }),
    );
  });
});
