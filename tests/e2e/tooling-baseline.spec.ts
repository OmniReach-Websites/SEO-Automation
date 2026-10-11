import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

function runCheck(script: string) {
  const output = execFileSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
  return JSON.parse(output) as { ok: boolean };
}

test('a clean process can validate documentation and workspaces without application runtime', () => {
  expect(runCheck('tooling/check-docs.mjs').ok).toBe(true);
  expect(runCheck('tooling/check-workspaces.mjs').ok).toBe(true);
});
