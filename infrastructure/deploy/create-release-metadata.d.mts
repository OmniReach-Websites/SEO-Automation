export interface ReleaseMetadata {
  authContract: number;
  cryptoReadMaximum: number;
  cryptoReadMinimum: number;
  cryptoWrite: number;
  migrationCount: number;
  migrationHead: string;
  releaseId: string;
  schemaMaximum: number;
  schemaMinimum: number;
  schemaTarget: number;
}

export interface ReleaseContract {
  authContract: number;
  cryptoReadMaximum: number;
  cryptoReadMinimum: number;
  cryptoWrite: number;
  schemaMaximum: number;
  schemaMinimum: number;
  schemaTarget: number;
}

export function parseReleaseContractManifest(source: string): ReleaseContract;

export function assertManifestMatchesSourceCapabilities(
  contract: ReleaseContract,
  authSecretsSource: string,
  authWebAuthnSource?: string,
): true;

export function renderReleaseMetadata(input: {
  contract: ReleaseContract;
  migrationCount: number;
  migrationHead: string;
  releaseId: string;
}): string;

export function parseReleaseMetadata(source: string, expectedReleaseId: string): ReleaseMetadata;

export function assertReleaseMetadataSupports(
  metadata: ReleaseMetadata,
  requirements: { authContract: number; cryptoContract: number; schemaContract: number },
): true;

export function verifyReleaseContract(input: {
  authSecretsPath: string;
  authWebAuthnPath?: string;
  manifestPath: string;
}): Promise<ReleaseContract>;

export function createReleaseMetadata(input: {
  authSecretsPath: string;
  authWebAuthnPath?: string;
  manifestPath: string;
  migrationsRoot: string;
  outputPath: string;
  releaseId: string;
  sourceCommit: string;
}): Promise<void>;
