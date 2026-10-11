import { resolve } from 'node:path';

import { createDatabase } from '@omnireach/database';
import { createLogger, createTraceId } from '@omnireach/observability';
import type { TenantTransactionPool } from '@omnireach/tenant';

import { LocalArtifactStore } from './artifacts.ts';
import { LocalPublicationBuilder } from './local-builder.ts';
import { PostgresPublicationState } from './postgres-publication.ts';
import { PostgresPublicationRequestRepository } from './postgres-request.ts';
import { PostgresSnapshotMaterializer } from './postgres-snapshot.ts';
import { PublicationOrchestrator, type PublicationDependencies } from './publication.ts';
import { discoverSiteBuildDefinitions } from './site-definitions.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

export interface PublicationWorkerInput {
  idempotencyKey: string;
  siteId: string;
  tenantId: string;
}

export async function runQueuedPublication(
  environment: NodeJS.ProcessEnv,
  input: PublicationWorkerInput,
): Promise<void> {
  validateInput(input);
  const databaseUrl = required(environment, 'DATABASE_URL');
  const codeSha = required(environment, 'SOURCE_COMMIT_SHA');
  if (!sha.test(codeSha)) throw new Error('SOURCE_COMMIT_SHA must be a verified commit SHA');
  const repositoryRoot = resolve(environment.REPOSITORY_ROOT?.trim() || '.');
  const artifactsRoot = resolve(
    environment.PUBLICATION_STORAGE_ROOT?.trim() || 'runtime-data/publications',
  );
  const database = createDatabase(databaseUrl);
  const pool = database.pool as unknown as TenantTransactionPool;
  const artifacts = new LocalArtifactStore(artifactsRoot);
  const state = new PostgresPublicationState(pool, artifacts);
  const builder = new LocalPublicationBuilder(
    pool,
    new PostgresSnapshotMaterializer(pool),
    artifacts,
    {
      codeSha,
      repositoryRoot,
      sites: discoverSiteBuildDefinitions(repositoryRoot),
    },
  );
  const dependencies: PublicationDependencies = {
    activate: (request, artifactHash) => state.activate(request, artifactHash),
    activeArtifact: (request) => state.activeArtifact(request),
    begin: (request, previousArtifact) => state.begin(request, previousArtifact),
    build: (request) => builder.build(request),
    findResult: (request) => state.findResult(request),
    healthCheck: (request, artifactHash) => state.healthCheck(request, artifactHash),
    lock: (request) => state.lock(request),
    record: (request, result) => state.record(request, result),
    revalidate: (request) => state.revalidate(request),
    rollbackActivation: (request, previousArtifact) =>
      state.rollbackActivation(request, previousArtifact),
  };
  try {
    const request = await new PostgresPublicationRequestRepository(pool).load({
      ...input,
      traceId: createTraceId(),
    });
    await new PublicationOrchestrator(dependencies).publish(request);
  } finally {
    await database.close();
  }
}

function validateInput(input: PublicationWorkerInput): void {
  if (!uuid.test(input.tenantId) || !uuid.test(input.siteId)) {
    throw new Error('Publication tenant and site IDs must be UUIDs');
  }
  if (
    !input.idempotencyKey ||
    input.idempotencyKey.length > 160 ||
    !/^[A-Za-z0-9._:-]+$/u.test(input.idempotencyKey)
  ) {
    throw new Error('Publication idempotency key is invalid');
  }
}

function required(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function parseArguments(arguments_: string[]): PublicationWorkerInput {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('Invalid publication arguments');
    values.set(key.slice(2), value);
  }
  return {
    idempotencyKey: values.get('key') ?? '',
    siteId: values.get('site-id') ?? '',
    tenantId: values.get('tenant-id') ?? '',
  };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
  runQueuedPublication(process.env, parseArguments(process.argv.slice(2)))
    .then(() => logger.info('Publication request completed'))
    .catch((error: unknown) => {
      logger.error({ error }, 'Publication request failed');
      process.exitCode = 1;
    });
}
