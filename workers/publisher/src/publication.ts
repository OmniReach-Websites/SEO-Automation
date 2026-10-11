export interface PublishRequest {
  actorId: string;
  contentRevision: number;
  editorPublishGrant: boolean;
  idempotencyKey: string;
  origin: 'customer' | 'orap' | 'restore';
  reason: string;
  role: string;
  siteId: string;
  tenantId: string;
  traceId: string;
}

export interface PublishResult {
  artifactHash?: string;
  previousArtifact?: string;
  requestKey: string;
  status: 'published' | 'failed';
}

export interface PublicationDependencies {
  activate(request: PublishRequest, artifactHash: string): Promise<void>;
  activeArtifact(request: PublishRequest): Promise<string | undefined>;
  begin(
    request: PublishRequest,
    previousArtifact: string | undefined,
  ): Promise<PublishResult | undefined>;
  build(request: PublishRequest): Promise<{ artifactHash: string }>;
  findResult(request: PublishRequest): Promise<PublishResult | undefined>;
  healthCheck(request: PublishRequest, artifactHash: string): Promise<void>;
  lock(request: PublishRequest): Promise<false | (() => Promise<void>)>;
  record(request: PublishRequest, result: PublishResult): Promise<void>;
  revalidate(request: PublishRequest): Promise<void>;
  rollbackActivation(request: PublishRequest, previousArtifact: string | undefined): Promise<void>;
}

export class PublicationOrchestrator {
  constructor(private readonly dependencies: PublicationDependencies) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    authorizePublish(request);
    if (!request.reason.trim()) throw new Error('Publication reason is required');
    const existing = await this.dependencies.findResult(request);
    if (existing) return existing;
    const release = await this.dependencies.lock(request);
    if (!release) throw new Error('A publication is already running for this site');
    const previousArtifact = await this.dependencies.activeArtifact(request);
    let activated = false;
    try {
      const raced = await this.dependencies.begin(request, previousArtifact);
      if (raced) return raced;
      await this.dependencies.revalidate(request);
      const build = await this.dependencies.build(request);
      await this.dependencies.healthCheck(request, build.artifactHash);
      await this.dependencies.activate(request, build.artifactHash);
      activated = true;
      const result: PublishResult = {
        artifactHash: build.artifactHash,
        ...(previousArtifact ? { previousArtifact } : {}),
        requestKey: request.idempotencyKey,
        status: 'published',
      };
      await this.dependencies.record(request, result);
      return result;
    } catch (error) {
      if (activated) {
        await this.dependencies.rollbackActivation(request, previousArtifact);
      }
      const result: PublishResult = {
        ...(previousArtifact ? { previousArtifact } : {}),
        requestKey: request.idempotencyKey,
        status: 'failed',
      };
      try {
        await this.dependencies.record(request, result);
      } catch {
        // Preserve the triggering failure. The caller/alert path must report persistence failure too.
      }
      throw error;
    } finally {
      await release();
    }
  }
}

function authorizePublish(request: PublishRequest): void {
  const allowed =
    ['platform_owner', 'platform_admin', 'staff', 'customer_owner'].includes(request.role) ||
    (request.role === 'customer_editor' && request.editorPublishGrant);
  if (!allowed) throw new Error('Publish permission denied');
}
