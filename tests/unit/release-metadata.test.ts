import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  assertReleaseMetadataSupports,
  createReleaseMetadata,
  parseReleaseMetadata,
  renderReleaseMetadata,
} from '../../infrastructure/deploy/create-release-metadata.mjs';

const releaseId = 'a'.repeat(40);
const execFileAsync = promisify(execFile);
const metadataSource = renderReleaseMetadata({
  migrationCount: 2,
  migrationHead: '20261010250000_g05_account_authentication_policy',
  releaseId,
});

describe('immutable release contract metadata', () => {
  it('binds authentication and schema contracts to the exact source commit', () => {
    const metadata = parseReleaseMetadata(metadataSource, releaseId);

    expect(metadata).toMatchObject({
      authContract: 2,
      releaseId,
      schemaMaximum: 2,
      schemaMinimum: 2,
      schemaTarget: 2,
    });
    expect(() => parseReleaseMetadata(metadataSource, 'b'.repeat(40))).toThrow('identity mismatch');
  });

  it('rejects duplicate fields and incompatible rollback contracts', () => {
    expect(() =>
      parseReleaseMetadata(`${metadataSource}OMNIREACH_AUTH_CONTRACT=2\n`, releaseId),
    ).toThrow('Duplicate');
    const metadata = parseReleaseMetadata(metadataSource, releaseId);
    expect(() =>
      assertReleaseMetadataSupports(metadata, { authContract: 1, schemaContract: 2 }),
    ).toThrow('authentication contract');
    expect(() =>
      assertReleaseMetadataSupports(metadata, { authContract: 2, schemaContract: 3 }),
    ).toThrow('schema contract');
  });

  it('creates metadata once from the ordered migration set', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'omnireach-release-metadata-'));
    try {
      const migrationsRoot = join(fixture, 'migrations');
      const outputPath = join(fixture, 'release.meta');
      await mkdir(join(migrationsRoot, '20260101000000_first'), { recursive: true });
      await mkdir(join(migrationsRoot, '20260202000000_second'));

      await createReleaseMetadata({ migrationsRoot, outputPath, releaseId });
      const generated = await readFile(outputPath, 'utf8');
      expect(generated).toContain('OMNIREACH_MIGRATION_HEAD=20260202000000_second');
      expect(generated).toContain('OMNIREACH_MIGRATION_COUNT=2');
      await expect(
        createReleaseMetadata({ migrationsRoot, outputPath, releaseId }),
      ).rejects.toThrow(/exist/u);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'enforces the same compatibility contract in the target shell validator',
    async () => {
      const fixture = await mkdtemp(join(tmpdir(), 'omnireach-release-validator-'));
      try {
        const metadataPath = join(fixture, 'release.meta');
        await writeFile(metadataPath, metadataSource);
        const validator = join(
          process.cwd(),
          'infrastructure',
          'deploy',
          'validate-release-metadata.sh',
        );
        await expect(
          execFileAsync(validator, ['supports', metadataPath, releaseId, '2', '2']),
        ).resolves.toBeDefined();
        await expect(
          execFileAsync(validator, ['supports', metadataPath, releaseId, '3', '2']),
        ).rejects.toThrow();
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    },
  );
});
