import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const migrationsRoot = resolve(root, 'packages/database/prisma/migrations');
const sql = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name))
  .map((entry) => readFileSync(resolve(migrationsRoot, entry.name, 'migration.sql'), 'utf8'))
  .join('\n');

const errors = [];
const siteScopedTables = [
  'active_artifacts',
  'asset_references',
  'asset_variants',
  'assets',
  'audit_events',
  'build_artifacts',
  'business_facts',
  'contact_submissions',
  'content_drafts',
  'content_fields',
  'content_pages',
  'content_proposals',
  'content_revisions',
  'customer_invitations',
  'domains',
  'memberships',
  'plan_quota_reservations',
  'plan_quota_usage',
  'publication_requests',
  'sessions',
  'site_emergency_controls',
  'site_feature_overrides',
  'site_contact_forms',
  'site_plan_quota_overrides',
  'sites',
  'subscriptions',
];

for (const table of siteScopedTables) {
  const create = new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`, 'u').exec(sql)?.[1];
  if (!create) {
    errors.push(`${table}: CREATE TABLE not found`);
    continue;
  }
  if (table !== 'sites' && !/tenant_id uuid/iu.test(create))
    errors.push(`${table}: missing tenant_id`);
  if (!['audit_events', 'sites'].includes(table) && !/site_id uuid/iu.test(create))
    errors.push(`${table}: missing site_id`);
  if (table === 'memberships' && !/site_id uuid NOT NULL/iu.test(create))
    errors.push('memberships: customer memberships must be site-scoped');
  if (!new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'u').test(sql))
    errors.push(`${table}: RLS not enabled`);
  if (!new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, 'u').test(sql))
    errors.push(`${table}: RLS not forced`);
  const sitePolicy = new RegExp(
    `CREATE POLICY [^;]+ ON ${table}[\\s\\S]*?current_setting\\('app\\.site_id'[^;]+;`,
    'u',
  );
  if (!sitePolicy.test(sql)) errors.push(`${table}: RLS policy is not site-scoped`);
}

for (const unsafeReference of [
  'REFERENCES assets(id)',
  'REFERENCES build_artifacts(id)',
  'REFERENCES content_fields(id)',
  'REFERENCES content_pages(id)',
]) {
  if (sql.includes(unsafeReference))
    errors.push(`unsafe site-scoped reference: ${unsafeReference}`);
}

for (const fragment of [
  'omnireach_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  'omnireach_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  'omnireach_platform NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  'omnireach_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  'content_revisions_immutable',
  'content_proposals_protected_guard',
  'CREATE TABLE platform_ai_budget',
  'CREATE TABLE platform_ai_budget_periods',
  'AI platform budget hard cap exceeded',
  'plan quota hard cap exceeded',
  'publication_history_no_delete',
  'CREATE TABLE platform_memberships',
  'ALTER TABLE platform_memberships FORCE ROW LEVEL SECURITY',
  'ALTER TABLE credentials FORCE ROW LEVEL SECURITY',
  'ALTER TABLE owner_bootstrap FORCE ROW LEVEL SECURITY',
  'GRANT INSERT ON audit_events TO omnireach_auth',
  "OR pg_has_role(current_user, 'omnireach_auth', 'member')",
]) {
  if (!sql.includes(fragment)) errors.push(`required migration invariant missing: ${fragment}`);
}

if (/GRANT[^;]*credentials[^;]*TO omnireach_app/isu.test(sql)) {
  errors.push('omnireach_app must not receive credential-table grants');
}

const result = {
  errors,
  migrations: readdirSync(migrationsRoot).length - 1,
  ok: errors.length === 0,
};
console.log(JSON.stringify({ check: 'migrations', ...result }));
process.exitCode = result.ok ? 0 : 1;
