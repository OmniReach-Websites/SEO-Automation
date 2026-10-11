import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const target = readFileSync(resolve('infrastructure/deploy/target-release.sh'), 'utf8');
const installer = readFileSync(resolve('infrastructure/deploy/install-target.sh'), 'utf8');

describe('restricted production release wrapper', () => {
  it('resolves incoming artifacts from a fixed root and accepts only immutable commit SHAs', () => {
    expect(target).toContain('incoming_root=$deploy_root/incoming');
    expect(target).toContain("grep -Eq '^[0-9a-f]{40}$'");
    expect(target).toContain('archive=$incoming_root/$release_id.tgz');
    expect(target).toContain('[ "$1" = deploy ]');
    expect(target).not.toMatch(/\beval\b/u);
  });

  it('verifies artifacts, prevents traversal, locks activation, and checks readiness', () => {
    expect(target).toContain('sha256sum "$archive"');
    expect(target).toContain("''|/*|..|../*|*/..|*/../*");
    expect(target).toContain('flock -n 9');
    expect(target).toContain('up --detach --no-build');
    expect(target).toContain('wait_for_readiness');
    expect(target).toContain('restore_previous');
  });

  it('installs a single command-scoped sudo rule without Docker-socket access', () => {
    expect(installer).toContain(
      'omnireach-deploy ALL=(root) NOPASSWD: /usr/local/sbin/omnireach-release-root *',
    );
    expect(installer).toContain('visudo -cf /etc/sudoers.d/omnireach-release');
    expect(installer).not.toContain('/var/run/docker.sock');
    expect(installer).not.toMatch(/NOPASSWD:\s*ALL/u);
  });
});
