import { createHash, randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { contractHash, validateSiteContract, type SiteContract } from '@omnireach/contracts';
import { createDatabase } from '@omnireach/database';

export interface SiteOnboardingConfig {
  adminHostVerified?: boolean;
  adminHostname: string;
  content: Record<string, unknown>;
  facts?: Record<string, unknown>;
  factsReviewed?: boolean;
  invitationOutput?: string;
  invitedByUserId?: string;
  ownerEmail?: string;
  planCode: string;
  planVersion: number;
  publicHostVerified?: boolean;
  publicHostname: string;
  siteName: string;
  sourcePath: string;
  tenantName: string;
}

export interface SiteReadinessCheck {
  detail: string;
  id: string;
  status: 'blocked' | 'ready' | 'waiting' | 'warning';
}

export interface SiteReadinessReport {
  checks: SiteReadinessCheck[];
  ready: boolean;
  siteId?: string;
  tenantId?: string;
}

interface QueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function diagnoseSite(
  client: QueryClient,
  config: SiteOnboardingConfig,
  options: { checkDns?: boolean } = {},
): Promise<SiteReadinessReport> {
  const contract = await loadContract(config.sourcePath);
  validateConfig(config, contract);
  const checks: SiteReadinessCheck[] = [];
  const sites = await client.query(
    `SELECT id, tenant_id, status, contract_version, contract_hash
       FROM sites
      WHERE source_path = $1
         OR EXISTS (
           SELECT 1 FROM domains
            WHERE domains.site_id = sites.id AND hostname IN ($2, $3)
         )`,
    [config.sourcePath, config.publicHostname, config.adminHostname],
  );
  checks.push(
    check('site-record', sites.rows.length === 1, `${sites.rows.length} matching site record(s)`),
  );
  const site = sites.rows.length === 1 ? sites.rows[0] : undefined;
  if (!site) return finish(checks);
  const tenantId = requiredText(site.tenant_id, 'Tenant identity is unavailable');
  const siteId = requiredText(site.id, 'Site identity is unavailable');
  checks.push(
    check('site-active', site.status === 'active', `Site status is ${String(site.status)}`),
  );
  checks.push(
    check(
      'contract-current',
      site.contract_version === contract.version && site.contract_hash === contractHash(contract),
      'Stored contract matches the repository manifest',
    ),
  );

  const domains = await client.query(
    `SELECT hostname, kind, verification_status, active
       FROM domains WHERE tenant_id = $1 AND site_id = $2`,
    [tenantId, siteId],
  );
  for (const expected of [
    { hostname: config.publicHostname, kind: 'public' },
    { hostname: config.adminHostname, kind: 'admin' },
  ]) {
    const row = domains.rows.find((domain) => domain.hostname === expected.hostname);
    checks.push(
      check(
        `domain-${expected.kind}`,
        row?.kind === expected.kind &&
          row.active === true &&
          row.verification_status === 'verified',
        row
          ? `${expected.hostname}: ${String(row.verification_status)}, active=${String(row.active)}`
          : `${expected.hostname} is not registered`,
      ),
    );
  }

  const plan = await client.query(
    `SELECT plan.code, plan.version, subscription.status
       FROM subscriptions subscription JOIN plans plan ON plan.id = subscription.plan_id
      WHERE subscription.tenant_id = $1 AND subscription.site_id = $2`,
    [tenantId, siteId],
  );
  const assignedPlan = plan.rows.length === 1 ? plan.rows[0] : undefined;
  checks.push(
    check(
      'plan-assignment',
      assignedPlan?.code === config.planCode &&
        assignedPlan.version === config.planVersion &&
        assignedPlan.status === 'active',
      assignedPlan
        ? `${String(assignedPlan.code)} v${String(assignedPlan.version)} (${String(assignedPlan.status)})`
        : 'No plan is assigned',
    ),
  );
  const identity = await client.query(
    `SELECT
       (SELECT count(*)::integer FROM memberships membership
         WHERE membership.tenant_id = $1 AND membership.site_id = $2
           AND membership.role = 'customer_owner' AND membership.active) AS owners,
       (SELECT count(*)::integer FROM customer_invitations invitation
         WHERE invitation.tenant_id = $1 AND invitation.site_id = $2
           AND invitation.role = 'customer_owner' AND invitation.accepted_at IS NULL
           AND invitation.revoked_at IS NULL AND invitation.expires_at > now()) AS invitations`,
    [tenantId, siteId],
  );
  const ownerCount = Number(identity.rows[0]?.owners ?? 0);
  const invitationCount = Number(identity.rows[0]?.invitations ?? 0);
  checks.push(
    ownerCount === 1
      ? check('customer-owner', true, 'One active customer owner is present')
      : waiting(
          'customer-owner',
          invitationCount > 0
            ? 'Owner invitation awaits customer acceptance'
            : 'Owner identity or invitation is missing',
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
      'content-mapping',
      Number(counts.pages) === contract.routes.length &&
        Number(counts.fields) === contract.fields.length,
      `pages=${String(counts.pages)}, fields=${String(counts.fields)}, revisions=${String(counts.revisions)}`,
    ),
  );
  checks.push(
    config.factsReviewed
      ? check(
          'protected-facts',
          Number(counts.facts) === contract.facts.length,
          `facts=${String(counts.facts)} expected=${contract.facts.length}`,
        )
      : waiting('protected-facts', 'Owner fact review has not been attested'),
  );

  const workers = await client
    .query(
      `SELECT worker_kind FROM worker_heartbeats
        WHERE last_seen_at > now() - interval '2 minutes'
        GROUP BY worker_kind`,
    )
    .catch(() => ({ rows: [] }));
  for (const kind of ['scheduler', 'runner', 'publisher', 'crawler', 'seo', 'monitoring']) {
    checks.push(
      warning(
        `worker-${kind}`,
        workers.rows.some((row) => row.worker_kind === kind)
          ? `${kind} heartbeat is current`
          : `${kind} heartbeat is not current in this environment`,
      ),
    );
  }
  const integrations = await client
    .query(
      `SELECT property_kind, status, last_synced_at FROM integration_connections
        WHERE tenant_id = $1 AND site_id = $2 AND provider = 'google'`,
      [tenantId, siteId],
    )
    .catch(() => ({ rows: [] }));
  checks.push(
    integrations.rows.some((row) => row.status === 'connected')
      ? warning('google-integration', 'At least one authorized Google property is connected')
      : waiting(
          'google-integration',
          'Optional Google connection awaits customer consent and credentials',
        ),
  );
  const backups = await client
    .query(
      `SELECT state, created_at FROM backup_records
        WHERE state = 'complete' ORDER BY created_at DESC LIMIT 1`,
    )
    .catch(() => ({ rows: [] }));
  checks.push(
    backups.rows[0]
      ? warning(
          'backup-freshness',
          `Latest complete platform backup: ${String(backups.rows[0].created_at)}`,
        )
      : waiting('backup-freshness', 'No complete backup evidence is available in this environment'),
  );
  if (options.checkDns) {
    for (const hostname of [config.publicHostname, config.adminHostname]) {
      const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
      checks.push(
        check(
          `dns-${hostname}`,
          addresses.length > 0,
          addresses.length
            ? `${hostname} resolves to ${addresses.join(', ')}`
            : 'No A record found',
        ),
      );
    }
  }
  return finish(checks, tenantId, siteId);
}

export async function onboardSite(
  client: QueryClient,
  config: SiteOnboardingConfig,
): Promise<SiteReadinessReport> {
  const contract = await loadContract(config.sourcePath);
  validateConfig(config, contract);
  const actor = await client.query(
    `SELECT user_id FROM platform_memberships
      WHERE role = 'platform_owner' AND active ORDER BY created_at LIMIT 1`,
  );
  const actorId = requiredText(actor.rows[0]?.user_id, 'An active platform owner is required');
  let invitationPath: string | undefined;
  await client.query('BEGIN');
  try {
    const conflicts = await client.query(
      `SELECT id, tenant_id FROM sites
        WHERE source_path = $1 OR EXISTS (
          SELECT 1 FROM domains WHERE domains.site_id = sites.id AND hostname IN ($2, $3)
        ) FOR UPDATE`,
      [config.sourcePath, config.publicHostname, config.adminHostname],
    );
    if (conflicts.rows.length > 1)
      throw new Error('Conflicting site records require reconciliation');
    let site = conflicts.rows[0];
    if (!site) {
      const tenant = await client.query(
        `INSERT INTO tenants (name, status) VALUES ($1, 'active') RETURNING id`,
        [config.tenantName],
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
          config.siteName,
          contract.version,
          contractHash(contract),
          config.sourcePath,
          contract.routes.length,
        ],
      );
      site = created.rows[0];
    }
    const tenantId = requiredText(site?.tenant_id, 'Tenant identity is unavailable');
    const siteId = requiredText(site?.id, 'Site identity is unavailable');
    await client.query(
      `UPDATE sites SET name = $3, status = 'active', contract_version = $4,
              contract_hash = $5, standard_page_count = $6, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND source_path = $7`,
      [
        tenantId,
        siteId,
        config.siteName,
        contract.version,
        contractHash(contract),
        contract.routes.length,
        config.sourcePath,
      ],
    );
    await upsertDomain(
      client,
      tenantId,
      siteId,
      config.publicHostname,
      'public',
      config.publicHostVerified === true,
    );
    await upsertDomain(
      client,
      tenantId,
      siteId,
      config.adminHostname,
      'admin',
      config.adminHostVerified === true,
    );
    const plan = await client.query(
      `SELECT id FROM plans WHERE code = $1 AND version = $2 AND active LIMIT 2`,
      [config.planCode, config.planVersion],
    );
    if (plan.rows.length !== 1) throw new Error('Selected active plan is missing or ambiguous');
    await client.query(
      `INSERT INTO subscriptions (tenant_id, site_id, plan_id, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (site_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, updated_at = now()
       WHERE subscriptions.tenant_id = EXCLUDED.tenant_id`,
      [tenantId, siteId, plan.rows[0]?.id],
    );
    await synchronizeContent(client, tenantId, siteId, actorId, contract, config);
    if (config.ownerEmail)
      invitationPath = await ensureOwner(client, tenantId, siteId, config, actorId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (invitationPath) await rm(invitationPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return diagnoseSite(client, config);
}

async function synchronizeContent(
  client: QueryClient,
  tenantId: string,
  siteId: string,
  actorId: string,
  contract: SiteContract,
  config: SiteOnboardingConfig,
): Promise<void> {
  const pages = new Map<string, string>();
  for (const route of contract.routes) {
    const result = await client.query(
      `INSERT INTO content_pages (tenant_id, site_id, stable_id, route, schema_version)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (tenant_id, site_id, stable_id) DO UPDATE SET route = EXCLUDED.route, updated_at = now()
       RETURNING id`,
      [tenantId, siteId, route.id, route.path],
    );
    pages.set(route.id, requiredText(result.rows[0]?.id, 'Page reconciliation failed'));
  }
  for (const field of contract.fields) {
    const route = routeForComponent(contract, field.componentId);
    const pageId = pages.get(route.id);
    if (!pageId) throw new Error(`Field ${field.id} has no route mapping`);
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
  if (config.factsReviewed) {
    for (const fact of contract.facts) {
      if (!Object.hasOwn(config.facts ?? {}, fact.id))
        throw new Error(`Reviewed fact is missing: ${fact.id}`);
      await client.query(
        `INSERT INTO business_facts
           (tenant_id, site_id, stable_id, kind, value, provenance, verified_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'owner-reviewed onboarding input', $6)
         ON CONFLICT (tenant_id, site_id, stable_id) DO NOTHING`,
        [tenantId, siteId, fact.id, fact.kind, JSON.stringify(config.facts?.[fact.id]), actorId],
      );
    }
  }
  for (const field of contract.fields) {
    if (!Object.hasOwn(config.content, field.id))
      throw new Error(`Seed content is missing: ${field.id}`);
  }
  const revisions = await client.query(
    `SELECT count(*)::integer AS count FROM content_revisions WHERE tenant_id = $1 AND site_id = $2`,
    [tenantId, siteId],
  );
  if (Number(revisions.rows[0]?.count ?? 0) === 0) {
    await client.query(
      `INSERT INTO content_revisions
         (tenant_id, site_id, revision, schema_version, content, facts_snapshot, created_by, origin)
       VALUES ($1, $2, 1, 1, $3::jsonb, $4::jsonb, $5, 'seed')`,
      [
        tenantId,
        siteId,
        JSON.stringify(config.content),
        JSON.stringify(config.factsReviewed ? (config.facts ?? {}) : {}),
        actorId,
      ],
    );
  }
  for (const form of contract.contactForms) {
    await client.query(
      `INSERT INTO site_contact_forms
         (tenant_id, site_id, form_id, enabled, declared_field_ids, enabled_field_ids,
          required_field_ids, confirmation_enabled, reason, actor_id, policy_version)
       VALUES ($1, $2, $3, false, $4::jsonb, $5::jsonb, $6::jsonb, false,
               'Onboarded disabled pending verified recipient and consent approval', $7, 1)
       ON CONFLICT (tenant_id, site_id, form_id) DO NOTHING`,
      [
        tenantId,
        siteId,
        form.id,
        JSON.stringify(form.fields.map(({ id }) => id)),
        JSON.stringify(form.fields.map(({ id }) => id)),
        JSON.stringify(form.fields.filter(({ required }) => required).map(({ id }) => id)),
        actorId,
      ],
    );
  }
}

async function ensureOwner(
  client: QueryClient,
  tenantId: string,
  siteId: string,
  config: SiteOnboardingConfig,
  actorId: string,
): Promise<string | undefined> {
  const email = config.ownerEmail?.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/u.test(email)) throw new Error('A valid owner email is required');
  const users = await client.query(`SELECT id FROM users WHERE normalized_email = $1 LIMIT 2`, [
    email,
  ]);
  if (users.rows.length === 1) {
    await client.query(
      `INSERT INTO memberships (tenant_id, site_id, user_id, role, active)
       VALUES ($1, $2, $3, 'customer_owner', true)
       ON CONFLICT (tenant_id, site_id, user_id) DO UPDATE SET role = 'customer_owner', active = true`,
      [tenantId, siteId, users.rows[0]?.id],
    );
    return undefined;
  }
  const pending = await client.query(
    `SELECT id FROM customer_invitations
      WHERE tenant_id = $1 AND site_id = $2 AND normalized_email = $3
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() LIMIT 1`,
    [tenantId, siteId, email],
  );
  if (pending.rows.length > 0) return undefined;
  if (!config.invitationOutput) throw new Error('A new owner requires invitationOutput');
  const token = randomBytes(32).toString('base64url');
  await client.query(
    `INSERT INTO customer_invitations
       (tenant_id, site_id, normalized_email, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, 'customer_owner', $4, $5, now() + interval '7 days')`,
    [
      tenantId,
      siteId,
      email,
      createHash('sha256').update(token).digest('hex'),
      config.invitedByUserId ?? actorId,
    ],
  );
  const invitationPath = resolve(config.invitationOutput);
  await writeFile(
    invitationPath,
    `https://${config.adminHostname}/auth/invitations/accept?token=${token}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  return invitationPath;
}

async function upsertDomain(
  client: QueryClient,
  tenantId: string,
  siteId: string,
  hostname: string,
  kind: 'admin' | 'public',
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

export function routeForComponent(
  contract: SiteContract,
  componentId: string,
): SiteContract['routes'][number] {
  const candidates = contract.routes
    .filter(
      (route) =>
        componentId === route.componentId || componentId.startsWith(`${route.componentId}.`),
    )
    .sort((left, right) => right.componentId.length - left.componentId.length);
  const route =
    candidates[0] ??
    contract.routes.find((route) => route.id === contract.preview.entryRoute) ??
    contract.routes[0];
  if (!route) throw new Error('Site contract has no routable component');
  return route;
}

function validateConfig(config: SiteOnboardingConfig, contract: SiteContract): void {
  if (contract.site.sourcePath !== config.sourcePath)
    throw new Error('Manifest sourcePath does not match config');
  if (!config.planCode.trim() || !Number.isInteger(config.planVersion) || config.planVersion < 1)
    throw new Error('An approved plan code/version is required');
  if (config.publicHostname === config.adminHostname)
    throw new Error('Public and admin hostnames must be different');
  for (const host of [config.publicHostname, config.adminHostname]) {
    const labels = host.split('.');
    if (
      host.length > 253 ||
      labels.length < 2 ||
      labels.some(
        (label) =>
          label.length < 1 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
      )
    )
      throw new Error(`Invalid hostname: ${host}`);
  }
}

async function loadContract(sourcePath: string): Promise<SiteContract> {
  return validateSiteContract(
    JSON.parse(await readFile(resolve(sourcePath, 'site.manifest.json'), 'utf8')),
  );
}

function check(id: string, ready: boolean, detail: string): SiteReadinessCheck {
  return { detail, id, status: ready ? 'ready' : 'blocked' };
}
function waiting(id: string, detail: string): SiteReadinessCheck {
  return { detail, id, status: 'waiting' };
}
function warning(id: string, detail: string): SiteReadinessCheck {
  return { detail, id, status: 'warning' };
}
function finish(
  checks: SiteReadinessCheck[],
  tenantId?: string,
  siteId?: string,
): SiteReadinessReport {
  return {
    checks,
    ready: checks.every((entry) => entry.status !== 'blocked'),
    ...(tenantId ? { tenantId } : {}),
    ...(siteId ? { siteId } : {}),
  };
}
function requiredText(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value) throw new Error(message);
  return value;
}

function parseArguments(values: string[]): { apply: boolean; checkDns: boolean; config: string } {
  let config = '';
  let apply = false;
  let checkDns = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--apply') apply = true;
    else if (value === '--check-dns') checkDns = true;
    else if (value === '--config') config = values[++index] ?? '';
    else throw new Error(`Unknown argument: ${String(value)}`);
  }
  if (!config) throw new Error('--config is required');
  return { apply, checkDns, config };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const options = parseArguments(process.argv.slice(2));
  const config = JSON.parse(
    await readFile(resolve(options.config), 'utf8'),
  ) as SiteOnboardingConfig;
  const database = createDatabase(databaseUrl);
  try {
    const report = options.apply
      ? await onboardSite(database.pool as unknown as QueryClient, config)
      : await diagnoseSite(database.pool as unknown as QueryClient, config, {
          checkDns: options.checkDns,
        });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } finally {
    await database.close();
  }
}
