import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isRegisteredOrapCapability } from '@omnireach/auth';
import { describe, expect, it } from 'vitest';

import {
  assertOrapRoutePolicyRegistry,
  orapRoutePolicyRegistry,
} from '../../apps/api/src/orap-route-policy.ts';

const root = resolve(import.meta.dirname, '../..');
const sources = [
  readFileSync(resolve(root, 'apps/api/src/orap-routes.ts'), 'utf8'),
  readFileSync(resolve(root, 'apps/api/src/integration-routes.ts'), 'utf8'),
].join('\n');

describe('ORAP route policy registry', () => {
  it('registers every API route exactly once and fails closed for future additions', () => {
    expect(() => assertOrapRoutePolicyRegistry()).not.toThrow();
    const sourcePaths = [...sources.matchAll(/['"](\/v1\/orap[^'"]+)['"]/gu)].map(
      (match) => match[1],
    );
    const registeredPaths = orapRoutePolicyRegistry.map(({ path }) => path);
    expect(sourcePaths.sort()).toEqual([...registeredPaths].sort());
  });

  it('uses only registered delegated capabilities or explicit owner identity', () => {
    for (const policy of orapRoutePolicyRegistry) {
      expect(
        ('ownerIdentityOnly' in policy && policy.ownerIdentityOnly) ||
          policy.capabilities.length > 0,
      ).toBe(true);
      for (const capability of policy.capabilities) {
        expect(isRegisteredOrapCapability(capability)).toBe(true);
      }
    }
  });
});
