import { runSyntheticProposalBenchmark } from '@omnireach/ai';
import { describe, expect, it } from 'vitest';

describe('synthetic AI proposal safety benchmark', () => {
  it('passes every expected deterministic safety outcome without retaining source text', () => {
    const report = runSyntheticProposalBenchmark();
    expect(report.passed).toBe(true);
    expect(report.syntheticOnly).toBe(true);
    expect(report.cases).toHaveLength(5);
    expect(JSON.stringify(report)).not.toContain('Fictional Street');
    expect(
      report.cases.every(
        ({ inputHash, proposalHash }) => inputHash.length === 64 && proposalHash.length === 64,
      ),
    ).toBe(true);
  });
});
