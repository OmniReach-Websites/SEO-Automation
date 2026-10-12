import {
  parseVersionedSecretKeyring,
  PostgresMfaKeyRotator,
  type MfaKeyRotationPool,
} from '@omnireach/auth';
import { createDatabase } from '@omnireach/database';

function usage(): never {
  process.stderr.write(
    'Usage: npm run auth:rotate-mfa-key -- (--apply --change-id ID [--batch-size N] | --check-retirement VERSION | --retire VERSION --change-id ID)\n',
  );
  process.exit(64);
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1] ?? usage();
}

const apply = process.argv.includes('--apply');
const retirementVersionValue = optionValue('--check-retirement');
const retireVersionValue = optionValue('--retire');
const selectedOperations =
  Number(apply) + Number(Boolean(retirementVersionValue)) + Number(Boolean(retireVersionValue));
if (selectedOperations !== 1) usage();
const changeId = optionValue('--change-id');
if ((apply || retireVersionValue) && !changeId) usage();
if (retirementVersionValue && changeId) usage();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const keyring = parseVersionedSecretKeyring(
  process.env.MFA_ENCRYPTION_KEYRING_JSON,
  process.env.MFA_ENCRYPTION_KEY,
);
const database = createDatabase(databaseUrl);
const rotator = new PostgresMfaKeyRotator(database.pool as unknown as MfaKeyRotationPool, keyring);

try {
  if (retirementVersionValue) {
    const version = Number(retirementVersionValue);
    const report = await rotator.retirementReport(version);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!report.canRetire && !report.retired) process.exitCode = 2;
  } else if (retireVersionValue) {
    const version = Number(retireVersionValue);
    const result = await rotator.retireKey(version, changeId ?? usage());
    process.stdout.write(
      `${JSON.stringify({
        activeVersion: result.activeVersion,
        mfaFactorReferences: result.mfaFactorReferences,
        pendingDeliveryReferences: result.pendingDeliveryReferences,
        retired: result.retired,
        version: result.version,
      })}\n`,
    );
  } else {
    if (keyring.keys.size < 2) {
      throw new Error('Rotation requires an active key and at least one retained old key');
    }
    const rawBatchSize = optionValue('--batch-size') ?? '100';
    const batchSize = Number(rawBatchSize);
    let rotated = 0;
    let remaining = 0;
    for (;;) {
      const result = await rotator.rotateBatch(changeId ?? usage(), batchSize);
      rotated += result.rotated;
      remaining = result.remaining;
      if (remaining === 0) break;
      if (result.rotated === 0) {
        throw new Error('Rotation made no progress; retry after concurrent work completes');
      }
    }
    process.stdout.write(
      `${JSON.stringify({ activeVersion: keyring.activeVersion, remaining, rotated, state: 'rotated' })}\n`,
    );
  }
} finally {
  await database.close();
}
