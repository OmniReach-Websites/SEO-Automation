import type { Pool } from 'pg';

export class PostgresBackupRecords {
  constructor(options: { databaseUrl?: string; pool?: Pool });
  close(): Promise<void>;
  recordComplete(input: {
    byteSize: number;
    createdAt: Date;
    envelopeHash: string;
    keyVersion: number;
    kind: 'daily' | 'weekly';
    manifest: { fileCount: number; formatVersion: 1; sourceBytes: number };
    offServerCopiedAt?: Date;
    offServerRef?: string;
    storageRef: string;
    verifiedAt: Date;
  }): Promise<string>;
  recordPruned(envelopeHash: string, source: 'local' | 'offsite'): Promise<string | undefined>;
  recordRestoreTest(envelopeHash: string, restoredAt: Date): Promise<string>;
  recordVerification(envelopeHash: string, verifiedAt: Date): Promise<string>;
  reportFailure(errorCode: string): Promise<void>;
  resolveFailureAlert(): Promise<void>;
}
