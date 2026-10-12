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
  'publication_request_admit_job',
  'publication_active_job_required',
  'publication_requests_job_identity_fkey',
  'publication_requests_job_id_key',
  'publication_trace_id_envelope_safe',
  'publication job link is immutable',
  'linked publication job identity is immutable',
  'CREATE TABLE platform_memberships',
  'ALTER TABLE platform_memberships FORCE ROW LEVEL SECURITY',
  'ALTER TABLE credentials FORCE ROW LEVEL SECURITY',
  'ALTER TABLE owner_bootstrap FORCE ROW LEVEL SECURITY',
  'CREATE TABLE account_authentication_policies',
  'ALTER TABLE account_authentication_policies FORCE ROW LEVEL SECURITY',
  'CREATE TABLE account_recovery_codes',
  'set_version integer NOT NULL DEFAULT 1 CHECK (set_version > 0)',
  'ALTER TABLE account_recovery_codes FORCE ROW LEVEL SECURITY',
  'CREATE TABLE webauthn_scopes',
  'CREATE TABLE webauthn_credentials',
  'ALTER TABLE webauthn_scopes FORCE ROW LEVEL SECURITY',
  'ALTER TABLE webauthn_credentials FORCE ROW LEVEL SECURITY',
  'auth_contract_v3_webauthn_scopes',
  'auth_contract_v3_webauthn_credentials',
  'authentication_contract_v3_sessions',
  'authentication_contract_v3_password_recovery',
  'webauthn_credentials_bump_authentication_state',
  'platform_membership_requires_second_step',
  'authentication_policy_protects_platform_membership',
  'legacy_mfa_recovery_codes_account_sync',
  "authentication_method IN ('password', 'email_code', 'totp', 'webauthn', 'recovery_code')",
  "authentication_assurance IN ('basic', 'baseline', 'strong', 'recovery')",
  'ADD COLUMN verified_at timestamptz(3)',
  'ADD COLUMN recovery_restricted boolean NOT NULL DEFAULT false',
  'authentication-policy-upgrade',
  'password_recovery_tokens_host_check',
  'CREATE TABLE password_recovery_delivery_outbox',
  'password_recovery_delivery_outbox_payload_lifecycle',
  'ALTER TABLE password_recovery_delivery_outbox FORCE ROW LEVEL SECURITY',
  'auth_only_password_recovery_delivery_outbox',
  'GRANT SELECT, INSERT, UPDATE ON password_recovery_delivery_outbox TO omnireach_auth',
  'GRANT SELECT, INSERT, UPDATE ON account_authentication_policies, account_recovery_codes',
  'GRANT INSERT ON audit_events TO omnireach_auth',
  'CREATE TABLE mfa_encryption_key_retirements',
  'mfa_encryption_key_retirements_are_immutable',
  'guard_retired_mfa_encryption_key_write',
  'CREATE OR REPLACE FUNCTION retire_mfa_encryption_key',
  'GRANT EXECUTE ON FUNCTION retire_mfa_encryption_key(integer, integer, text) TO omnireach_auth',
  "OR pg_has_role(current_user, 'omnireach_auth', 'member')",
]) {
  if (!sql.includes(fragment)) errors.push(`required migration invariant missing: ${fragment}`);
}

if (/GRANT[^;]*credentials[^;]*TO omnireach_app/isu.test(sql)) {
  errors.push('omnireach_app must not receive credential-table grants');
}

if (
  /GRANT[^;]*(?:INSERT|UPDATE|DELETE)[^;]*mfa_encryption_key_retirements[^;]*TO omnireach_auth/isu.test(
    sql,
  )
) {
  errors.push('omnireach_auth must retire keys only through the atomic retirement function');
}

if (
  /GRANT[^;]*(?:account_authentication_policies|account_recovery_codes)[^;]*TO omnireach_(?:app|platform|worker)/isu.test(
    sql,
  )
) {
  errors.push('account authentication data must be granted only to omnireach_auth');
}

const result = {
  errors,
  migrations: readdirSync(migrationsRoot).length - 1,
  ok: errors.length === 0,
};
console.log(JSON.stringify({ check: 'migrations', ...result }));
process.exitCode = result.ok ? 0 : 1;
