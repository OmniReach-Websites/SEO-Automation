import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'packages/database/prisma/migrations/20261013160000_google_metrics_schedule/migration.sql',
  ),
  'utf8',
);
const service = readFileSync(resolve(process.cwd(), 'apps/api/src/postgres-google.ts'), 'utf8');
const productionCompose = readFileSync(
  resolve(process.cwd(), 'infrastructure/compose/production.compose.yml'),
  'utf8',
);
const productionEnvironment = readFileSync(
  resolve(process.cwd(), 'infrastructure/compose/production.env.example'),
  'utf8',
);
const queue = readFileSync(resolve(process.cwd(), 'packages/queue/src/index.ts'), 'utf8');
const runner = readFileSync(resolve(process.cwd(), 'workers/runner/src/google-metrics.ts'), 'utf8');

describe('Google metrics schedule activation', () => {
  it('backfills only active sites with active consented Google connections', () => {
    expect(migration).toContain("connection.provider = 'google'");
    expect(migration).toContain("connection.status = 'connected'");
    expect(migration).toContain('connection.collection_stopped_at IS NULL');
    expect(migration).toContain("site.status = 'active'");
    expect(migration).toContain("'metrics_sync'");
  });

  it('admits an immediate first run without overriding an existing schedule', () => {
    expect(migration).toMatch(/enabled, next_attempt_at\)\s*SELECT[\s\S]*true, now\(\)/u);
    expect(migration).toContain('ON CONFLICT (tenant_id, site_id, category) DO NOTHING');
  });

  it('uses the approved UTC schedule, deterministic bounded jitter, and concurrency one', () => {
    expect(migration).toContain("'Etc/UTC', 4, 0, 30");
    expect(productionCompose).toMatch(/runner:[\s\S]*WORKER_CATEGORIES: metrics_sync/u);
    expect(productionEnvironment).toContain('WORKER_CONCURRENCY=1');
  });

  it('keeps provider and durable-job retries bounded with exponential queue backoff', () => {
    expect(queue).toContain("backoff: { delay: 1_000, type: 'exponential' }");
    expect(runner).toContain('for (const connection of connections)');
    expect(runner).toContain('failures.some(({ retryable }) => retryable)');
    expect(runner).toContain("'retryable' : 'permanent'");
  });

  it('enables collection on connection and pauses it after the final disconnect', () => {
    expect(service).toMatch(/INSERT INTO schedules[\s\S]*category[\s\S]*'metrics_sync'/u);
    expect(service).toMatch(/ON CONFLICT[\s\S]*SET enabled = true/u);
    expect(service).toMatch(
      /UPDATE schedules schedule[\s\S]*SET enabled = false[\s\S]*NOT EXISTS[\s\S]*connection\.status = 'connected'/u,
    );
  });
});
