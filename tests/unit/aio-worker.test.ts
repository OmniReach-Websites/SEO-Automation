import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryBudgetLedger, MockProposalProvider } from '@omnireach/ai';
import { MemoryAiReviewCycleQuota } from '@omnireach/tenant';
import { executeAiAutomation, generateFieldProposal } from '@omnireach/worker-aio';

const price = {
  effectiveAt: '2026-10-01T00:00:00Z',
  inputUsdMicrosPerMillion: 1_000_000,
  modelAlias: 'fixture',
  outputUsdMicrosPerMillion: 2_000_000,
  version: 1,
};
const input = {
  currentValue: 'Call 555-0100 today',
  evidence: ['fictional evidence'],
  fieldId: 'hero',
  fieldPurpose: 'headline',
};
const scope = { siteId: randomUUID(), tenantId: randomUUID() };
const reviewCycles = () => new MemoryAiReviewCycleQuota(100);
describe('AIO proposal orchestration', () => {
  it('routes suggestion and auto output through distinct next actions', async () => {
    const provider = new MockProposalProvider({
      rationale: 'Clearer',
      replacement: 'Call 555-0100 for a warm welcome',
      supportedClaims: [],
    });
    await expect(
      generateFieldProposal({
        ...scope,
        budget: new MemoryBudgetLedger(),
        input,
        mode: 'SUGGEST',
        modelPrice: price,
        now: new Date('2026-10-10T00:00:00Z'),
        protectedFacts: ['555-0100'],
        provider,
        providerEnabled: true,
        reviewCycles: reviewCycles(),
      }),
    ).resolves.toMatchObject({ action: 'review' });
    await expect(
      generateFieldProposal({
        ...scope,
        budget: new MemoryBudgetLedger(),
        input,
        mode: 'AUTO',
        modelPrice: price,
        now: new Date('2026-10-10T00:00:00Z'),
        protectedFacts: ['555-0100'],
        provider,
        providerEnabled: true,
        reviewCycles: reviewCycles(),
      }),
    ).resolves.toMatchObject({ action: 'draft_candidate' });
  });
  it('never calls the provider for protected mode and records usage for rejected output', async () => {
    let calls = 0;
    const provider = {
      generate: async () => {
        calls += 1;
        return new MockProposalProvider({
          rationale: 'x',
          replacement: 'x',
          supportedClaims: [],
        }).generate(input);
      },
    };
    await expect(
      generateFieldProposal({
        ...scope,
        budget: new MemoryBudgetLedger(),
        input,
        mode: 'PROTECTED',
        modelPrice: price,
        now: new Date('2026-10-10T00:00:00Z'),
        protectedFacts: [],
        provider,
        providerEnabled: true,
        reviewCycles: reviewCycles(),
      }),
    ).rejects.toThrow(/before provider/u);
    expect(calls).toBe(0);
    const budget = new MemoryBudgetLedger();
    await expect(
      generateFieldProposal({
        ...scope,
        budget,
        input,
        mode: 'AUTO',
        modelPrice: price,
        now: new Date('2026-10-10T00:00:00Z'),
        protectedFacts: ['555-0100'],
        provider: new MockProposalProvider({
          rationale: 'Unsupported',
          replacement: 'Call 555-9999',
          supportedClaims: [],
        }),
        providerEnabled: true,
        reviewCycles: reviewCycles(),
      }),
    ).rejects.toThrow(/restricted_fact_changed/u);
    expect(budget.reservations[0]?.state).toBe('reconciled');
    expect(budget.usage).toHaveLength(1);
    expect(budget.usage[0]?.amountUsdMicros).toBe(30);
  });

  it('consumes one review cycle per successful provider call and releases failed calls', async () => {
    const cycles = new MemoryAiReviewCycleQuota(1);
    const rejectedProvider = new MockProposalProvider({
      rationale: 'Unsafe',
      replacement: 'Call 555-9999',
      supportedClaims: [],
    });
    await expect(
      generateFieldProposal({
        ...scope,
        budget: new MemoryBudgetLedger(),
        input,
        mode: 'SUGGEST',
        modelPrice: price,
        now: new Date('2026-10-10T00:00:00Z'),
        protectedFacts: ['555-0100'],
        provider: rejectedProvider,
        providerEnabled: true,
        reviewCycles: cycles,
      }),
    ).rejects.toThrow('restricted_fact_changed');
    await expect(
      generateFieldProposal({
        ...scope,
        budget: new MemoryBudgetLedger(),
        input,
        mode: 'SUGGEST',
        modelPrice: price,
        now: new Date('2026-10-10T00:01:00Z'),
        protectedFacts: ['555-0100'],
        provider: new MockProposalProvider({
          rationale: 'Safe',
          replacement: 'Call 555-0100 for a warm welcome',
          supportedClaims: [],
        }),
        providerEnabled: true,
        reviewCycles: cycles,
      }),
    ).resolves.toMatchObject({ action: 'review' });
    await expect(
      generateFieldProposal({
        ...scope,
        budget: new MemoryBudgetLedger(),
        input,
        mode: 'SUGGEST',
        modelPrice: price,
        now: new Date('2026-10-10T00:02:00Z'),
        protectedFacts: ['555-0100'],
        provider: rejectedProvider,
        providerEnabled: true,
        reviewCycles: cycles,
      }),
    ).rejects.toThrow('review-cycle quota');
  });

  it('stages AUTO as a reviewable proposal without publishing and alerts on staging failure', async () => {
    const provider = new MockProposalProvider({
      rationale: 'Clearer',
      replacement: 'Call 555-0100 for a warm welcome',
      supportedClaims: [],
    });
    let alerts = 0;
    await expect(
      executeAiAutomation({
        ...scope,
        budget: new MemoryBudgetLedger(),
        input,
        mode: 'AUTO',
        modelPrice: price,
        now: new Date('2026-10-10T00:00:00Z'),
        protectedFacts: ['555-0100'],
        provider,
        providerEnabled: true,
        reviewCycles: reviewCycles(),
        raiseAlert: async () => {
          alerts += 1;
        },
        stageProposal: async () => ({
          draftId: 'draft-fixture',
          proposalId: 'proposal-fixture',
        }),
      }),
    ).resolves.toEqual({
      action: 'review_staged',
      proposalId: 'proposal-fixture',
    });
    await expect(
      executeAiAutomation({
        ...scope,
        budget: new MemoryBudgetLedger(),
        input,
        mode: 'AUTO',
        modelPrice: price,
        now: new Date('2026-10-10T00:00:00Z'),
        protectedFacts: ['555-0100'],
        provider,
        providerEnabled: true,
        reviewCycles: reviewCycles(),
        raiseAlert: async () => {
          alerts += 1;
        },
        stageProposal: async () => {
          throw new Error('proposal persistence failed');
        },
      }),
    ).rejects.toThrow(/persistence/u);
    expect(alerts).toBe(1);
  });

  it('checks the centralized provider gate before quota, budget, or provider use', async () => {
    const budget = new MemoryBudgetLedger();
    let providerCalls = 0;
    const provider = {
      generate: async () => {
        providerCalls += 1;
        return new MockProposalProvider({
          rationale: 'fixture',
          replacement: 'Call 555-0100 for a warm welcome',
          supportedClaims: [],
        }).generate(input);
      },
    };
    await expect(
      generateFieldProposal({
        ...scope,
        budget,
        input,
        mode: 'AUTO',
        modelPrice: price,
        now: new Date('2026-10-10T00:00:00Z'),
        protectedFacts: ['555-0100'],
        provider,
        providerEnabled: false,
        reviewCycles: reviewCycles(),
      }),
    ).rejects.toThrow(/centralized provider gate/u);
    expect(providerCalls).toBe(0);
    expect(budget.reservations).toHaveLength(0);
  });
});
