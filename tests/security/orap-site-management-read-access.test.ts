import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'packages/database/prisma/migrations/20261013150000_orap_site_management_read_access/migration.sql',
  ),
  'utf8',
);
const service = readFileSync(resolve(process.cwd(), 'apps/api/src/postgres-orap.ts'), 'utf8');

describe('ORAP site-management publication visibility', () => {
  it('grants the platform role only the read access needed by the site detail screen', () => {
    expect(service).toContain('EXISTS (SELECT 1 FROM active_artifacts');
    expect(migration).toContain('REVOKE ALL ON TABLE active_artifacts FROM omnireach_platform;');
    expect(migration).toContain('GRANT SELECT ON TABLE active_artifacts TO omnireach_platform;');
    expect(migration).not.toMatch(
      /GRANT[^;]*(?:INSERT|UPDATE|DELETE)[^;]*active_artifacts[^;]*TO omnireach_platform/isu,
    );
  });
});
