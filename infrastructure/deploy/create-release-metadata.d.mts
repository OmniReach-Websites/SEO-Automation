export interface ReleaseMetadata {
  authContract: number;
  migrationCount: number;
  migrationHead: string;
  releaseId: string;
  schemaMaximum: number;
  schemaMinimum: number;
  schemaTarget: number;
}

export function renderReleaseMetadata(input: {
  migrationCount: number;
  migrationHead: string;
  releaseId: string;
}): string;

export function parseReleaseMetadata(source: string, expectedReleaseId: string): ReleaseMetadata;

export function assertReleaseMetadataSupports(
  metadata: ReleaseMetadata,
  requirements: { authContract: number; schemaContract: number },
): true;

export function createReleaseMetadata(input: {
  migrationsRoot: string;
  outputPath: string;
  releaseId: string;
}): Promise<void>;
