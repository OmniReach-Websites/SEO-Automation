# Backups

`backup.mjs` creates authenticated AES-256-GCM archives with per-member and envelope
checksums. `backup-cli.mjs` adds an opt-in S3-compatible off-site adapter plus
`backup`, `list`, `verify`, `restore-to-disposable`, and dry-run `prune` commands. The
retention selector keeps the recent seven daily and four weekly recovery points, and
restore accepts only an explicit isolated namespace. Production destination, budget,
key custody, deletion authority, schedule and privacy policy remain owner inputs.

The production job first runs `pg_dump --format=custom`, inventories original media and
artifact manifests by site, encrypts before transfer, validates both copies, and records
nonsecret status metadata. Monthly restore drills use a new database/storage namespace.
Never restore over an active database or media root.

## Development-stage deployment profile

R-005 permits a later, separately authorized development installation that writes daily
compressed encrypted archives to `/opt/backups/omnireach/`, targeting 3 daily and 2
weekly recovery points subject to explicit capacity checks. Its scope is PostgreSQL,
editable site content, uploaded media, and important platform configuration; build
caches and regenerable artifacts are excluded. Integrity validation remains mandatory,
and the profile must support a monthly isolated restore test.

The owner may download and checksum-verify an encrypted archive weekly using SFTP or
SCP. This manual copy is not an automated off-server backup and can exceed the approved
24-hour RPO. It therefore cannot satisfy the G31 production gate, which still requires 7
daily and 4 weekly recovery points plus an automated encrypted off-server copy.

The owner is the sole encryption-key custodian and the only person who may approve a
manual deletion. Every manual deletion must log the authorization and exact archive
manifest/checksum. Automated deletion is permitted only when enforcing the production
7-daily/4-weekly policy, so the development profile must alert and pause on capacity
pressure rather than automatically prune to its 3-daily/2-weekly target.

The repository tooling and disposable verification harness are implemented. No host
directory, schedule, real bucket, production backup, pruning, transfer or spending is
created or performed without separate explicit authorization. See
`docs/offsite-backup.md` for activation and restore evidence.
