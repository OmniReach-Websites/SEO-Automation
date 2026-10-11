import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(root, 'infrastructure/caddy/fixtures');
const existingPath = resolve(fixtureRoot, 'existing-routes.Caddyfile');
const before = createHash('sha256').update(readFileSync(existingPath)).digest('hex');
const mount = `${fixtureRoot.replaceAll('\\', '/')}:/etc/caddy:ro`;
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    mount,
    'caddy:2.10.2-alpine',
    'caddy',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
  ],
  { cwd: root, encoding: 'utf8', windowsHide: true },
);
const after = createHash('sha256').update(readFileSync(existingPath)).digest('hex');
if (result.status !== 0 || before !== after) {
  process.stderr.write(result.stderr);
  throw new Error('Isolated Caddy validation or non-regression check failed');
}
console.log(
  JSON.stringify({
    check: 'caddy-isolated',
    existingFixturePreserved: true,
    ok: true,
    validated: true,
  }),
);
