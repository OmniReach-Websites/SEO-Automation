import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const scriptPath = resolve(root, 'infrastructure/deploy/configure-caddy-route.sh');
const source = readFileSync(scriptPath, 'utf8');
const publicSiteScriptPath = resolve(
  root,
  'infrastructure/deploy/configure-omnireach-public-route.sh',
);
const publicSiteSource = readFileSync(publicSiteScriptPath, 'utf8');
const coopsSiteScriptPath = resolve(root, 'infrastructure/deploy/configure-coops-site-route.sh');
const coopsSiteSource = readFileSync(coopsSiteScriptPath, 'utf8');

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
    expect(source).toContain('reverse_proxy omnireach-api:4100');
    expect(source).toContain('caddy validate --config /dev/stdin');
    expect(source).toContain('caddy reload --force --config /dev/stdin');
    expect(source).toContain('X-Robots-Tag "noindex, nofollow, noarchive"');
    expect(source).not.toContain('www.omnireach.cloud {');
  });
});

describe('OmniReach public Caddy integration script', () => {
  it('keeps Google Analytics access narrowly scoped', () => {
    expect(publicSiteSource).toContain('https://www.googletagmanager.com');
    expect(publicSiteSource).toContain('https://www.google-analytics.com');
    expect(publicSiteSource).toContain("'sha256-1f6APo4rT+WRM24XLR07SyqI6L+qzt9T5/P7a6H1lIU='");
    expect(publicSiteSource).not.toContain("'unsafe-inline'");
    expect(publicSiteSource).not.toContain("'unsafe-eval'");
  });

  it('updates only its managed route and retains validation and rollback checks', () => {
    expect(publicSiteSource).toContain("marker='# BEGIN OMNIREACH PUBLIC SITE'");
    expect(publicSiteSource).toContain("end_marker='# END OMNIREACH PUBLIC SITE'");
    expect(publicSiteSource).toContain('start_count=$(grep -Fxc');
    expect(publicSiteSource).toContain('caddy validate');
    expect(publicSiteSource).toContain('caddy reload');
    expect(publicSiteSource).toContain('https://christiansreunite.com');
    expect(publicSiteSource).toContain('cp --preserve=mode,ownership -- "$backup" "$caddyfile"');
  });
});

describe('Coop public Caddy integration script', () => {
  it('allows only the reviewed site and Google Analytics scripts', () => {
    expect(coopsSiteSource).toContain('https://www.googletagmanager.com');
    expect(coopsSiteSource).toContain('https://www.google-analytics.com');
    for (const hash of [
      'Auky1RF93bHadMyKgiBJYnh4IZdEeaJBanm3qGYOpyM=',
      '5LQt8nuMFaxybQw44FhRwFCNluBmu0b9/68O/Xg8+hI=',
      'THEVRzZdTFzfhUTrvRL1wzh4o+iNn5tETfLqraij3q4=',
      'HwxHjYdadh60svsZJnUmyNDkEqfM6h5jvM7vx05DuWU=',
    ]) {
      expect(coopsSiteSource).toContain(`'sha256-${hash}'`);
    }
    expect(coopsSiteSource).toContain(
      "style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'",
    );
    expect(coopsSiteSource).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(coopsSiteSource).not.toContain("'unsafe-eval'");
  });

  it('updates only its managed route with validation and rollback checks', () => {
    expect(coopsSiteSource).toContain("marker='# BEGIN OMNIREACH COOPS MOBILE DETAILING'");
    expect(coopsSiteSource).toContain("end_marker='# END OMNIREACH COOPS MOBILE DETAILING'");
    expect(coopsSiteSource).toContain('start_count=$(grep -Fxc');
    expect(coopsSiteSource).toContain('caddy validate');
    expect(coopsSiteSource).toContain('caddy reload');
    expect(coopsSiteSource).toContain('https://christiansreunite.com');
    expect(coopsSiteSource).toContain('cp --preserve=mode,ownership -- "$backup" "$caddyfile"');
  });
});
