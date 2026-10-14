import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261013140000_phase4_google_provider/migration.sql',
  ),
  'utf8',
);
const service = readFileSync(resolve(root, 'apps/api/src/postgres-google.ts'), 'utf8');
const metricIdentityMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261013170000_google_metric_observation_identity/migration.sql',
  ),
  'utf8',
);
const syncDiagnosticsMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261014070000_google_sync_diagnostics/migration.sql',
  ),
  'utf8',
);

describe('Google provider persistence boundary', () => {
  it('stores one-use hashed OAuth state and encrypted request/token envelopes', () => {
    expect(migration).toContain('state_hash char(64) NOT NULL UNIQUE');
    expect(migration).toContain('encrypted_request bytea NOT NULL');
    expect(migration).toContain('encrypted_payload bytea NOT NULL');
    expect(migration).toContain('consumed_at timestamptz(3)');
    expect(service).toContain('digest(input.state)');
    expect(service).toContain("Buffer.from('ORGI1')");
    expect(service).not.toMatch(/console\.(?:log|error).*token/iu);
  });

  it('keeps credentials out of customer/application roles and forces scoped RLS', () => {
    expect(migration).toContain(
      'REVOKE ALL ON google_oauth_states, integration_credentials FROM PUBLIC',
    );
    expect(migration).not.toMatch(/GRANT[^;]*integration_credentials[^;]*omnireach_app/isu);
    expect(migration).toContain('ALTER TABLE integration_credentials FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("current_setting('app.tenant_id', true)");
    expect(migration).toContain("current_setting('app.site_id', true)");
    expect(service).toContain('SET LOCAL ROLE omnireach_worker');
  });

  it('records consent/disconnect evidence and idempotent metric hashes', () => {
    expect(service).toContain('integration.google.consent_started');
    expect(service).toContain('integration.google.connected');
    expect(service).toContain('integration.google.disconnected');
    expect(service).toContain('ON CONFLICT (connection_id, source_hash) DO UPDATE');
    expect(service).toContain('metric_snapshots.value IS DISTINCT FROM EXCLUDED.value');
    expect(metricIdentityMigration).toContain(
      'PARTITION BY connection_id, source, metric, dimensions, window_start, window_end',
    );
    expect(service).toContain("status = 'disconnected'");
  });

  it('separates collection attempts from stored results and clears stale metrics on remap', () => {
    expect(syncDiagnosticsMigration).toContain('ADD COLUMN last_attempted_at timestamptz(3)');
    expect(syncDiagnosticsMigration).toContain("'partial'");
    expect(service).toContain('DELETE FROM metric_snapshots');
    expect(service).toContain('last_synced_at = NULL');
    expect(service).toContain('last_attempted_at = NULL');
    expect(service).toContain('sync_cursor = NULL');
    expect(service).toContain('refresh_failure_code = NULL');
  });
});
