import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const scriptPath = resolve(root, 'infrastructure/deploy/configure-caddy-route.sh');
const source = readFileSync(scriptPath, 'utf8');

describe('shared Caddy integration script', () => {
  it('is executable and refuses an uninventoried source configuration', () => {
    const indexLine = execFileSync(
      'git',
      ['ls-files', '--stage', 'infrastructure/deploy/configure-caddy-route.sh'],
      { cwd: root, encoding: 'utf8' },
    );

    expect(indexLine).toMatch(/^100755 /u);
    expect(source).toContain('expected_sha=abe4467');
    expect(source).toContain('refusing to edit it');
  });

  it('backs up, validates, reloads, checks the existing site, and restores on failure', () => {
    expect(source).toContain('Caddyfile.pre-omnireach-');
    expect(source).toContain('caddy validate');
    expect(source).toContain('caddy reload');
    expect(source).toContain('https://christiansreunite.com');
    expect(source.match(/cp --preserve=mode,ownership -- "\$backup" "\$caddyfile"/gu)).toHaveLength(
      3,
    );
  });

  it('adds only the approved host and loopback-published API upstream', () => {
    expect(source).toContain('admin.omnireach.cloud {');
    expect(source).toContain('reverse_proxy host.docker.internal:44100');
    expect(source).toContain('X-Robots-Tag "noindex, nofollow, noarchive"');
    expect(source).not.toContain('www.omnireach.cloud {');
  });
});
