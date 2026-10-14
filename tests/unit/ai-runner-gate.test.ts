import { runAiProposal } from '../../workers/runner/src/job-handlers.ts';
import { describe, expect, it, vi } from 'vitest';

const envelope = {
  attemptLimit: 3,
  category: 'aio_proposal' as const,
  createdAt: new Date(0).toISOString(),
  dedupeKey: 'fixture-ai-job',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  policyVersion: 1,
  recordId: '80000000-0000-4000-8000-000000000001',
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  timeoutMs: 30_000,
  traceId: 'fixture-trace',
  version: 1 as const,
};

describe('AI proposal worker provider gate', () => {
  it('cancels before any database or provider access while production calls are disabled', async () => {
    const connect = vi.fn();
    await expect(
      runAiProposal(envelope, {
        environment: { OPENAI_PROVIDER_ENABLED: 'false' },
        execution: { attempt: 1, jobId: 'job-a', runId: 'run-a' },
        pool: { connect } as never,
      }),
    ).rejects.toMatchObject({
      category: 'cancelled',
      message: 'AI provider is disabled by policy',
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
