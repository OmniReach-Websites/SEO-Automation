import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261011014000_publication_job_admission/migration.sql',
  ),
  'utf8',
);
const contentRepository = readFileSync(resolve(root, 'packages/content/src/postgres.ts'), 'utf8');

describe('publication job admission boundary', () => {
  it('atomically admits opaque publish work for the old and new request insert shapes', () => {
    expect(migration).toContain('CREATE TRIGGER publication_request_admit_job');
    expect(migration).toContain('BEFORE INSERT ON publication_requests');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain("'publish', 1, NEW.id, NEW.idempotency_key, NEW.trace_id");
    expect(migration).toContain('NEW.job_id := admitted.id');
    expect(migration).toContain('SELECT request.job_id');
    expect(migration).toContain('NEW.job_id := existing_job_id');
    expect(migration).toContain('publication_active_job_required');
    expect(migration).toContain('publication_trace_id_envelope_safe');
    expect(migration).toContain("trace_id ~ '^[A-Za-z0-9_-]{16,128}$'");
    expect(migration).toContain("status NOT IN ('queued', 'building') OR job_id IS NOT NULL");
    expect(migration).not.toMatch(/redis/iu);
  });

  it('backfills active requests and locks the exact tenant/site/job identity', () => {
    expect(migration).toContain("request.status IN ('queued', 'building')");
    expect(migration).toContain('publication_requests_job_identity_fkey');
    expect(migration).toContain('jobs_publication_identity_key');
    expect(migration).toContain('publication_requests_job_id_key');
    expect(migration).toContain('publication job link is immutable');
    expect(migration).toContain('linked publication job identity is immutable');
    expect(migration).toContain('job.record_id = request.id');
    expect(migration).toContain('job.dedupe_key = request.idempotency_key');
    expect(migration).toContain('job.trace_id = request.trace_id');
  });

  it('passes the request trace to PostgreSQL and leaves job creation to the transaction trigger', () => {
    expect(contentRepository).toMatch(
      /INSERT INTO publication_requests[\s\S]*previous_artifact_id, trace_id\)/u,
    );
    expect(contentRepository).not.toContain('INSERT INTO jobs');
  });
});
