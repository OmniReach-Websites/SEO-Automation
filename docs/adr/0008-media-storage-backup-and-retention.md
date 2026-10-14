# ADR 0008: Media storage, backup, and retention

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decisions:** D-011, D-016, D-017, D-023

## Context

The initial VPS can host persistent media, but storage must remain portable, isolated, validated, backed up, and outside the public repository. Recovery must cover data/media, not only code.

## Decision

- Use an object-storage interface. V1 production may use a dedicated persistent local filesystem adapter.
- Store site-isolated opaque keys, checksums, metadata, variants, attribution, references, and integrity/quarantine state in PostgreSQL.
- Validate MIME/signature, decoded dimensions, size, filename/path, and SVG policy. Originals are private unless explicitly published.
- Runtime uploads, originals, backups, and unsanitized exports never enter Git.
- Back up PostgreSQL/content/media/manifests and necessary platform configuration daily,
  encrypted; retain 3 daily and 1 weekly recovery points; maintain an encrypted off-server
  copy; perform a full isolated restore monthly.
- Use Cloudflare R2 as the selected production off-server target under a $5 USD monthly
  ceiling, while enforcing conservative controls intended to remain within the Standard
  free tier. Encrypt before upload, use least-privilege credentials, and keep
  encryption keys separate from storage credentials.
- Use a distinct least-privilege R2 API token with the configured Cloudflare account ID;
  do not broaden or reuse the zone DNS token. The bucket name is
  `omnireach-production-backups`, subject to availability verification before creation.
- Apply default retention classes: 30-day operational logs, 90-day job detail, 12-month audit. Content revisions follow site/legal policy and are not silently pruned.

## Alternatives considered

1. **Commit media/runtime content to Git:** rejected for privacy, repository size, and runtime-source conflict.
2. **Local filesystem without abstraction:** rejected because later S3-compatible migration and testability require stable boundaries.
3. **On-server backup only:** rejected because it does not cover VPS/disk loss.
4. **Broad Docker/filesystem pruning:** rejected because target ambiguity can destroy live volumes/backups.

## Consequences

- R-005 supplies Cloudflare R2 as the selected off-server provider and $5 USD as the
  monthly ceiling, plus owner key custody and deletion authority. The 2026-10-14
  activation authorizes configuration but not paid overages.
- The earlier development-only local profile is superseded by the authorized production
  activation. Host-local encrypted archives remain at `/opt/backups/omnireach/`, but the
  same 3-daily/1-weekly policy is enforced on local and automated off-server copies.
- The owner is the sole encryption-key custodian and manual-deletion approver. Manual
  deletions require an audit record. Automated deletion is allowed only when enforcing
  the owner-approved production retention set of 3 daily and 1 weekly recovery points.
  This supersedes the earlier 7-daily/4-weekly proposal as of 2026-10-14.
- Reference-aware delayed garbage collection is required.
- Backup status and restore-test date are operational health signals.
- Initial production completion was evidenced on 2026-10-14 by an automated encrypted
  upload, independent R2 download/authentication, and a real isolated tmpfs PostgreSQL 16
  restore. The 155,720-byte recovery point restored in 2.989 seconds and verified 1
  tenant, 1 site, and 86 RLS policies. Ongoing daily success and monthly restore evidence
  remain operational obligations under the 24-hour RPO and 8-hour RTO objectives.
- Storage migration can preserve site IDs, asset keys/manifests, and artifacts behind the adapter.

## Validation

G12 hostile upload/reference tests, G13 artifact manifests, G29 retention/corruption/monthly restore, and G30 recovery/capacity tests prove the decision.
