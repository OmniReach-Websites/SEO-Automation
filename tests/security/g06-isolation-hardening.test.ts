import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'packages/database/prisma/migrations/20261011020000_g06_isolation_hardening/migration.sql',
);
const verifierPath = resolve(process.cwd(), 'tooling/verify-g06-isolation-hardening.mjs');
const migration = readFileSync(migrationPath, 'utf8');
const verifier = readFileSync(verifierPath, 'utf8');

describe('G06 isolation hardening', () => {
  it('removes unconditional worker policy bypasses from quota and form tables', () => {
    for (const table of ['plan_quota_usage', 'plan_quota_reservations', 'site_contact_forms']) {
      const policy = migration.match(
        new RegExp(`CREATE POLICY tenant_scope_${table} ON ${table}([\\s\\S]*?);`, 'u'),
      )?.[1];
      expect(policy, `${table} policy`).toBeDefined();
      expect(policy).not.toContain("pg_has_role(current_user, 'omnireach_worker', 'member')");
      expect(policy).toContain("current_setting('app.tenant_id', true)");
      expect(policy).toContain("current_setting('app.site_id', true)");
    }
  });

  it('installs and validates the complete audited same-scope foreign-key set', () => {
    const constraints = [
      'sessions_rotation_scope_fk',
      'sessions_membership_scope_fk',
      'domain_operations_domain_scope_fk',
      'job_runs_job_scope_fk',
      'ai_reservations_period_scope_fk',
      'ai_reservations_job_scope_fk',
      'ai_usage_period_scope_fk',
      'ai_usage_reservation_scope_fk',
      'ai_usage_correction_scope_fk',
      'crawl_runs_job_scope_fk',
      'crawl_pages_run_scope_fk',
      'crawl_edges_run_scope_fk',
      'audit_runs_crawl_scope_fk',
      'findings_audit_scope_fk',
      'content_proposals_publication_scope_fk',
      'metric_snapshots_connection_scope_fk',
    ];
    for (const constraint of constraints) {
      expect(migration).toContain(`ADD CONSTRAINT ${constraint}`);
      expect(migration).toContain(`VALIDATE CONSTRAINT ${constraint}`);
      expect(verifier).toContain(`'${constraint}'`);
    }
    expect(migration).toContain('ADD CONSTRAINT sessions_scope_pair_check');
    expect(migration).toContain('CREATE TRIGGER sessions_rotation_scope_guard');
  });

  it('defines a fail-closed runtime privilege matrix', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE users, tenants, sites, domains, memberships,[\s\S]*?FROM omnireach_app, omnireach_worker, omnireach_auth, omnireach_platform;/u,
    );
    expect(migration).toContain(
      'GRANT SELECT ON tenants, sites, domains, memberships, platform_memberships\n  TO omnireach_app;',
    );
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE ON users TO omnireach_auth;');
    expect(migration).toContain('GRANT SELECT ON users TO omnireach_platform;');
    expect(migration).not.toMatch(/GRANT[^;]*users[^;]*TO omnireach_app/isu);
    expect(migration).not.toMatch(/GRANT[^;]*users[^;]*TO omnireach_worker/isu);
    expect(migration).toContain(
      'GRANT SELECT ON plan_quota_usage, plan_quota_reservations\n  TO omnireach_app, omnireach_worker, omnireach_platform;',
    );
    expect(migration).toContain('GRANT SELECT ON site_contact_forms TO omnireach_worker;');
    expect(migration).toContain(
      'REVOKE ALL ON TABLE subscriptions, site_feature_overrides, site_emergency_controls',
    );
    expect(migration).toContain(
      'GRANT SELECT ON subscriptions, site_feature_overrides, site_emergency_controls\n  TO omnireach_app, omnireach_worker;',
    );
    expect(migration).toContain('GRANT SELECT ON subscriptions TO omnireach_auth;');
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON subscriptions, site_feature_overrides,[\s\S]*?site_emergency_controls TO omnireach_platform;/u,
    );
    expect(migration).not.toMatch(
      /GRANT[^;]*(?:INSERT|UPDATE|DELETE)[^;]*subscriptions[^;]*TO omnireach_app/isu,
    );
  });

  it('classifies global operations as platform-only and scopes deliveries indirectly', () => {
    expect(migration).toContain(
      'tenant-global and platform-global rows are platform-only until a tenant-wide permission is defined',
    );
    expect(migration).toContain('ALTER TABLE alert_deliveries FORCE ROW LEVEL SECURITY;');
    expect(migration).toContain('CREATE POLICY indirect_alert_delivery_scope ON alert_deliveries');
    expect(migration).toContain('parent.site_id = NULLIF(current_setting');
  });

  it('provides a configurable, unset ORAP hostname reservation boundary', () => {
    expect(migration).toContain('CREATE TABLE platform_reserved_hostnames');
    expect(migration).toContain("CHECK (purpose = 'orap')");
    expect(migration).toContain('CREATE TRIGGER domains_reject_reserved_hostname');
    expect(migration).not.toContain('admin.omnireach.cloud');
    expect(verifier).toContain('admin.control.example.test');
  });

  it('uses an actual restricted login and checks A/B/sister-site behavior', () => {
    expect(verifier).toContain('LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
    expect(verifier).toContain('GRANT omnireach_worker');
    expect(verifier).toContain('GRANT omnireach_auth');
    expect(verifier).toContain(
      'NOINHERIT runtime login cannot use worker privileges before SET ROLE',
    );
    expect(verifier).toContain(
      'actual auth login executes the customer request-context resolver joins',
    );
    expect(verifier).toContain('actual worker login sees only exact-site rows');
    expect(verifier).toContain('worker cannot write a sister-site alert');
    expect(verifier).toContain(
      'auth role cannot create a customer session for an identity without same-scope membership',
    );
    expect(verifier).toContain("'<unset>|<unset>|<unset>'");
  });
});
