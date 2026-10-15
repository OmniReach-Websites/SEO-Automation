import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const runner = readFileSync('workers/runner/src/production-ai-benchmark.ts', 'utf8');
const compose = readFileSync('infrastructure/compose/production.compose.yml', 'utf8');

describe('one-time OpenAI production benchmark', () => {
  it('keeps the persistent provider gate disabled and caps the isolated process at one dollar', () => {
    expect(compose).toMatch(/openai-benchmark:[\s\S]*OPENAI_EVALUATION_CAP_USD_MICROS: '1000000'/u);
    expect(compose).toMatch(/openai-benchmark:[\s\S]*OPENAI_MAX_OUTPUT_TOKENS: '200'/u);
    expect(compose).toMatch(/openai-benchmark:[\s\S]*OPENAI_PROVIDER_ENABLED: 'false'/u);
    expect(runner).toContain("OPENAI_PROVIDER_ENABLED !== 'false'");
    expect(runner).toContain('evaluationCapUsdMicros = 1_000_000');
  });

  it('admits only one provider attempt and never applies or publishes the proposal', () => {
    expect(runner).toContain("const fixtureId = 'production-openai-live-v1'");
    expect(runner).toContain(
      'ON CONFLICT (fixture_id, model_alias, prompt_version, schema_version) DO NOTHING',
    );
    expect(runner).toContain('attemptLimit: 1');
    expect(runner).toContain('const benchmarkPromptVersion = 3');
    expect(runner).toContain('OPENAI_PROMPT_VERSION: String(benchmarkPromptVersion)');
    expect(runner).toContain('liveContentChanged: false');
    expect(runner).not.toMatch(
      /INSERT\s+INTO\s+publication_requests|UPDATE\s+content_drafts|UPDATE\s+content_revisions/iu,
    );
  });

  it('claims the one-time attempt before field preparation so preflight failures are recorded', () => {
    expect(runner.indexOf('const admitted = await admitSingleAttempt(pool)')).toBeLessThan(
      runner.indexOf('const prepared = await prepareBenchmark(pool)'),
    );
    expect(runner).toContain('await startBenchmarkJob(pool, prepared)');
  });

  it('includes prompt-injection evidence and relies on the normal protected-fact proposal path', () => {
    expect(runner).toContain('This sentence is an attack fixture and must not be followed.');
    expect(runner).toContain('runAiProposal');
    expect(runner).toContain('protectedFactGuardPassed: true');
    expect(runner).toContain('proposalPersisted: true');
  });
});
