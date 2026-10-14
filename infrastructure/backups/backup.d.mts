export interface BackupManifest {
  readonly createdAt: string;
  readonly files: readonly { readonly name: string; readonly sha256: string }[];
  readonly formatVersion: 1;
  readonly kind: 'daily' | 'weekly';
  readonly sourceBytes: number;
}

export interface BackupRecord extends BackupManifest {
  readonly byteSize: number;
  readonly envelopeHash: string;
  readonly id: string;
}

export function createEncryptedBackup(options: {
  createdAt: Date;
  destinationRoot: string;
  encryptionKeyHex: string;
  inputPaths: readonly string[];
  kind: 'daily' | 'weekly';
  maximumFiles?: number;
  maximumSourceBytes?: number;
}): Promise<{
  backupPath: string;
  byteSize: number;
  envelopeHash: string;
  id: string;
  manifest: BackupManifest;
}>;

export function restoreEncryptedBackup(options: {
  backupPath: string;
  destinationRoot: string;
  encryptionKeyHex: string;
  maximumArchiveBytes?: number;
  maximumEncryptedBytes?: number;
  maximumFiles?: number;
  maximumSourceBytes?: number;
}): Promise<BackupManifest>;

export function verifyEncryptedBackup(options: {
  backupPath: string;
  encryptionKeyHex: string;
  maximumArchiveBytes?: number;
  maximumEncryptedBytes?: number;
  maximumFiles?: number;
  maximumSourceBytes?: number;
}): Promise<BackupManifest>;

export function runLogicalDump(databaseUrl: string, targetPath: string): Promise<void>;
export function runLogicalRestore(databaseUrl: string, dumpPath: string): Promise<void>;
export function envelopeHashForFile(path: string): Promise<string>;

export function selectRetention(
  manifests: readonly {
    active: boolean;
    complete: boolean;
    createdAt: string;
    hold: boolean;
    id: string;
    kind: string;
  }[],
  now: Date,
  policy?: { daily?: number; weekly?: number },
): { keep: string[]; prune: string[] };
