import { describe, expect, it } from 'vitest';

// @ts-expect-error -- G02 tooling modules are plain ESM until a tooling package exists.
import { checkDocs } from '../../tooling/check-docs.mjs';
// @ts-expect-error -- G02 tooling modules are plain ESM until a tooling package exists.
import { checkWorkspaces } from '../../tooling/check-workspaces.mjs';
// @ts-expect-error -- G02 tooling modules are plain ESM until a tooling package exists.
import { scanRepository } from '../../tooling/scan-secrets.mjs';

describe('repository baseline integration', () => {
  it('keeps the G01 documentation contract valid', () => {
    expect(checkDocs()).toMatchObject({ errors: [], ok: true });
  });

  it('keeps every declared workspace within its dependency boundary', () => {
    expect(checkWorkspaces()).toMatchObject({ errors: [], ok: true, workspaceCount: 28 });
  });

  it('contains no obvious working-tree secret or forbidden committed path', () => {
    expect(scanRepository(undefined, 'working-tree')).toMatchObject({ findings: [], ok: true });
  });
});
