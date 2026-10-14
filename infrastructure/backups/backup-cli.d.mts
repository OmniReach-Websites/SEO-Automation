export interface BackupCliResult {
  readonly applied?: boolean;
  readonly mode?: 'automatic' | 'manual';
  readonly prune?: readonly string[];
  readonly [key: string]: unknown;
}

export function runBackupCli(
  argv: readonly string[],
  environment?: Record<string, string | undefined>,
): Promise<BackupCliResult>;

export function backupErrorCode(
  error: unknown,
  phase: 'backup' | 'restore' | 'verify',
):
  | 'backup_failed'
  | 'backup_resource_limit'
  | 'database_dump_failed'
  | 'integrity_verification_failed'
  | 'offsite_transfer_failed';
