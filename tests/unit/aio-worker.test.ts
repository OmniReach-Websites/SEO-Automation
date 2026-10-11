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
        reviewCycles: reviewCycles(),
      }),
    ).resolves.toMatchObject({ action: 'publish_candidate' });
  });
  it('never calls the provider for protected mode and releases failed reservations', async () => {
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
        reviewCycles: reviewCycles(),
      }),
    ).rejects.toThrow(/protected business/u);
    expect(budget.reservations[0]?.state).toBe('released');
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
        reviewCycles: cycles,
      }),
    ).rejects.toThrow('protected business');
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
        reviewCycles: cycles,
      }),
    ).rejects.toThrow('review-cycle quota');
  });

  it('publishes AUTO only through the supplied normal publication gate and alerts on failure', async () => {
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
        reviewCycles: reviewCycles(),
        publishCandidate: async () => ({ artifactId: 'artifact-fixture' }),
        raiseAlert: async () => {
          alerts += 1;
        },
      }),
    ).resolves.toEqual({ action: 'published', artifactId: 'artifact-fixture' });
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
        reviewCycles: reviewCycles(),
        publishCandidate: async () => {
          throw new Error('staging health failed');
        },
        raiseAlert: async () => {
          alerts += 1;
        },
      }),
    ).rejects.toThrow(/health/u);
    expect(alerts).toBe(1);
  });
});
