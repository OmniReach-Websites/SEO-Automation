import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- repository tooling remains plain ESM.
import { checkWorkflows } from '../../tooling/check-workflows.mjs';

const workflowFiles = ['ci.yml', 'deploy-artifact.yml', 'deploy-production.yml'];

function workflowSource(files: Record<string, string>, file: string): string {
  const source = files[file];
  if (source === undefined) throw new Error(`Missing workflow fixture: ${file}`);
  return source;
}

function withWorkflowFixture(
  mutate: (files: Record<string, string>) => Record<string, string>,
): ReturnType<typeof checkWorkflows> {
  const fixture = mkdtempSync(join(tmpdir(), 'omnireach-workflow-policy-'));
  try {
    const files = Object.fromEntries(
      workflowFiles.map((file) => [
        file,
        readFileSync(resolve('.github', 'workflows', file), 'utf8'),
      ]),
    );
    const mutated = mutate(files);
    for (const file of workflowFiles) {
      const destination = join(fixture, file);
      cpSync(resolve('.github', 'workflows', file), destination);
      writeFileSync(destination, mutated[file] ?? workflowSource(files, file), 'utf8');
    }
    return checkWorkflows(fixture);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
}

describe('production release workflow gates', () => {
  it('requires branch CI to compare the manifest with committed source capabilities', () => {
    const result = withWorkflowFixture((files) => ({
      ...files,
      'ci.yml': workflowSource(files, 'ci.yml').replace(
        'node infrastructure/deploy/create-release-metadata.mjs --check-contract',
        'echo release-contract-check-removed',
      ),
    }));

    expect(result.errors).toContain('ci.yml: branch CI must validate source release capabilities');
  });

  it('rejects the unsupported secret-scan flag instead of silently scanning less history', () => {
    const result = withWorkflowFixture((files) => ({
      ...files,
      'ci.yml': workflowSource(files, 'ci.yml').replace('--scope full', '--full-history'),
    }));

    expect(result.errors).toContain(
      'ci.yml: every source path must use the supported full secret-scan scope',
    );
  });

  it('rejects a bridge that is not explicitly confirmed and repository-activated', () => {
    const result = withWorkflowFixture((files) => ({
      ...files,
      'deploy-production.yml': workflowSource(files, 'deploy-production.yml').replace(
        "inputs.confirm_bridge == true &&\n      vars.PRODUCTION_DEPLOYMENT_ENABLED == 'true'",
        'inputs.confirm_bridge == true',
      ),
    }));

    expect(result.errors).toContain(
      'deploy-production.yml: bridge must be main-only and default off behind both gates',
    );
  });

  it('rejects a rollback that is not explicitly confirmed and repository-activated', () => {
    const result = withWorkflowFixture((files) => ({
      ...files,
      'deploy-production.yml': workflowSource(files, 'deploy-production.yml').replace(
        "inputs.confirm_rollback == true &&\n      vars.PRODUCTION_DEPLOYMENT_ENABLED == 'true'",
        'inputs.confirm_rollback == true',
      ),
    }));

    expect(result.errors).toContain(
      'deploy-production.yml: rollback must be main-only and default off behind both gates',
    );
  });

  it('rejects reuse of one checkout metadata path for the two bridge artifacts', () => {
    const result = withWorkflowFixture((files) => {
      const source = workflowSource(files, 'deploy-production.yml');
      const lastGenerator = source.lastIndexOf(
        'node infrastructure/deploy/create-release-metadata.mjs',
      );
      return {
        ...files,
        'deploy-production.yml': `${source.slice(0, lastGenerator)}echo metadata-generator-removed${source.slice(
          lastGenerator + 'node infrastructure/deploy/create-release-metadata.mjs'.length,
        )}`,
      };
    });

    expect(result.errors).toContain(
      'deploy-production.yml: candidate and rollback must independently pass gates and metadata',
    );
  });

  it('rejects a rollback commit that is not proven older than the candidate', () => {
    const result = withWorkflowFixture((files) => ({
      ...files,
      'deploy-production.yml': workflowSource(files, 'deploy-production.yml').replace(
        'git -C bridge-verification merge-base --is-ancestor "${ROLLBACK_SHA}" "${CANDIDATE_SHA}"',
        'true # missing rollback-to-candidate ancestry proof',
      ),
    }));

    expect(result.errors).toContain(
      'deploy-production.yml: bridge must prove main ancestry and build both exact sources',
    );
  });

  it('rejects transfer before bidirectional release-contract preflight', () => {
    const result = withWorkflowFixture((files) => ({
      ...files,
      'deploy-production.yml': workflowSource(files, 'deploy-production.yml').replace(
        'sh "${validator}" supports "${candidate_metadata}" "${CANDIDATE_SHA}"',
        'true # missing candidate compatibility preflight',
      ),
    }));

    expect(result.errors).toContain(
      'deploy-production.yml: bridge must preflight both release contracts before transfer',
    );
  });
});
