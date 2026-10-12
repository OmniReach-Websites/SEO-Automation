import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  assertManifestMatchesSourceCapabilities,
  assertReleaseMetadataSupports,
  createReleaseMetadata,
  parseReleaseContractManifest,
  parseReleaseMetadata,
  renderReleaseMetadata,
} from '../../infrastructure/deploy/create-release-metadata.mjs';

const releaseId = 'a'.repeat(40);
const execFileAsync = promisify(execFile);
const legacyContract = {
  authContract: 2,
  cryptoReadMaximum: 1,
  cryptoReadMinimum: 1,
  cryptoWrite: 1,
  schemaMaximum: 2,
  schemaMinimum: 2,
  schemaTarget: 2,
};
const keyringAuthV2Contract = {
  ...legacyContract,
  cryptoReadMaximum: 2,
  cryptoWrite: 2,
};
const webAuthnContract = {
  ...keyringAuthV2Contract,
  authContract: 3,
};
const metadataSource = renderReleaseMetadata({
  contract: webAuthnContract,
  migrationCount: 2,
  migrationHead: '20261010250000_g05_account_authentication_policy',
  releaseId,
});

describe('immutable release contract metadata', () => {
  it('binds authentication, schema, and crypto contracts to the exact source commit', () => {
    const metadata = parseReleaseMetadata(metadataSource, releaseId);

    expect(metadata).toMatchObject({
      authContract: 3,
      cryptoReadMaximum: 2,
      cryptoReadMinimum: 1,
      cryptoWrite: 2,
      releaseId,
      schemaMaximum: 2,
      schemaMinimum: 2,
      schemaTarget: 2,
    });
    expect(() => parseReleaseMetadata(metadataSource, 'b'.repeat(40))).toThrow('identity mismatch');
  });

  it('rejects duplicate fields and authentication/schema/crypto-incompatible rollbacks', () => {
    expect(() =>
      parseReleaseMetadata(`${metadataSource}OMNIREACH_AUTH_CONTRACT=3\n`, releaseId),
    ).toThrow('Duplicate');
    const metadata = parseReleaseMetadata(metadataSource, releaseId);
    expect(() =>
      assertReleaseMetadataSupports(metadata, {
        authContract: 2,
        cryptoContract: 2,
        schemaContract: 2,
      }),
    ).toThrow('authentication contract');
    expect(() =>
      assertReleaseMetadataSupports(metadata, {
        authContract: 3,
        cryptoContract: 2,
        schemaContract: 3,
      }),
    ).toThrow('schema contract');
    const legacyWriterWithKeyringReader = parseReleaseMetadata(
      renderReleaseMetadata({
        contract: { ...legacyContract, cryptoReadMaximum: 2 },
        migrationCount: 2,
        migrationHead: '20261010250000_g05_account_authentication_policy',
        releaseId,
      }),
      releaseId,
    );
    expect(
      assertReleaseMetadataSupports(legacyWriterWithKeyringReader, {
        authContract: 2,
        cryptoContract: 2,
        schemaContract: 2,
      }),
    ).toBe(true);
    const preKeyringMetadata = parseReleaseMetadata(
      renderReleaseMetadata({
        contract: legacyContract,
        migrationCount: 2,
        migrationHead: '20261010250000_g05_account_authentication_policy',
        releaseId,
      }),
      releaseId,
    );
    expect(() =>
      assertReleaseMetadataSupports(preKeyringMetadata, {
        authContract: 2,
        cryptoContract: 2,
        schemaContract: 2,
      }),
    ).toThrow('crypto/keyring contract');
  });

  it('requires the manifest to track keyring and exact-RP WebAuthn source capabilities', () => {
    const parsed = parseReleaseContractManifest(`{
      "manifestVersion": 1,
      "authContract": 2,
      "schema": { "minimum": 2, "maximum": 2, "target": 2 },
      "crypto": { "readMinimum": 1, "readMaximum": 1, "write": 1 }
    }`);
    expect(parsed).toEqual(legacyContract);
    const keyringSource = `
      export interface VersionedSecretKeyring {}
      export function createVersionedSecretKeyring() {}
    `;
    expect(() => assertManifestMatchesSourceCapabilities(parsed, keyringSource)).toThrow(
      'requires crypto contract 2',
    );
    expect(() =>
      assertManifestMatchesSourceCapabilities(
        { ...legacyContract, cryptoReadMaximum: 2 },
        keyringSource,
      ),
    ).toThrow('requires crypto contract 2');
    expect(() =>
      assertManifestMatchesSourceCapabilities(keyringAuthV2Contract, 'legacy source'),
    ).toThrow('absent from source');
    expect(assertManifestMatchesSourceCapabilities(keyringAuthV2Contract, keyringSource)).toBe(
      true,
    );
    const webAuthnSource = `
      export const webAuthnCeremonyTtlSeconds = 300;
      export function verifyExactHostWebAuthnAuthentication() {}
    `;
    expect(() =>
      assertManifestMatchesSourceCapabilities(keyringAuthV2Contract, keyringSource, webAuthnSource),
    ).toThrow('requires authentication contract 3');
    expect(() => assertManifestMatchesSourceCapabilities(webAuthnContract, keyringSource)).toThrow(
      'absent from source',
    );
    expect(
      assertManifestMatchesSourceCapabilities(webAuthnContract, keyringSource, webAuthnSource),
    ).toBe(true);
  });

  it('creates metadata once from the ordered migration set', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'omnireach-release-metadata-'));
    try {
      const migrationsRoot = join(fixture, 'migrations');
      const authSecretsPath = join(fixture, 'secrets.ts');
      const manifestPath = join(fixture, 'release-contract.json');
      const outputPath = join(fixture, 'release.meta');
      await mkdir(join(migrationsRoot, '20260101000000_first'), { recursive: true });
      await mkdir(join(migrationsRoot, '20260202000000_second'));
      await writeFile(authSecretsPath, 'export function encryptMfaSecret() {}\n');
      await writeFile(
        manifestPath,
        JSON.stringify({
          authContract: 2,
          crypto: { readMaximum: 1, readMinimum: 1, write: 1 },
          manifestVersion: 1,
          schema: { maximum: 2, minimum: 2, target: 2 },
        }),
      );

      const input = {
        authSecretsPath,
        authWebAuthnPath: join(fixture, 'missing-legacy-webauthn.ts'),
        manifestPath,
        migrationsRoot,
        outputPath,
        releaseId,
        sourceCommit: releaseId,
      };
      await createReleaseMetadata(input);
      const generated = await readFile(outputPath, 'utf8');
      expect(generated).toContain('OMNIREACH_MIGRATION_HEAD=20260202000000_second');
      expect(generated).toContain('OMNIREACH_MIGRATION_COUNT=2');
      await expect(createReleaseMetadata(input)).rejects.toThrow(/exist/u);
      await expect(
        createReleaseMetadata({
          ...input,
          outputPath: join(fixture, 'wrong-source.meta'),
          sourceCommit: 'b'.repeat(40),
        }),
      ).rejects.toThrow('does not match checked-out source');
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
        const legacyMetadataPath = join(fixture, 'legacy-release.meta');
        await writeFile(
          legacyMetadataPath,
          renderReleaseMetadata({
            contract: legacyContract,
            migrationCount: 2,
            migrationHead: '20261010250000_g05_account_authentication_policy',
            releaseId,
          }),
        );
        const validator = join(
          process.cwd(),
          'infrastructure',
          'deploy',
          'validate-release-metadata.sh',
        );
        await expect(
          execFileAsync(validator, ['supports', metadataPath, releaseId, '2', '3', '2']),
        ).resolves.toBeDefined();
        await expect(
          execFileAsync(validator, ['supports', metadataPath, releaseId, '3', '3', '2']),
        ).rejects.toThrow();
        await expect(
          execFileAsync(validator, ['supports', legacyMetadataPath, releaseId, '2', '3', '2']),
        ).rejects.toThrow();
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    },
  );
});
