import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgresContentRepository } from '@omnireach/content';
import { createDatabase } from '@omnireach/database';
import type { TenantTransactionPool } from '@omnireach/tenant';
import {
  discoverSiteBuildDefinitions,
  LocalArtifactStore,
  LocalPublicationBuilder,
  PostgresPublicationRequestRepository,
  PostgresPublicationState,
  PostgresSnapshotMaterializer,
  PublicationOrchestrator,
  type PublicationDependencies,
  type PublishRequest,
} from '@omnireach/worker-publisher';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev';
const parsedDatabaseUrl = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(parsedDatabaseUrl.hostname)) {
  throw new Error('Publication verification refuses a non-loopback database');
}

const ids = {
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  userId: '40000000-0000-4000-8000-000000000001',
};
const database = createDatabase(databaseUrl);
const pool = database.pool as unknown as TenantTransactionPool;
const temporary = await mkdtemp(join(tmpdir(), 'omnireach-live-publication-'));
try {
  await database.pool.query(
    `UPDATE publication_requests
        SET status = 'failed', completed_at = now(), error_code = 'verification_recovery'
      WHERE tenant_id = $1 AND site_id = $2 AND status IN ('queued', 'building')
        AND idempotency_key LIKE 'verification-%'`,
    [ids.tenantId, ids.siteId],
  );
  const content = new PostgresContentRepository(pool);
  const context = {
    role: 'customer_owner',
    siteId: ids.siteId,
    tenantId: ids.tenantId,
    traceId: `verification-${randomUUID()}`,
    userId: ids.userId,
  };
  const draft = await content.createDraft(context);
  const updated = await content.updateDraftField(context, {
    draftId: draft.id,
    expectedVersion: draft.version,
    fieldId: 'home.heading',
    value: `Verified immutable publication ${randomUUID()}`,
  });
  if (updated.version !== draft.version + 1) throw new Error('Draft optimistic update failed');

  const artifacts = new LocalArtifactStore(join(temporary, 'artifacts'));
  const state = new PostgresPublicationState(pool, artifacts);
  const builder = new LocalPublicationBuilder(
    pool,
    new PostgresSnapshotMaterializer(pool),
    artifacts,
    {
      codeSha: 'a'.repeat(40),
      repositoryRoot: process.cwd(),
      sites: discoverSiteBuildDefinitions(process.cwd()),
    },
  );
  const normal = dependencies(state, (request) => builder.build(request));
  const requestRepository = new PostgresPublicationRequestRepository(pool);

  const publishKey = `verification-publish-${randomUUID()}`;
  const prepared = await content.prepareDraftPublication(context, {
    draftId: draft.id,
    idempotencyKey: publishKey,
    reason: 'Local database-backed publication verification',
  });
  const publishRequest = await requestRepository.load({
    idempotencyKey: publishKey,
    siteId: ids.siteId,
    tenantId: ids.tenantId,
    traceId: context.traceId,
  });
  const published = await new PublicationOrchestrator(normal).publish(publishRequest);
  if (published.status !== 'published' || !published.artifactHash) {
    throw new Error('Draft publication did not activate a verified artifact');
  }
  const firstActive = await state.activeArtifact(publishRequest);
  if (firstActive !== published.artifactHash) throw new Error('Active artifact pointer mismatch');

  const restoreKey = `verification-restore-${randomUUID()}`;
  await content.prepareRestorePublication(context, {
    idempotencyKey: restoreKey,
    reason: 'Local restoration verification',
    revision: 1,
  });
  const restored = await new PublicationOrchestrator(normal).publish(
    await requestRepository.load({
      idempotencyKey: restoreKey,
      siteId: ids.siteId,
      tenantId: ids.tenantId,
      traceId: context.traceId,
    }),
  );
  if (restored.status !== 'published' || restored.previousArtifact !== firstActive) {
    throw new Error('Restoration did not preserve the prior artifact trail');
  }

  const failureDraft = await content.createDraft(context);
  const failureKey = `verification-failure-${randomUUID()}`;
  await content.prepareDraftPublication(context, {
    draftId: failureDraft.id,
    idempotencyKey: failureKey,
    reason: 'Injected health-check failure verification',
  });
  const failureRequest = await requestRepository.load({
    idempotencyKey: failureKey,
    siteId: ids.siteId,
    tenantId: ids.tenantId,
    traceId: context.traceId,
  });
  const failing = dependencies(state, (request) => builder.build(request));
  failing.healthCheck = async () => {
    throw new Error('injected verification health failure');
  };
  let failedSafely = false;
  try {
    await new PublicationOrchestrator(failing).publish(failureRequest);
  } catch (error) {
    failedSafely = error instanceof Error && error.message.includes('injected verification');
  }
  if (!failedSafely) throw new Error('Injected publication failure was not surfaced');
  const activeAfterFailure = await state.activeArtifact(failureRequest);
  if (activeAfterFailure !== restored.artifactHash) {
    throw new Error('Failed publication changed the active artifact');
  }
  const failureState = await database.pool.query<{ status: string }>(
    `SELECT status FROM publication_requests
      WHERE tenant_id = $1 AND site_id = $2 AND idempotency_key = $3`,
    [ids.tenantId, ids.siteId, failureKey],
  );
  if (failureState.rows[0]?.status !== 'failed') {
    throw new Error('Failed publication did not record actionable state');
  }
  console.log(
    JSON.stringify({
      activeArtifact: activeAfterFailure,
      check: 'publication-flow',
      failedArtifactPreserved: true,
      ok: true,
      publishedRevision: prepared.contentRevision,
      restoredFrom: 1,
    }),
  );
} finally {
  await database.close();
  await rm(temporary, { force: true, recursive: true });
}

function dependencies(
  state: PostgresPublicationState,
  build: (request: PublishRequest) => Promise<{ artifactHash: string }>,
): PublicationDependencies {
  return {
    activate: (request, artifactHash) => state.activate(request, artifactHash),
    activeArtifact: (request) => state.activeArtifact(request),
    begin: (request, previousArtifact) => state.begin(request, previousArtifact),
    build,
    findResult: (request) => state.findResult(request),
    healthCheck: (request, artifactHash) => state.healthCheck(request, artifactHash),
    lock: (request) => state.lock(request),
    record: (request, result) => state.record(request, result),
    revalidate: (request) => state.revalidate(request),
    rollbackActivation: (request, previousArtifact) =>
      state.rollbackActivation(request, previousArtifact),
  };
}
