# Backups

`backup.mjs` creates authenticated AES-256-GCM archives with per-member and envelope
checksums. `backup-cli.mjs` adds an opt-in S3-compatible off-site adapter plus
`backup`, `list`, `verify`, `restore-to-disposable`, and dry-run `prune` commands. The
retention selector keeps the recent three daily and one weekly recovery point, and
restore accepts only an explicit isolated namespace. Production destination, budget,
key custody, deletion authority, schedule and privacy policy remain owner inputs.

The production job first runs `pg_dump --format=custom`, inventories original media and
artifact manifests by site, encrypts before transfer, validates both copies, and records
nonsecret status metadata. Monthly restore drills use a new database/storage namespace.
Never restore over an active database or media root.

Pass `--record-database-url-file <protected-worker-url-file>` to backup, applied prune,
and database restore-drill commands to keep `backup_records` authoritative for ORAP.
The URL is read from a regular, non-symbolic, permission-restricted file and never from
a command-line literal. The recorder assumes the restricted `omnireach_worker` role,
uses the encrypted envelope hash as its idempotency identity, and stores only bounded
operational metadata. Its database manifest is reduced to format version, file count,
and total source bytes; customer filenames and archive members are rejected.
`BACKUP_KEY_VERSION` is a non-secret positive integer used to identify the key
generation; the key itself remains in a separate protected file.
Failed backup, integrity, and off-site operations write only a fixed safe error class to
a deduplicated platform alert through a narrowly granted database function. A later
recorded success resolves that alert. Provider bodies, paths, command output, and
credentials are never used as alert text. Email escalation remains separately gated by
the approved alert-delivery configuration.

Resource limits fail closed before the current in-memory archive format exceeds its
configured source, encrypted-object, decompressed-archive, member-count, R2-request,
listing-page, listing-response, or listing-object budget. Remote response bodies are
read through a streaming byte counter even when `Content-Length` is absent. The sanitized defaults are documented in
`infrastructure/compose/production.env.example`. Measure the real dataset before
activation; exceeding a limit is an operational alert and requires a reviewed streaming
format or capacity change, never silently omitting backup inputs.

`restore-to-disposable` extracts only into a new or empty path. When supplied a
`--database-url-file`, it additionally invokes `pg_restore --exit-on-error` against that
disposable database. Production mode fails closed unless both filesystem and database
target deny-lists are configured, and rejects a target that overlaps either one.

Applied retention always requires a protected `--audit-log`. Manual deletion also
requires the owner's non-secret `--authorization-ref`; the log records requested and
completed phases, exact backup ID, storage reference, and envelope checksum. The only
authorization-free mode is `--automated-retention`, which is hard-bound to the approved
3-daily/1-weekly policy. Archive data is deleted before its manifest so a partial failure
does not make a remaining archive undiscoverable. When recording is enabled, local and
off-site deletion times are tracked independently; the recovery point becomes `pruned`
only after every recorded copy is gone, and active or held records cannot be marked.

## Production deployment profile

R-005 authorizes an installation that writes daily compressed encrypted archives to
`/opt/backups/omnireach/`, targeting 3 daily and 1 weekly recovery point subject to
explicit capacity checks. Its scope is PostgreSQL,
editable site content, uploaded media, and important platform configuration; build
caches and regenerable artifacts are excluded. Integrity validation remains mandatory,
and the profile must support a monthly isolated restore test.

The owner may download and checksum-verify an encrypted archive weekly using SFTP or
SCP. This manual copy is not an automated off-server backup and can exceed the approved
24-hour RPO. It therefore cannot satisfy the G31 production gate, which requires 3
daily and 1 weekly recovery point plus an automated encrypted off-server copy.

The owner is the sole encryption-key custodian and the only person who may approve a
manual deletion. Every manual deletion must log the authorization and exact archive
manifest/checksum. Automated deletion is permitted only when enforcing the production
3-daily/1-weekly policy. Capacity pressure must alert and pause rather than prune below
that target.

The repository includes a hardened Compose operation, a systemd service/timer, and the
`tooling/configure-r2-backup.ps1` operator provisioner. The owner authorized installation
on 2026-10-14. It transfers only the four R2 settings from the ignored local `.env`,
generates the encryption and isolated-restore credentials on the VPS, enables the daily
backup and monthly restore timers, and runs the first verified backup and restore drill.
See `docs/offsite-backup.md` for activation and restore
evidence.
