# Off-Site Backup, Retention and Restore

## Recoverable set

The encrypted archive contains a PostgreSQL custom-format dump, customer uploads/media, published artifact manifests and the non-secret configuration inventory needed to map a release. Git retains code/templates/manifests. Caches, dependencies, container layers, plaintext secrets and provider credentials are excluded.

`backup-cli.mjs` supports `backup`, `list`, `verify`, `restore-to-disposable` and `prune`. Archives use AES-256-GCM plus member/envelope hashes before S3-compatible transfer. The S3 adapter supports a dedicated endpoint/bucket/prefix and scoped credentials. Verification downloads and authenticates ciphertext; restore refuses a production target and performs path-containment checks. Pruning is dry-run by default and production retention cannot be configured below 7 daily and 4 weekly points.

Example operator sequence (secret values stay in the approved environment/secret mounts):

```text
npm run backup
npm run backup:list
npm run backup:verify -- --offsite-key <exact-object-key>
npm run backup:restore -- --offsite-key <exact-object-key> --destination <new-isolated-directory> --database-url <disposable-database-url>
npm run backup:prune -- --dry-run
```

Run `npm run verify:backup-harness` and `npm run verify:offsite-backup` before release. Corrupt, truncated, wrong-key, missing-object and production-target cases must fail closed.

## Retention, freshness and alerts

Target cadence is daily, 7 daily plus 4 weekly recovery points, daily integrity verification and monthly full isolated restore. The 24-hour RPO and 8-hour RTO are planning targets until measured by a timed production-data-volume drill. Backup failure, off-site upload/verification failure, stale latest recovery point and restore failure create operational alerts without secret/object contents.

## Cost worksheet

Record compressed encrypted database size, media/artifact size, daily change rate, 7+4 retained bytes, monthly requests/egress and provider price at approval time. Add a safety margin and compare against the proposed $5 monthly ceiling. No R2 bucket, spend, schedule or production deletion is authorized by this document.

## Production activation — Waiting

- owner provisions a versioned R2 bucket and least-privilege object-list/get/put/delete credential restricted to one prefix;
- encryption key and R2 credential have separate custodians/storage;
- a host-only job and failure notification are reviewed and enabled;
- first upload verifies from a separate download;
- a monthly disposable restore verifies migrations, tenant isolation, counts, media links and a known published artifact;
- measured RPO/RTO and cost are recorded before the capability is called Live.
