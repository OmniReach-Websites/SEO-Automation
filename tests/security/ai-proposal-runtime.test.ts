import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'packages/database/prisma/migrations/20261014120000_ai_proposal_runtime/migration.sql',
  'utf8',
);
const admission = readFileSync('packages/content/src/postgres-ai-proposals.ts', 'utf8');
const loader = readFileSync('workers/aio/src/postgres-job.ts', 'utf8');
const runner = readFileSync('workers/runner/src/job-handlers.ts', 'utf8');
const compose = readFileSync('infrastructure/compose/production.compose.yml', 'utf8');

describe('AI proposal runtime security boundaries', () => {
  it('keeps durable material tenant scoped, row protected, and hidden from queue payloads', () => {
    expect(migration).toContain('CREATE TABLE ai_proposal_job_materials');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('tenant_scope_ai_proposal_job_materials');
    expect(admission).toContain("'aio_proposal'");
    expect(admission).toContain('material.id');
    expect(admission).not.toMatch(/FROM ai_proposal_job_materials[\s\S]*?FOR UPDATE/u);
    expect(admission).not.toMatch(/JSON\.stringify\(\{[^}]*currentValue/su);
  });

  it('revalidates field policy, source hash, emergency controls, and model price', () => {
    expect(loader).toContain('sourceValueHash(currentValue) !== source.source_value_hash');
    expect(loader).toContain('source.protected');
    expect(loader).toContain('source.automation_stopped');
    expect(loader).toContain('source.autonomous_changes_stopped');
    expect(loader).toContain('provider_model = $2');
  });

  it('gates provider access first and runs in a dedicated constrained worker', () => {
    const gate = runner.indexOf("OPENAI_PROVIDER_ENABLED !== 'true'");
    const loaderUse = runner.indexOf('new PostgresAiProposalJobLoader');
    const providerUse = runner.indexOf('new OpenAiProposalProvider');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(loaderUse);
    expect(gate).toBeLessThan(providerUse);
    expect(compose).toMatch(/aio:[\s\S]*WORKER_CATEGORIES: aio_proposal/u);
    expect(compose).toMatch(/aio:[\s\S]*cpus: 0\.25[\s\S]*mem_limit: 256m/u);
  });
});
