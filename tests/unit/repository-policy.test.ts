import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- repository tooling remains plain ESM.
import { checkWorkflows } from '../../tooling/check-workflows.mjs';
// @ts-expect-error -- G02 tooling modules are plain ESM until a tooling package exists.
import { isForbiddenPath, scanText } from '../../tooling/scan-secrets.mjs';
// @ts-expect-error -- G02 tooling modules are plain ESM until a tooling package exists.
import { validateRegistry } from '../../tooling/verify-goal.mjs';

const policy = JSON.parse(readFileSync(resolve('tooling/repository-policy.json'), 'utf8')) as {
  allowedSensitivePathPatterns: string[];
  allowedSensitivePaths: string[];
  forbiddenPathPatterns: string[];
};

describe('public repository policy', () => {
  it('rejects credential-shaped content without storing a credential fixture', () => {
    const synthetic = ['s', 'k'].join('') + '-proj-' + 'A'.repeat(32);
    expect(scanText(`token=${synthetic}`, 'synthetic')).toEqual([
      expect.objectContaining({ rule: 'openai-key', source: 'synthetic' }),
    ]);
  });

  it('allows documented placeholders and rejects private runtime paths', () => {
    expect(isForbiddenPath('.env.example', policy)).toBe(false);
    expect(isForbiddenPath('infrastructure/backups/README.md', policy)).toBe(false);
    expect(isForbiddenPath('.env.production', policy)).toBe(true);
    expect(isForbiddenPath('customer-data/export.json', policy)).toBe(true);
    expect(isForbiddenPath('tmp/database.dump', policy)).toBe(true);
    expect(
      isForbiddenPath(
        'packages/database/prisma/migrations/20261010190000_g04_foundation/migration.sql',
        policy,
      ),
    ).toBe(false);
    expect(isForbiddenPath('packages/database/private.sql', policy)).toBe(true);
  });

  it('rejects empty, placeholder, and recursive goal verification entries', () => {
    expect(validateRegistry({ G01: [] })).toContain('G01 must have at least one command');
    expect(validateRegistry({ G01: [['echo', 'pass']] })[0]).toContain('placeholder command');
    expect(validateRegistry({ G01: [['npm', 'run', 'verify:all']] })[0]).toContain(
      'cannot recursively invoke',
    );
  });

  it('keeps branch CI read-only, SHA-pinned, and free of deployment paths', () => {
    expect(checkWorkflows()).toMatchObject({
      errors: [],
      files: ['ci.yml', 'deploy-artifact.yml', 'deploy-production.yml'],
      ok: true,
    });
  });
});
