import { readFile } from 'node:fs/promises';

import { contractHash, validateSiteContract } from '@omnireach/contracts';
import { describe, expect, it } from 'vitest';

import {
  diagnoseSite,
  onboardSite,
  routeForComponent,
  type SiteOnboardingConfig,
} from '../../tooling/site-onboarding.ts';

const tenantId = '10000000-0000-4000-8000-000000000001';
const siteId = '20000000-0000-4000-8000-000000000001';

class OnboardingFixtureDatabase {
  assignedPlanCode = 'STARTER';
  assignedPlanStatus = 'active';
  assignedPlanVersion = 1;
  readonly domains = new Map<
    string,
    { active: boolean; kind: string; verification_status: string }
  >();
  readonly facts = new Set<string>();
  readonly fields = new Set<string>();
  readonly pages = new Map<string, string>();
  revisions = 0;
  site:
    | {
        contract_hash: string;
        contract_version: string;
        id: string;
        source_path: string;
        status: string;
        tenant_id: string;
      }
    | undefined;

  async query(text: string, values: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    const sql = text.replace(/\s+/gu, ' ').trim();
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FROM platform_memberships')) return { rows: [{ user_id: 'owner-user' }] };
    if (sql.startsWith('SELECT id, tenant_id FROM sites')) {
      return { rows: this.site ? [{ id: siteId, tenant_id: tenantId }] : [] };
    }
    if (sql.startsWith('INSERT INTO tenants')) return { rows: [{ id: tenantId }] };
    if (sql.startsWith('INSERT INTO sites')) {
      this.site = {
        contract_hash: String(values[3]),
        contract_version: String(values[2]),
        id: siteId,
        source_path: String(values[4]),
        status: 'active',
        tenant_id: tenantId,
      };
      return { rows: [{ id: siteId, tenant_id: tenantId }] };
    }
    if (sql.startsWith('UPDATE sites SET')) {
      if (!this.site) throw new Error('site missing');
      this.site.contract_version = String(values[3]);
      this.site.contract_hash = String(values[4]);
      return { rows: [] };
    }
    if (sql.startsWith('SELECT tenant_id, site_id, kind FROM domains')) {
      const domain = this.domains.get(String(values[0]));
      return {
        rows: domain ? [{ kind: domain.kind, site_id: siteId, tenant_id: tenantId }] : [],
      };
    }
    if (sql.startsWith('INSERT INTO domains')) {
      this.domains.set(String(values[2]), {
        active: Boolean(values[6]),
        kind: String(values[3]),
        verification_status: String(values[4]),
      });
      return { rows: [] };
    }
    if (sql.startsWith('SELECT id FROM plans')) return { rows: [{ id: 'plan-starter' }] };
    if (sql.startsWith('INSERT INTO subscriptions')) return { rows: [] };
    if (sql.startsWith('INSERT INTO content_pages')) {
      const stableId = String(values[2]);
      const id = this.pages.get(stableId) ?? `page-${stableId}`;
      this.pages.set(stableId, id);
      return { rows: [{ id }] };
    }
    if (sql.startsWith('INSERT INTO content_fields')) {
      this.fields.add(String(values[3]));
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO business_facts')) {
      this.facts.add(String(values[2]));
      return { rows: [] };
    }
    if (sql.startsWith('SELECT count(*)::integer AS count FROM content_revisions')) {
      return { rows: [{ count: this.revisions }] };
    }
    if (sql.startsWith('INSERT INTO content_revisions')) {
      this.revisions += 1;
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO site_contact_forms')) return { rows: [] };
    if (
      sql.startsWith('SELECT id, tenant_id, status, contract_version, contract_hash FROM sites')
    ) {
      return { rows: this.site ? [this.site] : [] };
    }
    if (sql.startsWith('SELECT hostname, kind, verification_status, active FROM domains')) {
      return {
        rows: [...this.domains].map(([hostname, value]) => ({ hostname, ...value })),
      };
    }
    if (sql.startsWith('SELECT plan.code')) {
      return {
        rows: [
          {
            code: this.assignedPlanCode,
            status: this.assignedPlanStatus,
            version: this.assignedPlanVersion,
          },
        ],
      };
    }
    if (sql.startsWith('SELECT (SELECT count(*)::integer FROM memberships')) {
      return { rows: [{ invitations: 0, owners: 0 }] };
    }
    if (sql.startsWith('SELECT (SELECT count(*)::integer FROM content_pages')) {
      return {
        rows: [
          {
            facts: this.facts.size,
            fields: this.fields.size,
            pages: this.pages.size,
            revisions: this.revisions,
          },
        ],
      };
    }
    if (sql.includes('FROM worker_heartbeats')) return { rows: [] };
    if (sql.includes('FROM integration_connections')) return { rows: [] };
    if (sql.includes('FROM backup_records')) return { rows: [] };
    throw new Error(`Unhandled fixture query: ${sql}`);
  }
}

describe('generic site onboarding', () => {
  it('maps nested components to the longest route and reconciles a second tenant idempotently', async () => {
    const contract = validateSiteContract(
      JSON.parse(await readFile('sites/_starter/site.manifest.json', 'utf8')),
    );
    expect(routeForComponent(contract, 'home.highlights').id).toBe('home');
    expect(routeForComponent(contract, 'menu').id).toBe('menu');
    const content = Object.fromEntries(
      contract.fields.map((field) => [field.id, `Approved fixture value for ${field.id}`]),
    );
    const facts = Object.fromEntries(
      contract.facts.map((fact) => [fact.id, `Approved fixture fact for ${fact.id}`]),
    );
    const config: SiteOnboardingConfig = {
      adminHostVerified: true,
      adminHostname: 'admin.second-tenant.example.test',
      content,
      facts,
      factsReviewed: true,
      planCode: 'STARTER',
      planVersion: 1,
      publicHostVerified: true,
      publicHostname: 'second-tenant.example.test',
      siteName: 'Fictional Second Tenant Site',
      sourcePath: 'sites/_starter',
      tenantName: 'Fictional Second Tenant',
    };
    const database = new OnboardingFixtureDatabase();
    const first = await onboardSite(database, config);
    const second = await onboardSite(database, config);
    expect(first).toMatchObject({ ready: true, siteId, tenantId });
    expect(second).toMatchObject({ ready: true, siteId, tenantId });
    expect(database.revisions).toBe(1);
    expect(database.pages.size).toBe(contract.routes.length);
    expect(database.fields.size).toBe(contract.fields.length);
    expect(database.facts.size).toBe(contract.facts.length);
    expect(database.site?.contract_hash).toBe(contractHash(contract));

    database.assignedPlanVersion = 2;
    const mismatched = await diagnoseSite(database, config);
    expect(mismatched.ready).toBe(false);
    expect(mismatched.checks).toContainEqual(
      expect.objectContaining({ id: 'plan-assignment', status: 'blocked' }),
    );
  });

  it('rejects equal or malformed public and admin hostnames before mutation', async () => {
    const contract = validateSiteContract(
      JSON.parse(await readFile('sites/_starter/site.manifest.json', 'utf8')),
    );
    const config: SiteOnboardingConfig = {
      adminHostname: 'bad..example.test',
      content: Object.fromEntries(contract.fields.map((field) => [field.id, 'fixture'])),
      planCode: 'STARTER',
      planVersion: 1,
      publicHostname: 'bad..example.test',
      siteName: 'Invalid Host Fixture',
      sourcePath: 'sites/_starter',
      tenantName: 'Invalid Host Fixture',
    };
    await expect(onboardSite(new OnboardingFixtureDatabase(), config)).rejects.toThrow(
      /hostnames must be different/u,
    );
  });
});
