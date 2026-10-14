# Off-Site Backup, Retention and Restore

## Recoverable set

The encrypted archive contains a PostgreSQL custom-format dump, customer uploads/media, published artifact manifests and the non-secret configuration inventory needed to map a release. Git retains code/templates/manifests. Caches, dependencies, container layers, plaintext secrets and provider credentials are excluded.

`backup-cli.mjs` supports `backup`, `list`, `verify`, `restore-to-disposable` and `prune`. Archives use AES-256-GCM plus member/envelope hashes before S3-compatible transfer. The S3 adapter supports a dedicated endpoint/bucket/prefix and scoped credentials. Verification downloads and authenticates ciphertext; restore refuses a production target and performs path-containment checks. Pruning is dry-run by default and production retention cannot be configured below 7 daily and 4 weekly points.

Example operator sequence (secret values stay in the approved environment/secret mounts):

```text
npm run backup
npm run backup:list
npm run backup:verify -- --offsite-key <exact-object-key>
npm run backup:restore -- --offsite-key <exact-object-key> --destination <new-isolated-directory> --database-url-file <protected-disposable-url-file> --record-database-url-file <protected-worker-url-file> --key-file <protected-key-file> --confirm-isolated RESTORE
npm run backup:prune -- --dry-run
```

Run `npm run verify:backup-harness` and `npm run verify:offsite-backup` before release. Corrupt, truncated, wrong-key, missing-object and production-target cases must fail closed.

The implemented restore option is `--database-url-file <protected-file>`, not a literal
URL argument; credentials must never appear in a process list or shell history. Use
`--confirm-isolated RESTORE`. Production execution also requires non-secret
`OMNIREACH_PRODUCTION_DATABASE_TARGETS` identities such as
`postgres:5432/omnireach`, and rejects those exact databases.

Production backup, applied prune, and database restore-drill runs also use
`--record-database-url-file <protected-worker-url-file>`. This is a separate restricted
OmniReach connection used only to write non-secret `backup_records` status. It allows
ORAP to report the latest recovery point, integrity verification, off-site copy, and
restore-drill freshness without exposing object keys, manifests, hashes, credentials,
archive contents, or customer filenames. The database status manifest is restricted to
format version, file count, and total source bytes. Until scheduled commands use this
option, ORAP correctly reports that no recorded backup evidence is available.
`BACKUP_KEY_VERSION` identifies the active key generation and never contains the
encryption key.

When status recording is enabled, a failed backup, integrity check, restore, or R2
operation opens or increments one deduplicated platform alert using a fixed safe error
class. A later successful recorded operation resolves it. Raw command/provider errors,
paths, object keys, and secret values are excluded. ORAP alerting is repository-ready;
urgent email still depends on the separately approved Resend activation and must not be
claimed active from this code alone.

The current archive implementation is deliberately bounded because it authenticates and
verifies the complete encrypted object in memory. Defaults cap source bytes, encrypted
bytes, decompressed archive bytes, file count, R2 requests, listing pages, listing response
bytes, and listed objects. Remote bodies are counted while streaming, including when a
provider omits `Content-Length`. An exceeded cap is a failed backup, not permission to omit
content. Record measured production sizes before activation and implement a reviewed
streaming archive format before raising limits beyond safe host headroom.

Retention is dry-run unless `--apply` is supplied. Every applied run requires
`--audit-log <protected-jsonl>`. Manual runs additionally require the owner's non-secret
`--authorization-ref`; automatic runs use `--automated-retention` and refuse anything
other than 7 daily and 4 weekly copies. Holds and active recovery points are preserved
even when they fall outside the ordinary count. Local and off-site deletion timestamps
are separate; the database marks a recovery point pruned only when all recorded copies
have been deleted.

## Retention, freshness and alerts

Target cadence is daily, 7 daily plus 4 weekly recovery points, daily integrity verification and monthly full isolated restore. The 24-hour RPO and 8-hour RTO are planning targets until measured by a timed production-data-volume drill. Backup failure, off-site upload/verification failure, stale latest recovery point and restore failure create operational alerts without secret/object contents.

## Production service installation

The production service runs as a hardened, one-shot Compose operation from the current
immutable release. PostgreSQL and platform data remain on their private networks and
volumes. The backup container receives the database passwords, R2 access-key pair, and
backup-encryption key through Docker secret files. It builds temporary database URLs
inside a private container tmpfs; they are not command arguments, Docker environment
metadata, Git content, or systemd unit values.

From the repository root on the approved operator workstation, populate only
`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` in the ignored
`.env` file, then run:

```powershell
pwsh -File tooling/configure-r2-backup.ps1
```

The provisioner transfers only those four settings over the authenticated SSH session.
The VPS installer writes the R2 pair into root-owned secret files, generates the
independent AES-256 backup key directly on the VPS when absent, strips any backup-secret
keys from `production.env`, installs the systemd service/timer, and requests the first
backup. It never prints secret values. Use `-SkipFirstBackup` only when installing the
timer before a separately scheduled first run.

The timer runs daily at 02:30 America/Chicago with up to 15 minutes of jitter and
catch-up after downtime. Each successful run:

1. produces a custom-format PostgreSQL dump and inventories assets, publications, and a
   non-secret release/configuration descriptor;
2. encrypts and verifies the local archive;
3. uploads archive and manifest to the private R2 prefix;
4. downloads and authenticates the uploaded archive as a separate-copy check; and
5. applies only the approved automated 7-daily/4-weekly retention selector locally and
   off-site, with a protected deletion audit log.

Inspect status without reading any secret file:

```text
systemctl status omnireach-backup.timer --no-pager
systemctl status omnireach-backup.service --no-pager
systemctl list-timers omnireach-backup.timer --no-pager
journalctl -u omnireach-backup.service --since today --no-pager
```

The service output is intentionally limited to non-secret completion metadata. Do not
copy the environment file, Docker secret files, archive contents, or credential values
into tickets, chat, logs, or Git.

## Cost worksheet

Record compressed encrypted database size, media/artifact size, daily change rate, 7+4 retained bytes, monthly requests/egress and provider price at approval time. Add a safety margin and compare against the proposed $5 monthly ceiling. The owner authorized and created the dedicated R2 bucket and credential on 2026-10-13; this does not authorize paid overages, a production schedule, or manual backup deletion.

## Production activation evidence

- [x] dedicated private R2 bucket and least-privilege object-list/get/put/delete credential scoped to that bucket; application-side key validation restricts operations to `omnireach/`;
- [x] one non-backup transport probe uploaded, downloaded and checksum-verified, listed, and removed successfully;
- [ ] encryption key and R2 credential are installed as separate host-only secret files;
- [ ] the host-only systemd timer is enabled and a failure is observable in ORAP;
- first upload verifies from a separate download;
- a monthly disposable restore verifies migrations, tenant isolation, counts, media links and a known published artifact;
- measured RPO/RTO and cost are recorded before the capability is called Live.

The bucket uses Standard storage in Cloudflare's provider-selected WNAM location. It has
no public `r2.dev` exposure, custom domain, or CORS policy. Do not add a blanket
age-based deletion lifecycle: the application retention selector must preserve seven
daily and four weekly recovery points before any automated deletion is enabled.
