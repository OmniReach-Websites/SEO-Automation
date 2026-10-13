import { createHash, randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { contractHash, validateSiteContract, type SiteContract } from '@omnireach/contracts';
import { createDatabase } from '@omnireach/database';

import {
  defaultCoopContent,
  defaultCoopFacts,
} from '../sites/coops-mobile-detailing/src/data/site.ts';

const sourcePath = 'sites/coops-mobile-detailing';
const publicHostname = 'coopsmobiledetailingaledo.com';
const adminHostname = 'admin.coopsmobiledetailingaledo.com';

export interface CoopOnboardingInput {
  adminHostVerified?: boolean;
  factsReviewed?: boolean;
  invitationOutput?: string;
  invitedByUserId?: string;
  ownerEmail?: string;
  planCode?: string;
  planVersion?: number;
  publicHostVerified?: boolean;
  siteName?: string;
  tenantName?: string;
}

export interface ReadinessCheck {
  detail: string;
  id: string;
  ready: boolean;
  status: 'blocked' | 'ready' | 'warning';
}

export interface CoopReadinessReport {
  checks: ReadinessCheck[];
  ready: boolean;
  siteId?: string;
  tenantId?: string;
}

interface QueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function diagnoseCoop(
  client: QueryClient,
  options: { checkDns?: boolean } = {},
): Promise<CoopReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const sites = await client.query(
    `SELECT s.id, s.tenant_id, s.name, s.status, s.source_path,
            s.contract_version, s.contract_hash
       FROM sites s
      WHERE s.source_path = $1
         OR EXISTS (
           SELECT 1 FROM domains d
            WHERE d.tenant_id = s.tenant_id AND d.site_id = s.id
              AND d.hostname IN ($2, $3)
         )`,
    [sourcePath, publicHostname, adminHostname],
  );
  const site = sites.rows.length === 1 ? sites.rows[0] : undefined;
  checks.push(
    check(
      'site-record',
      sites.rows.length === 1,
      sites.rows.length === 0
        ? 'Coop site record is missing'
        : sites.rows.length === 1
          ? 'Exactly one Coop site record exists'
          : 'Conflicting Coop site records exist',
    ),
  );
  if (!site) return finish(checks);

  const tenantId = String(site.tenant_id);
  const siteId = String(site.id);
  const manifest = await loadContract();
  checks.push(
    check('site-active', site.status === 'active', `Site status is ${String(site.status)}`),
  );
  checks.push(
    check(
      'contract-current',
      site.contract_version === manifest.version && site.contract_hash === contractHash(manifest),
      'Stored site contract identity matches the repository manifest',
    ),
  );

  const domains = await client.query(
    `SELECT hostname, kind, verification_status, active, onboarding_state
       FROM domains WHERE tenant_id = $1 AND site_id = $2
         AND hostname IN ($3, $4) ORDER BY hostname`,
    [tenantId, siteId, publicHostname, adminHostname],
  );
  for (const expected of [
    { hostname: publicHostname, kind: 'public' },
    { hostname: adminHostname, kind: 'admin' },
  ]) {
    const domain = domains.rows.find((row) => row.hostname === expected.hostname);
    checks.push(
      check(
        `domain-${expected.kind}`,
        domain?.kind === expected.kind &&
          domain.verification_status === 'verified' &&
          domain.active === true,
        domain
          ? `${expected.hostname}: ${String(domain.verification_status)}, active=${String(domain.active)}`
          : `${expected.hostname} record is missing`,
      ),
    );
  }

  const subscription = await client.query(
    `SELECT p.code, p.version, s.status
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.tenant_id = $1 AND s.site_id = $2`,
    [tenantId, siteId],
  );
  checks.push(
    check(
      'plan-assignment',
      subscription.rows.length === 1 &&
        ['active', 'past_due'].includes(String(subscription.rows[0]?.status)),
      subscription.rows[0]
        ? `Plan ${String(subscription.rows[0].code)} v${String(subscription.rows[0].version)} is ${String(subscription.rows[0].status)}`
        : 'No site plan is assigned',
    ),
  );

  const features = await client.query(
    `SELECT feature.key, effective.enabled
       FROM feature_definitions feature
       LEFT JOIN LATERAL (
         SELECT COALESCE(override.enabled, plan_feature.enabled, feature.safe_default) AS enabled
           FROM subscriptions subscription
           LEFT JOIN plan_features plan_feature
             ON plan_feature.plan_id = subscription.plan_id
            AND plan_feature.feature_key = feature.key
           LEFT JOIN site_feature_overrides override
             ON override.tenant_id = subscription.tenant_id
            AND override.site_id = subscription.site_id
            AND override.feature_key = feature.key
          WHERE subscription.tenant_id = $1 AND subscription.site_id = $2
       ) effective ON true
      WHERE feature.key IN ('content.edit', 'content.publish')`,
    [tenantId, siteId],
  );
  for (const feature of ['content.edit', 'content.publish']) {
    const row = features.rows.find((entry) => entry.key === feature);
    checks.push(
      check(
        `feature-${feature}`,
        row?.enabled === true,
        `${feature} enabled=${String(row?.enabled ?? false)}`,
      ),
    );
  }

  const owners = await client.query(
    `SELECT u.normalized_email
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = $1 AND m.site_id = $2
        AND m.role = 'customer_owner' AND m.active`,
    [tenantId, siteId],
  );
  const invitations = await client.query(
    `SELECT normalized_email FROM customer_invitations
      WHERE tenant_id = $1 AND site_id = $2 AND role = 'customer_owner'
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [tenantId, siteId],
  );
  checks.push(
    check(
      'customer-owner',
      owners.rows.length === 1,
      owners.rows.length === 1
        ? 'One active customer owner is present'
        : invitations.rows.length > 0
          ? 'Owner invitation is pending acceptance'
          : 'No active owner or pending owner invitation exists',
      invitations.rows.length > 0 ? 'warning' : undefined,
    ),
  );

  const content = await client.query(
    `SELECT
       (SELECT count(*)::integer FROM content_pages WHERE tenant_id = $1 AND site_id = $2) AS pages,
       (SELECT count(*)::integer FROM content_fields WHERE tenant_id = $1 AND site_id = $2) AS fields,
       (SELECT count(*)::integer FROM business_facts WHERE tenant_id = $1 AND site_id = $2) AS facts,
       (SELECT count(*)::integer FROM content_revisions WHERE tenant_id = $1 AND site_id = $2) AS revisions`,
    [tenantId, siteId],
  );
  const counts = content.rows[0] ?? {};
  checks.push(
    check(
      'content-contract',
      counts.pages === manifest.routes.length && counts.fields === manifest.fields.length,
      `Content records: pages=${String(counts.pages)}, fields=${String(counts.fields)}, facts=${String(counts.facts)}, revisions=${String(counts.revisions)}`,
    ),
  );
  checks.push(
    check(
      'protected-facts',
      counts.facts === manifest.facts.length,
      `Protected facts registered=${String(counts.facts)} expected=${manifest.facts.length}`,
    ),
  );
  checks.push(
    check(
      'baseline-revision',
      Number(counts.revisions) >= 1,
      `Content revisions=${String(counts.revisions)}`,
    ),
  );

  const workers = await client
    .query(
      `SELECT worker_kind, max(last_seen_at) AS last_seen_at
       FROM worker_heartbeats
      WHERE last_seen_at > now() - interval '2 minutes'
      GROUP BY worker_kind`,
    )
    .catch(() => ({ rows: [] }));
  for (const worker of ['scheduler', 'runner', 'publisher', 'crawler', 'seo', 'monitoring']) {
    const online = workers.rows.some((row) => row.worker_kind === worker);
    checks.push(
      check(
        `worker-${worker}`,
        online,
        online ? `${worker} heartbeat is current` : `${worker} heartbeat is missing`,
      ),
    );
  }

  if (options.checkDns) {
    for (const hostname of [publicHostname, adminHostname]) {
      const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
      checks.push(
        check(
          `dns-${hostname}`,
          addresses.length > 0,
          addresses.length > 0
            ? `${hostname} resolves to ${addresses.join(', ')}`
            : `${hostname} has no observable A record`,
        ),
      );
    }
  }
  return finish(checks, tenantId, siteId);
}

export async function onboardCoop(
  client: QueryClient,
  input: CoopOnboardingInput,
): Promise<CoopReadinessReport> {
  const contract = await loadContract();
  const tenantName = input.tenantName?.trim() || "Coop's Mobile Detailing";
  const siteName = input.siteName?.trim() || "Coop's Mobile Detailing";
  if (!input.planCode?.trim())
    throw new Error('planCode is required; commercial plan choice cannot be invented');
  if (!input.planVersion || input.planVersion < 1) throw new Error('planVersion is required');
  await client.query('BEGIN');
  try {
    const conflicts = await client.query(
      `SELECT s.id, s.tenant_id FROM sites s
        WHERE s.source_path = $1 OR EXISTS (
          SELECT 1 FROM domains d WHERE d.site_id = s.id
            AND d.hostname IN ($2, $3)
        ) FOR UPDATE`,
      [sourcePath, publicHostname, adminHostname],
    );
    if (conflicts.rows.length > 1)
      throw new Error('Conflicting Coop site records require manual reconciliation');
    let site = conflicts.rows[0];
    if (!site) {
      const tenant = await client.query(
        `INSERT INTO tenants (name, status) VALUES ($1, 'active') RETURNING id`,
        [tenantName],
      );
      const tenantId = requiredText(tenant.rows[0]?.id, 'Tenant creation failed');
      const created = await client.query(
        `INSERT INTO sites
           (tenant_id, name, status, contract_version, contract_hash, source_path,
            standard_page_count, business_location_count)
         VALUES ($1, $2, 'active', $3, $4, $5, $6, 1)
         RETURNING id, tenant_id`,
        [
          tenantId,
          siteName,
          contract.version,
          contractHash(contract),
          sourcePath,
          contract.routes.length,
        ],
      );
      site = created.rows[0];
    } else {
      await client.query(
        `UPDATE sites SET name = $3, status = 'active', contract_version = $4,
                contract_hash = $5, standard_page_count = $6, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND source_path = $7`,
        [
          site.tenant_id,
          site.id,
          siteName,
          contract.version,
          contractHash(contract),
          contract.routes.length,
          sourcePath,
        ],
      );
    }
    const tenantId = requiredText(site?.tenant_id, 'Tenant identity is unavailable');
    const siteId = requiredText(site?.id, 'Site identity is unavailable');
    await upsertDomain(
      client,
      tenantId,
      siteId,
      publicHostname,
      'public',
      input.publicHostVerified === true,
    );
    await upsertDomain(
      client,
      tenantId,
      siteId,
      adminHostname,
      'admin',
      input.adminHostVerified === true,
    );

    const plan = await client.query(
      `SELECT id FROM plans WHERE code = $1 AND version = $2 AND active LIMIT 2`,
      [input.planCode, input.planVersion],
    );
    if (plan.rows.length !== 1)
      throw new Error('Selected active plan was not found or is ambiguous');
    await client.query(
      `INSERT INTO subscriptions (tenant_id, site_id, plan_id, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (site_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, status = 'active', updated_at = now()
       WHERE subscriptions.tenant_id = EXCLUDED.tenant_id`,
      [tenantId, siteId, plan.rows[0]?.id],
    );
    await synchronizeContent(client, tenantId, siteId, contract, input.factsReviewed === true);
    if (input.ownerEmail) await ensureOwner(client, tenantId, siteId, input);
    await client.query('COMMIT');
    return diagnoseCoop(client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function synchronizeContent(
  client: QueryClient,
  tenantId: string,
  siteId: string,
  contract: SiteContract,
  factsReviewed: boolean,
): Promise<void> {
  const pageIds = new Map<string, string>();
  for (const route of contract.routes) {
    const page = await client.query(
      `INSERT INTO content_pages (tenant_id, site_id, stable_id, route, schema_version)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (tenant_id, site_id, stable_id) DO UPDATE SET
         route = EXCLUDED.route, updated_at = now()
       RETURNING id`,
      [tenantId, siteId, route.id, route.path],
    );
    pageIds.set(route.id, requiredText(page.rows[0]?.id, 'Content page reconciliation failed'));
  }
  for (const field of contract.fields) {
    const pageId = pageIds.get(pageForField(field.id));
    if (!pageId) throw new Error(`No content page mapping exists for ${field.id}`);
    await client.query(
      `INSERT INTO content_fields
         (tenant_id, site_id, page_id, stable_id, field_type, protected, ai_mode, editable_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::varchar(40)[])
       ON CONFLICT (tenant_id, site_id, stable_id) DO UPDATE SET
         page_id = EXCLUDED.page_id, field_type = EXCLUDED.field_type,
         protected = EXCLUDED.protected, ai_mode = EXCLUDED.ai_mode,
         editable_by = EXCLUDED.editable_by`,
      [
        tenantId,
        siteId,
        pageId,
        field.id,
        field.type,
        field.protected,
        field.aiMode,
        field.editableBy,
      ],
    );
  }
  if (factsReviewed) {
    for (const fact of contract.facts) {
      if (!Object.hasOwn(defaultCoopFacts, fact.id))
        throw new Error(`Reviewed fact value is missing: ${fact.id}`);
      await client.query(
        `INSERT INTO business_facts
           (tenant_id, site_id, stable_id, kind, value, provenance, verified_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'owner-reviewed live-site baseline',
           (SELECT user_id FROM platform_memberships WHERE role = 'platform_owner' AND active ORDER BY created_at LIMIT 1))
         ON CONFLICT (tenant_id, site_id, stable_id) DO NOTHING`,
        [tenantId, siteId, fact.id, fact.kind, JSON.stringify(defaultCoopFacts[fact.id])],
      );
    }
  }
  const revisions = await client.query(
    `SELECT count(*)::integer AS count FROM content_revisions
      WHERE tenant_id = $1 AND site_id = $2`,
    [tenantId, siteId],
  );
  if (revisions.rows[0]?.count === 0) {
    const owner = await client.query(
      `SELECT user_id FROM platform_memberships
        WHERE role = 'platform_owner' AND active ORDER BY created_at LIMIT 1`,
    );
    const actorId = requiredText(
      owner.rows[0]?.user_id,
      'An active platform owner is required to attest the baseline',
    );
    const facts = factsReviewed ? defaultCoopFacts : {};
    await client.query(
      `INSERT INTO content_revisions
         (tenant_id, site_id, revision, schema_version, content, facts_snapshot, created_by, origin)
       VALUES ($1, $2, 1, 1, $3::jsonb, $4::jsonb, $5, 'seed')`,
      [tenantId, siteId, JSON.stringify(defaultCoopContent), JSON.stringify(facts), actorId],
    );
  }
}

async function ensureOwner(
  client: QueryClient,
  tenantId: string,
  siteId: string,
  input: CoopOnboardingInput,
): Promise<void> {
  const email = input.ownerEmail?.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/u.test(email)) throw new Error('A valid owner email is required');
  const users = await client.query(`SELECT id FROM users WHERE normalized_email = $1 LIMIT 2`, [
    email,
  ]);
  if (users.rows.length === 1) {
    await client.query(
      `INSERT INTO memberships (tenant_id, site_id, user_id, role, active)
       VALUES ($1, $2, $3, 'customer_owner', true)
       ON CONFLICT (tenant_id, site_id, user_id) DO UPDATE SET role = 'customer_owner', active = true, updated_at = now()`,
      [tenantId, siteId, users.rows[0]?.id],
    );
    return;
  }
  if (!input.invitedByUserId || !input.invitationOutput) {
    throw new Error('A new owner requires invitedByUserId and invitationOutput');
  }
  const pending = await client.query(
    `SELECT token_hash FROM customer_invitations
      WHERE tenant_id = $1 AND site_id = $2 AND normalized_email = $3
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, siteId, email],
  );
  if (pending.rows[0]?.token_hash) {
    try {
      const saved = (await readFile(resolve(input.invitationOutput), 'utf8')).trim();
      const token = new URL(saved.startsWith('http') ? saved : `https://${saved}`).searchParams.get(
        'token',
      );
      if (
        token &&
        createHash('sha256').update(token).digest('hex') === pending.rows[0].token_hash
      ) {
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  await client.query(
    `UPDATE customer_invitations SET revoked_at = now()
      WHERE tenant_id = $1 AND site_id = $2 AND normalized_email = $3
        AND accepted_at IS NULL AND revoked_at IS NULL`,
    [tenantId, siteId, email],
  );
  await client.query(
    `INSERT INTO customer_invitations
       (tenant_id, site_id, normalized_email, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, 'customer_owner', $4, $5, now() + interval '7 days')`,
    [tenantId, siteId, email, digest, input.invitedByUserId],
  );
  await writeFile(
    resolve(input.invitationOutput),
    `${adminHostname}/accept-invitation?token=${token}\n`,
    { flag: 'wx', mode: 0o600 },
  );
}

async function upsertDomain(
  client: QueryClient,
  tenantId: string,
  siteId: string,
  hostname: string,
  kind: string,
  verified: boolean,
): Promise<void> {
  const existing = await client.query(
    `SELECT tenant_id, site_id, kind FROM domains WHERE hostname = $1 FOR UPDATE`,
    [hostname],
  );
  const row = existing.rows[0];
  if (row && (row.tenant_id !== tenantId || row.site_id !== siteId || row.kind !== kind)) {
    throw new Error(`Hostname ${hostname} is assigned to another scope`);
  }
  await client.query(
    `INSERT INTO domains
       (tenant_id, site_id, hostname, kind, verification_status, onboarding_state, active, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 THEN now() ELSE NULL END)
     ON CONFLICT (hostname) DO UPDATE SET
       verification_status = CASE WHEN EXCLUDED.active THEN 'verified' ELSE domains.verification_status END,
       onboarding_state = CASE WHEN EXCLUDED.active THEN 'active' ELSE domains.onboarding_state END,
       active = domains.active OR EXCLUDED.active,
       verified_at = CASE WHEN EXCLUDED.active THEN COALESCE(domains.verified_at, now()) ELSE domains.verified_at END`,
    [
      tenantId,
      siteId,
      hostname,
      kind,
      verified ? 'verified' : 'pending',
      verified ? 'active' : 'requested',
      verified,
    ],
  );
}

function pageForField(fieldId: string): string {
  if (fieldId.startsWith('services.')) return 'services';
  if (fieldId.startsWith('portfolio.')) return 'our-work';
  if (fieldId.startsWith('about.')) return 'about';
  if (fieldId.startsWith('contact.')) return 'contact';
  if (fieldId.startsWith('privacy.')) return 'privacy';
  return 'home';
}
function check(id: string, ready: boolean, detail: string, readyState?: 'warning'): ReadinessCheck {
  return { detail, id, ready, status: ready ? (readyState ?? 'ready') : 'blocked' };
}
function finish(checks: ReadinessCheck[], tenantId?: string, siteId?: string): CoopReadinessReport {
  return {
    checks,
    ready: checks.every((entry) => entry.ready),
    ...(tenantId ? { tenantId } : {}),
    ...(siteId ? { siteId } : {}),
  };
}
function requiredText(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value) throw new Error(message);
  return value;
}
async function loadContract(): Promise<SiteContract> {
  return validateSiteContract(
    JSON.parse(await readFile(resolve(sourcePath, 'site.manifest.json'), 'utf8')),
  );
}

function parseArguments(values: string[]): { apply: boolean; checkDns: boolean; config?: string } {
  const parsed = { apply: false, checkDns: false } as {
    apply: boolean;
    checkDns: boolean;
    config?: string;
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--apply') parsed.apply = true;
    else if (value === '--check-dns') parsed.checkDns = true;
    else if (value === '--config') {
      const config = values[++index];
      if (!config) throw new Error('--config requires a path');
      parsed.config = config;
    } else throw new Error(`Unknown argument: ${String(value)}`);
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const options = parseArguments(process.argv.slice(2));
  const input = options.config
    ? (JSON.parse(await readFile(resolve(options.config), 'utf8')) as CoopOnboardingInput)
    : {};
  const database = createDatabase(databaseUrl);
  try {
    const report = options.apply
      ? await onboardCoop(database.pool as unknown as QueryClient, input)
      : await diagnoseCoop(database.pool as unknown as QueryClient, { checkDns: options.checkDns });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } finally {
    await database.close();
  }
}
