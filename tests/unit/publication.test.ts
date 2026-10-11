import {
  PublicationOrchestrator,
  type PublicationDependencies,
  type PublishRequest,
  type PublishResult,
} from '@omnireach/worker-publisher';
import { describe, expect, it, vi } from 'vitest';

const request: PublishRequest = {
  actorId: 'owner',
  contentRevision: 3,
  editorPublishGrant: false,
  idempotencyKey: 'publish-0001',
  origin: 'customer',
  reason: 'Approved update',
  role: 'customer_owner',
  siteId: 'site-a',
  tenantId: 'tenant-a',
  traceId: 'trace-publication-1',
};

function dependencies(
  overrides: Partial<PublicationDependencies> = {},
): PublicationDependencies & { records: PublishResult[] } {
  const records: PublishResult[] = [];
  return {
    activate: vi.fn(async () => undefined),
    activeArtifact: vi.fn(async () => 'a'.repeat(64)),
    begin: vi.fn(async () => undefined),
    build: vi.fn(async () => ({ artifactHash: 'b'.repeat(64) })),
    findResult: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => undefined),
    lock: vi.fn(async () => async () => undefined),
    record: vi.fn(async (_request, result) => void records.push(result)),
    records,
    revalidate: vi.fn(async () => undefined),
    rollbackActivation: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('publication orchestration', () => {
  it('revalidates, builds, health-checks, then atomically activates', async () => {
    const deps = dependencies();
    const result = await new PublicationOrchestrator(deps).publish(request);
    expect(result).toMatchObject({
      artifactHash: 'b'.repeat(64),
      previousArtifact: 'a'.repeat(64),
      status: 'published',
    });
    expect(deps.revalidate).toHaveBeenCalledBefore(vi.mocked(deps.build));
    expect(deps.healthCheck).toHaveBeenCalledBefore(vi.mocked(deps.activate));
  });

  it('leaves the previous artifact active on build or health failure and records failure', async () => {
    const deps = dependencies({
      healthCheck: vi.fn(async () => Promise.reject(new Error('unhealthy'))),
    });
    await expect(new PublicationOrchestrator(deps).publish(request)).rejects.toThrow('unhealthy');
    expect(deps.activate).not.toHaveBeenCalled();
    expect(deps.records).toEqual([
      expect.objectContaining({ previousArtifact: 'a'.repeat(64), status: 'failed' }),
    ]);
  });

  it('is idempotent, single-flight, and enforces the role model', async () => {
    const existing: PublishResult = {
      artifactHash: 'c'.repeat(64),
      requestKey: request.idempotencyKey,
      status: 'published',
    };
    const deps = dependencies({ findResult: vi.fn(async () => existing) });
    await expect(new PublicationOrchestrator(deps).publish(request)).resolves.toBe(existing);
    expect(deps.build).not.toHaveBeenCalled();
    await expect(
      new PublicationOrchestrator(dependencies()).publish({ ...request, role: 'customer_viewer' }),
    ).rejects.toThrow('permission');
    await expect(
      new PublicationOrchestrator(
        dependencies({ lock: vi.fn(async () => false as const) }),
      ).publish(request),
    ).rejects.toThrow('already running');
  });

  it('restores the prior pointer when post-activation persistence fails', async () => {
    const record = vi
      .fn<(request: PublishRequest, result: PublishResult) => Promise<void>>()
      .mockRejectedValueOnce(new Error('publication record unavailable'))
      .mockResolvedValueOnce(undefined);
    const deps = dependencies({ record });

    await expect(new PublicationOrchestrator(deps).publish(request)).rejects.toThrow(
      'publication record unavailable',
    );
    expect(deps.rollbackActivation).toHaveBeenCalledWith(request, 'a'.repeat(64));
    expect(record).toHaveBeenLastCalledWith(request, expect.objectContaining({ status: 'failed' }));
  });
});
