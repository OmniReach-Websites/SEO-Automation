import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  BudgetCapExceededError,
  OpenAiProposalProvider,
  ProposalEvaluationError,
  ProviderResponseError,
} from '@omnireach/ai';
import { validateSiteContract } from '@omnireach/contracts';
import { PostgresEmailDeliveryQuota, type EmailDeliveryQuotaPool } from '@omnireach/database';
import { ResendAccountUsageProvider, ResendUrgentEmailAdapter } from '@omnireach/integrations';
import { JobExecutionError, type JobEnvelope } from '@omnireach/queue';
import { auditSite, type AuditPage } from '@omnireach/seo-core';
import {
  AiReviewCycleQuotaExceededError,
  PostgresAiReviewCycleQuota,
  SitePolicyDeniedError,
  withWorkerTransaction,
  type AiReviewCycleQuota,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';
import {
  executeAiAutomation,
  PostgresAiBudgetLedger,
  PostgresAiProposalJobLoader,
  PostgresAiProposalStager,
} from '@omnireach/worker-aio';
import { crawlSite } from '@omnireach/worker-crawler';
import { PostgresAlertCenter } from '@omnireach/worker-monitoring';
import { runQueuedPublication } from '@omnireach/worker-publisher/run-publication';

import type { DurableExecution } from './runtime.ts';
import { runGoogleMetricsSync } from './google-metrics.ts';

export interface JobHandlerContext {
  environment: NodeJS.ProcessEnv;
  execution: DurableExecution;
  pool: TenantTransactionPool;
}

export async function executeCategory(
  envelope: JobEnvelope,
  context: JobHandlerContext,
): Promise<void> {
  switch (envelope.category) {
    case 'publish':
      await runQueuedPublication(context.environment, {
        idempotencyKey: envelope.dedupeKey,
        siteId: envelope.siteId,
        tenantId: envelope.tenantId,
      });
      return;
    case 'crawl':
      await runCrawl(envelope, context);
      return;
    case 'seo_audit':
      await runSeoAudit(envelope, context);
      return;
    case 'health_check':
      await runHealthCheck(envelope, context);
      return;
    case 'aio_proposal':
      await runAiProposal(envelope, context);
      return;
    case 'metrics_sync':
      await runGoogleMetricsSync(envelope, {
        environment: context.environment,
        jobId: context.execution.jobId,
        pool: context.pool,
      });
      return;
    case 'backup':
      throw new JobExecutionError('No approved production handler is configured', 'cancelled');
  }
}

export async function runAiProposal(
  envelope: JobEnvelope,
  context: JobHandlerContext,
  evaluationOverrides?: { reviewCycles: AiReviewCycleQuota },
): Promise<void> {
  if (context.environment.OPENAI_PROVIDER_ENABLED !== 'true') {
    throw new JobExecutionError('AI provider is disabled by policy', 'cancelled');
  }
  const apiKey = requiredEnvironment(context.environment, 'OPENAI_API_KEY');
  const modelSelection = requiredEnvironment(context.environment, 'OPENAI_MODEL_SELECTION');
  const modelAliases = modelAliasEnvironment(context.environment.OPENAI_MODEL_ALIASES_JSON);
  const providerModel = modelAliases[modelSelection];
  if (!providerModel) {
    throw new JobExecutionError('AI model selection is not configured', 'permanent');
  }
  const now = new Date();
  try {
    const material = await new PostgresAiProposalJobLoader(context.pool).load(
      envelope,
      context.execution.jobId,
      modelSelection,
      providerModel,
      now,
    );
    if (material.existingProposalId) return;
    const stager = new PostgresAiProposalStager(context.pool);
    await executeAiAutomation({
      budget: new PostgresAiBudgetLedger(context.pool, context.execution.jobId),
      ...(context.environment.OPENAI_EVALUATION_CAP_USD_MICROS
        ? {
            budgetCapUsdMicros: integerEnvironment(
              context.environment.OPENAI_EVALUATION_CAP_USD_MICROS,
              1_000_000,
              1,
              1_000_000,
            ),
            platformBudgetCapUsdMicros: integerEnvironment(
              context.environment.OPENAI_EVALUATION_CAP_USD_MICROS,
              1_000_000,
              1,
              1_000_000,
            ),
          }
        : {}),
      input: material.input,
      maxOutputTokens: integerEnvironment(
        context.environment.OPENAI_MAX_OUTPUT_TOKENS,
        800,
        1,
        20_000,
      ),
      mode: material.mode,
      modelPrice: material.modelPrice,
      now,
      protectedFacts: material.protectedFacts,
      provider: new OpenAiProposalProvider({
        apiKey,
        maxOutputTokens: integerEnvironment(
          context.environment.OPENAI_MAX_OUTPUT_TOKENS,
          800,
          1,
          20_000,
        ),
        modelAliases,
        modelSelection,
        promptVersion: integerEnvironment(
          context.environment.OPENAI_PROMPT_VERSION,
          1,
          1,
          1_000_000,
        ),
        timeoutMs: integerEnvironment(
          context.environment.OPENAI_TIMEOUT_MS,
          30_000,
          1_000,
          120_000,
        ),
      }),
      providerEnabled: true,
      raiseAlert: async (safeMessage) => {
        await new PostgresAlertCenter(context.pool).report(
          {
            jobId: context.execution.jobId,
            siteId: envelope.siteId,
            tenantId: envelope.tenantId,
          },
          {
            message: safeMessage,
            remediationUrl: '/orap/operations',
            scope: `site:${envelope.siteId}`,
            severity: 'error',
            source: 'automation.ai-proposal',
          },
        );
      },
      reviewCycles:
        evaluationOverrides?.reviewCycles ?? new PostgresAiReviewCycleQuota(context.pool),
      siteId: envelope.siteId,
      stageProposal: (proposal) =>
        stager.stage(
          {
            actorId: material.actorId,
            baseRevision: material.baseRevision,
            currentValue: material.currentValue,
            fieldId: material.fieldId,
            jobId: context.execution.jobId,
            materialId: material.materialId,
            policyVersion: material.policyVersion,
            siteId: envelope.siteId,
            tenantId: envelope.tenantId,
            traceId: envelope.traceId,
          },
          {
            ...proposal,
            evidence: material.evidence,
            expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
            provider: 'openai',
          },
        ),
      tenantId: envelope.tenantId,
    });
  } catch (error) {
    if (error instanceof ProviderResponseError) {
      throw new JobExecutionError(error.message, error.category);
    }
    if (
      error instanceof BudgetCapExceededError ||
      error instanceof AiReviewCycleQuotaExceededError ||
      error instanceof SitePolicyDeniedError
    ) {
      throw new JobExecutionError(error.message, 'cancelled');
    }
    if (error instanceof ProposalEvaluationError) {
      throw new JobExecutionError('AI proposal failed deterministic evaluation', 'permanent');
    }
    throw error;
  }
}

async function runCrawl(envelope: JobEnvelope, context: JobHandlerContext): Promise<void> {
  const limits = {
    maxBytes: integerEnvironment(
      context.environment.CRAWLER_MAX_BYTES,
      2_000_000,
      100_000,
      10_000_000,
    ),
    maxPages: integerEnvironment(context.environment.CRAWLER_MAX_PAGES, 100, 1, 500),
    maxRedirects: integerEnvironment(context.environment.CRAWLER_MAX_REDIRECTS, 5, 0, 10),
    timeoutMs: integerEnvironment(context.environment.CRAWLER_TIMEOUT_MS, 15_000, 1_000, 120_000),
  };
  const input = await workerTransaction(
    context.pool,
    envelope,
    context.execution.jobId,
    async (client) => {
      const site = required(
        (
          await query<{
            automation_stopped: boolean;
            hostname: string;
          }>(
            client,
            `SELECT domain.hostname, COALESCE(control.automation_stopped, false) AS automation_stopped
             FROM sites site
             JOIN domains domain ON domain.tenant_id = site.tenant_id AND domain.site_id = site.id
             LEFT JOIN site_emergency_controls control
               ON control.tenant_id = site.tenant_id AND control.site_id = site.id
            WHERE site.tenant_id = $1 AND site.id = $2 AND site.status = 'active'
              AND domain.kind = 'public' AND domain.active
              AND domain.verification_status = 'verified'`,
            [envelope.tenantId, envelope.siteId],
          )
        ).rows[0],
        'Verified public site domain is unavailable',
      );
      if (site.automation_stopped) {
        throw new JobExecutionError('Site automation is stopped', 'cancelled');
      }
      const run = required(
        (
          await query<{ id: string }>(
            client,
            `INSERT INTO crawl_runs
             (tenant_id, site_id, job_id, method_version, source, start_url, scope,
              limits, state, started_at, expires_at)
           VALUES ($1, $2, $3, 1, 'manifest', $4, $5::jsonb, $6::jsonb,
                   'running', now(), now() + interval '90 days')
           RETURNING id`,
            [
              envelope.tenantId,
              envelope.siteId,
              context.execution.jobId,
              `https://${site.hostname}/`,
              JSON.stringify({ hostname: site.hostname, ownedSiteMode: true }),
              JSON.stringify(limits),
            ],
          )
        ).rows[0],
        'Crawl run could not be created',
      );
      return { runId: run.id, startUrl: `https://${site.hostname}/` };
    },
  );
  try {
    const evidence = await crawlSite({
      ...limits,
      fetchRaw,
      ownedSiteMode: true,
      resolveHostname: async (hostname) =>
        (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address),
      startUrl: input.startUrl,
    });
    await workerTransaction(context.pool, envelope, context.execution.jobId, async (client) => {
      for (const page of evidence) {
        await client.query(
          `INSERT INTO crawl_pages
             (tenant_id, site_id, crawl_run_id, url, status, content_type, evidence,
              truncated, fetched_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())
           ON CONFLICT (crawl_run_id, url) DO NOTHING`,
          [
            envelope.tenantId,
            envelope.siteId,
            input.runId,
            page.url,
            page.status,
            page.contentType,
            JSON.stringify(page),
            page.truncated,
          ],
        );
      }
      await client.query(
        `UPDATE crawl_runs SET state = $4, completed_at = now()
          WHERE tenant_id = $1 AND site_id = $2 AND id = $3`,
        [
          envelope.tenantId,
          envelope.siteId,
          input.runId,
          evidence.length >= limits.maxPages ? 'truncated' : 'succeeded',
        ],
      );
    });
  } catch (error) {
    await workerTransaction(context.pool, envelope, context.execution.jobId, async (client) => {
      await client.query(
        `UPDATE crawl_runs SET state = 'failed', completed_at = now()
          WHERE tenant_id = $1 AND site_id = $2 AND id = $3 AND state = 'running'`,
        [envelope.tenantId, envelope.siteId, input.runId],
      );
    });
    throw error;
  }
}

async function runSeoAudit(envelope: JobEnvelope, context: JobHandlerContext): Promise<void> {
  const material = await workerTransaction(
    context.pool,
    envelope,
    context.execution.jobId,
    async (client) => {
      const site = required(
        (
          await query<{ automation_stopped: boolean; hostname: string; source_path: string }>(
            client,
            `SELECT domain.hostname, site.source_path,
                    COALESCE(control.automation_stopped, false) AS automation_stopped
               FROM sites site
               JOIN domains domain ON domain.tenant_id = site.tenant_id AND domain.site_id = site.id
               LEFT JOIN site_emergency_controls control
                 ON control.tenant_id = site.tenant_id AND control.site_id = site.id
              WHERE site.tenant_id = $1 AND site.id = $2
                AND domain.kind = 'public' AND domain.active
                AND domain.verification_status = 'verified'`,
            [envelope.tenantId, envelope.siteId],
          )
        ).rows[0],
        'SEO site inputs are unavailable',
      );
      if (site.automation_stopped) {
        throw new JobExecutionError('Site automation is stopped', 'cancelled');
      }
      const crawl = required(
        (
          await query<{ id: string }>(
            client,
            `SELECT id FROM crawl_runs
              WHERE tenant_id = $1 AND site_id = $2 AND state IN ('succeeded','truncated')
              ORDER BY completed_at DESC LIMIT 1`,
            [envelope.tenantId, envelope.siteId],
          )
        ).rows[0],
        'A completed crawl is required before SEO analysis',
      );
      const pages = await query<{ evidence: Record<string, unknown> }>(
        client,
        `SELECT evidence FROM crawl_pages
          WHERE tenant_id = $1 AND site_id = $2 AND crawl_run_id = $3 ORDER BY url`,
        [envelope.tenantId, envelope.siteId, crawl.id],
      );
      const run = required(
        (
          await query<{ id: string }>(
            client,
            `INSERT INTO audit_runs
               (tenant_id, site_id, crawl_run_id, kind, rule_set_version, state,
                limitations, started_at)
             VALUES ($1, $2, $3, 'seo', 1, 'running', $4::jsonb, now())
             RETURNING id`,
            [
              envelope.tenantId,
              envelope.siteId,
              crawl.id,
              JSON.stringify(['HTML body text is not retained; content fact checks are omitted']),
            ],
          )
        ).rows[0],
        'SEO audit run could not be created',
      );
      return {
        auditRunId: run.id,
        hostname: site.hostname,
        pages: pages.rows,
        sourcePath: site.source_path,
      };
    },
  );
  const repositoryRoot = resolve(context.environment.REPOSITORY_ROOT?.trim() || '.');
  const contract = validateSiteContract(
    JSON.parse(
      await readFile(resolve(repositoryRoot, material.sourcePath, 'site.manifest.json'), 'utf8'),
    ),
  );
  const origin = `https://${material.hostname}`;
  const pages = material.pages.map(({ evidence }) => auditPage(evidence));
  const findings = auditSite({
    manifestRoutes: contract.routes.map(({ path }) => new URL(path, origin).href),
    pages,
  });
  await workerTransaction(context.pool, envelope, context.execution.jobId, async (client) => {
    for (const finding of findings) {
      await client.query(
        `INSERT INTO findings
           (tenant_id, site_id, audit_run_id, fingerprint, rule_id, rule_version,
            severity, state, evidence, limitation, remediation, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8::jsonb, $9, $10, now(), now())
         ON CONFLICT (tenant_id, site_id, fingerprint) DO UPDATE SET
           audit_run_id = EXCLUDED.audit_run_id, severity = EXCLUDED.severity,
           evidence = EXCLUDED.evidence, limitation = EXCLUDED.limitation,
           remediation = EXCLUDED.remediation, last_seen_at = now(),
           state = CASE WHEN findings.state = 'resolved' THEN 'open' ELSE findings.state END,
           resolved_at = NULL`,
        [
          envelope.tenantId,
          envelope.siteId,
          material.auditRunId,
          finding.fingerprint,
          finding.ruleId,
          finding.ruleVersion,
          finding.severity,
          JSON.stringify(finding.evidence),
          finding.limitation,
          finding.remediation,
        ],
      );
    }
    await client.query(
      `UPDATE audit_runs SET state = 'succeeded', completed_at = now()
        WHERE tenant_id = $1 AND site_id = $2 AND id = $3`,
      [envelope.tenantId, envelope.siteId, material.auditRunId],
    );
  });
}

async function runHealthCheck(envelope: JobEnvelope, context: JobHandlerContext): Promise<void> {
  const domain = await workerTransaction(
    context.pool,
    envelope,
    context.execution.jobId,
    async (client) =>
      required(
        (
          await query<{ hostname: string }>(
            client,
            `SELECT hostname FROM domains
              WHERE tenant_id = $1 AND site_id = $2 AND kind = 'public'
                AND active AND verification_status = 'verified'`,
            [envelope.tenantId, envelope.siteId],
          )
        ).rows[0],
        'Verified public domain is unavailable',
      ),
  );
  try {
    const response = await fetch(`https://${domain.hostname}/`, {
      headers: { 'user-agent': 'OmniReach-Health/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    const email = await alertEmailAdapter(context, envelope);
    await new PostgresAlertCenter(context.pool).report(
      {
        jobId: context.execution.jobId,
        siteId: envelope.siteId,
        tenantId: envelope.tenantId,
      },
      {
        message: 'Public site health check failed',
        remediationUrl: '/orap/operations',
        scope: `site:${envelope.siteId}`,
        severity: 'critical',
        source: 'monitoring.public-site',
      },
      email,
    );
    throw new JobExecutionError('Public site health check failed', 'retryable');
  }
}

async function alertEmailAdapter(context: JobHandlerContext, envelope: JobEnvelope) {
  if (context.environment.ALERT_EMAIL_DELIVERY_ENABLED !== 'true') return undefined;
  const apiKey = context.environment.RESEND_API_KEY?.trim();
  const from = context.environment.RESEND_ALERT_FROM?.trim();
  if (!apiKey || !from) {
    throw new JobExecutionError('Alert email configuration is incomplete', 'permanent');
  }
  const recipients = await workerTransaction(
    context.pool,
    envelope,
    context.execution.jobId,
    async (client) =>
      (
        await query<{ normalized_email: string }>(
          client,
          'SELECT normalized_email FROM active_platform_owner_alert_recipients()',
        )
      ).rows.map((row) => row.normalized_email),
  );
  if (recipients.length === 0) {
    throw new JobExecutionError('No active Platform Owner alert recipients exist', 'permanent');
  }
  const quota = new PostgresEmailDeliveryQuota(
    context.pool as unknown as EmailDeliveryQuotaPool,
    'omnireach_worker',
    new ResendAccountUsageProvider({ apiKey }),
  );
  return new ResendUrgentEmailAdapter({ apiKey, from, quota, recipients });
}

function auditPage(evidence: Record<string, unknown>): AuditPage {
  const url = String(evidence.url ?? '');
  const links = stringArray(evidence.links);
  const images = Array.isArray(evidence.images)
    ? evidence.images.flatMap((value) => {
        if (!record(value) || typeof value.src !== 'string') return [];
        return [{ alt: typeof value.alt === 'string' ? value.alt : null, src: value.src }];
      })
    : [];
  const metadata = record(evidence.metadata)
    ? Object.fromEntries(
        Object.entries(evidence.metadata).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
  return {
    ...(typeof evidence.canonical === 'string' ? { canonical: evidence.canonical } : {}),
    headings: stringArray(evidence.headings),
    images,
    indexable: Number(evidence.status) >= 200 && Number(evidence.status) < 400,
    links,
    metadata,
    mixedContent:
      links.some((link) => link.startsWith('http://')) ||
      images.some((image) => image.src.startsWith('http://')),
    securityHeaders: true,
    sitemapMember: true,
    status: Number(evidence.status),
    structuredDataCount: Number(evidence.structuredDataCount ?? 0),
    text: '',
    url,
  };
}

async function fetchRaw(url: URL, maximumBytes: number, timeoutMs: number) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'OmniReach-Crawler/1.0' },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maximumBytes)
    throw new JobExecutionError('Crawl response exceeds byte limit', 'permanent');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes)
    throw new JobExecutionError('Crawl response exceeds byte limit', 'permanent');
  return {
    body: new TextDecoder().decode(bytes),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    headers: Object.fromEntries(response.headers.entries()),
    status: response.status,
  };
}

function workerTransaction<T>(
  pool: TenantTransactionPool,
  envelope: JobEnvelope,
  jobId: string,
  operation: (client: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  return withWorkerTransaction(
    pool,
    { jobId, siteId: envelope.siteId, tenantId: envelope.tenantId },
    operation,
  );
}
function integerEnvironment(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error('Worker limit is invalid');
  return value;
}
function modelAliasEnvironment(raw: string | undefined): Readonly<Record<string, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '{}');
  } catch {
    throw new JobExecutionError('AI model aliases are invalid', 'permanent');
  }
  if (
    !record(parsed) ||
    Object.keys(parsed).length > 20 ||
    Object.entries(parsed).some(
      ([alias, model]) =>
        !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(alias) ||
        typeof model !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u.test(model),
    )
  ) {
    throw new JobExecutionError('AI model aliases are invalid', 'permanent');
  }
  return parsed as Record<string, string>;
}
function requiredEnvironment(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new JobExecutionError('AI provider configuration is incomplete', 'permanent');
  return value;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values?: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
