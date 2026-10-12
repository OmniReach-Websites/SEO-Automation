import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const target = readFileSync(resolve('infrastructure/deploy/target-release.sh'), 'utf8');
const installer = readFileSync(resolve('infrastructure/deploy/install-target.sh'), 'utf8');
const validator = readFileSync(
  resolve('infrastructure/deploy/validate-release-metadata.sh'),
  'utf8',
);

describe('restricted production release wrapper', () => {
  it('resolves incoming artifacts from a fixed root and accepts only immutable commit SHAs', () => {
    expect(target).toContain('incoming_root=$deploy_root/incoming');
    expect(target).toContain("grep -Eq '^[0-9a-f]{40}$'");
    expect(target).toContain('stage_archive=$incoming_root/$stage_release_id.tgz');
    expect(target).toContain('case "${1:-}" in');
    expect(target).not.toMatch(/\beval\b/u);
  });

  it('verifies immutable artifacts, prevents traversal, locks activation, and checks readiness', () => {
    expect(target).toContain('sha256sum "$archive_path"');
    expect(target).toContain("''|/*|..|../*|*/..|*/../*");
    expect(target).toContain('flock -n 9');
    expect(target).toContain('.artifact-sha256');
    expect(target).toContain('up --detach --no-build');
    expect(target).toContain('wait_for_readiness');
    expect(target).toContain('restore_release');
  });

  it('requires contract metadata and blocks an ordinary transition from a legacy release', () => {
    expect(target).toContain('omnireach-validate-release-metadata');
    expect(target).toContain(
      "fail 'active release predates contract metadata; use the reviewed bridge operation'",
    );
    expect(target).toContain(
      'assert_release_supports "$prior_dir" "$candidate_schema" "$candidate_auth"',
    );
    expect(validator).toContain('release metadata identity mismatch');
    expect(validator).toContain('release schema contract is incompatible');
  });

  it('offers only an explicit bridge and compatible manual rollback across the v2 boundary', () => {
    expect(target).toContain('bridge_release "$2" "$3"');
    expect(target).toContain(
      'assert_release_supports "$rollback_dir" "$candidate_schema" "$candidate_auth"',
    );
    expect(target).toContain('rollback_release');
    expect(target).toContain(
      'assert_release_supports "$rollback_dir" "$active_schema" "$active_auth"',
    );
    expect(target).toContain("fail 'usage: omnireach-release rollback'");
  });

  it('installs a single command-scoped sudo rule without Docker-socket access', () => {
    expect(installer).toContain(
      'omnireach-deploy ALL=(root) NOPASSWD: /usr/local/sbin/omnireach-release-root *',
    );
    expect(installer).toContain('/usr/local/libexec/omnireach-validate-release-metadata');
    expect(installer).toContain('visudo -cf /etc/sudoers.d/omnireach-release');
    expect(installer).not.toContain('/var/run/docker.sock');
    expect(installer).not.toMatch(/NOPASSWD:\s*ALL/u);
  });
});
