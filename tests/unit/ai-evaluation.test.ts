import { describe, expect, it } from 'vitest';
import { evaluateProposal } from '@omnireach/ai';

const request = {
  currentValue: 'Mobile detailing in Aledo. Call 555-0100.',
  evidence: ['Coop provides mobile detailing in Aledo. Call 555-0100.'],
  fieldId: 'home.metaDescription',
  fieldPurpose: 'meta description',
};

describe('deterministic AI proposal evaluation', () => {
  it('accepts evidence-bound copy without retaining raw evidence in the result', () => {
    const result = evaluateProposal({
      proposal: {
        rationale: 'Clarifies the service.',
        replacement: 'Schedule mobile detailing in Aledo. Call 555-0100.',
        supportedClaims: ['mobile detailing in Aledo'],
      },
      protectedFacts: ['555-0100'],
      request,
    });
    expect(result.passed).toBe(true);
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain('555-0100');
  });

  it.each([
    ['unsafe_html', '<script>alert(1)</script> Call 555-0100.'],
    ['unsafe_link', 'Book at https://malicious.example and call 555-0100.'],
    ['prohibited_claim', 'Guaranteed number one results. Call 555-0100.'],
    ['restricted_fact_changed', 'Call 555-9999 today.'],
  ])('rejects %s deterministically', (code, replacement) => {
    const result = evaluateProposal({
      proposal: { rationale: 'fixture', replacement, supportedClaims: [] },
      protectedFacts: ['555-0100'],
      request,
    });
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
});
