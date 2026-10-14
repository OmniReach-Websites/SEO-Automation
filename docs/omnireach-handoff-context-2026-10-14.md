# OmniReach handoff context — October 14, 2026

**Purpose:** authoritative first-read context for the next Codex session or developer

**Repository:** `OmniReach-Websites/SEO-Automation`

**Production branch:** protected `main`

**Active branch:** `feature/offsite-backup-readiness`

**Production baseline observed:** `9fea6a0d40a3fc9484895ef179888f07892b0ccb`

This snapshot supersedes `docs/omnireach-handoff-context-2026-10-13.md` as the first
handoff document to read. Architecture decisions, ADRs, runbooks, production inputs,
and the roadmap remain authoritative for their respective details. Never place a
password, token, private key, recovery code, customer submission, or database content
in this document.

## Product and operating model

OmniReach is permanently agency-first. It is not a self-service website builder.
OmniReach staff operate the OmniReach Administration Platform (ORAP), while authorized
customers use site-specific customer administration surfaces. Customer websites may
have completely custom designs but must implement the versioned OmniReach integration
contract.

GitHub is authoritative for application source, templates, migrations, deployment
definitions, and sanitized configuration. PostgreSQL is authoritative for live editable
content, protected facts, identities, permissions, integrations, jobs, subscriptions,
audit events, and operational state. Redis/BullMQ is transport, not durable job truth.

Public websites are immutable static releases. They must remain available when the API,
database, queues, workers, or external providers are unavailable. Activation is atomic,
and a failed build or health check must preserve the previously active release.

## Known production surfaces

The last recorded evidence reported HTTP 200 for:

| Surface            | URL                                          |
| ------------------ | -------------------------------------------- |
| ORAP/API readiness | `https://admin.omnireach.cloud/health/ready` |
| OmniReach site     | `https://omnireach.cloud/`                   |
| Terms              | `https://omnireach.cloud/tos`                |
| Privacy            | `https://omnireach.cloud/privacy`            |
| Coop pilot         | `https://coopsmobiledetailingaledo.com/`     |

The OmniReach site uses GA4 measurement ID `G-5H7ZB5HMLC`; the Coop pilot uses
`G-B6S8N9JHL8`. They are consent-aware and site-specific. Never copy one site's
measurement ID into another site.

Production also contains PostgreSQL, Redis, the API, scheduler, recovery runner,
publisher, crawler, SEO, monitoring, and Google metrics worker services. Caddy is the
shared TLS/router service. Christians Reunite is a protected independent workload and
must not be changed or disrupted by OmniReach work.

## Security boundaries

- Resolve tenant and site context from verified hostnames and authorized database
  records; never trust a request-supplied tenant or site by itself.
- Enforce authorization in both the API and PostgreSQL RLS. Keep composite tenant/site
  references and transaction-scoped database context.
- PostgreSQL and Redis stay on private Docker networks without public host ports.
- Keep secure host-only cookies, origin and CSRF checks, Argon2id passwords, rate limits,
  session revocation, and durable audit logs.
- Platform Owner, Platform Admin, and Staff require two-step verification. Email codes
  are allowed but are weaker than TOTP or WebAuthn. Sensitive owner recovery/security
  changes require stronger verification or the explicitly approved recovery process.
- Customer MFA is optional by default. Customer identities and sessions stay isolated by
  tenant and verified admin hostname. ORAP administrators can revoke customer sessions.
- AI may act only on eligible fields in `AUTO` or `SUGGEST` mode. It must never modify
  protected business facts or bypass site/platform spending caps.
- Previews are authenticated, expiring, site-bound, and `noindex`.
- Queue payloads contain bounded identifiers, not secrets or customer content.

## Current identity policy

ORAP supports password authentication with required account-level two-step policy for
privileged staff. Email verification codes are hashed, single-use, expire after five
minutes, and have resend/attempt limits. TOTP and WebAuthn remain optional stronger
methods. A full privileged session must not be issued until required verification
succeeds, and password reset must not bypass that requirement. Recovery codes are held
by the account owner and must never be logged or committed.

Customer Owner, Editor, and Viewer accounts use email/password by default and may opt
into supported email-code, TOTP, or WebAuthn verification. Staff access administration
retains last-owner and session-revocation safeguards. Current owner-approved UX removes
the separate audit-reason input and permits authorized owners to grant equivalent owner
authority; durable audit events still record the action itself.

## Google integration state

The Google OAuth client uses only:

- `https://www.googleapis.com/auth/webmasters.readonly`;
- `https://www.googleapis.com/auth/analytics.readonly`.

The exact callback is
`https://admin.omnireach.cloud/v1/orap/integrations/google/callback`. OAuth state, PKCE,
nonce, encrypted token storage, exact-site property mapping, safe disconnect behavior,
and site-scoped scheduling are implemented. The owner reported connecting Search
Console and GA4, but stored production values have not yet been reconciled against the
exact provider consoles. Keep this classified as owner-reported rather than verified.

Collectors persist Search Console clicks, impressions, CTR, and position by date/query/
page/country/device and GA4 sessions, active users, and page views by date/source/medium.
Engagement and conversion/key-event measurements are not collected and must render as
unsupported, never as fabricated zeroes.

## Deployed Priority 1: ORAP Analytics & SEO Performance

Priority 1 was reviewed in PR #62, passed both protected CI runs, and was deployed as
protected-main commit `3ded900d2320e892026be36f6a7785098989aae8` by production run
`38522156745`. The slice adds:

- Analytics navigation plus an authorized site selector that defaults to the first
  active authorized site;
- bounded 7-, 28-, and 90-day ranges and a bounded custom range;
- equal-length previous-period comparisons;
- Search Console and GA4 KPI cards with explicit definitions;
- separate accessible charts and a complete tabular equivalent;
- bounded sortable query/page tables with previous values and click deltas;
- deterministic visibility opportunities with explicit limitations;
- crawl/finding health, resolved findings, and safe affected-page evidence;
- a work timeline labeled as correlation rather than causation;
- exact authorized property mapping, persisted availability periods, provider calendar
  semantics, freshness, and safe collection-failure diagnostics;
- honest disconnected, empty, partial, stale, and unsupported states.

The dashboard reads persisted data only. A page request never calls Google. All database
reads execute inside the authorization-revalidating platform transaction and bind both
tenant and site. Dynamic sorting uses server-side allowlists.

### Metric correctness rules

- Search CTR is total clicks divided by total impressions.
- Average position is impression-weighted where stored dimensions support it.
- Organic GA traffic uses the documented/tested `sessionMedium` allowlist.
- Search Console dates use Pacific Time; GA4 dates use the connected property's
  configured time zone. Stored provider date keys are not relabeled as UTC days.
- Standard windows end on the previous UTC day; custom windows are inclusive, no more
  than 90 days, and cannot extend into the future.
- Missing observations are unavailable, not zero.

### Observation identity and migration

Migration `20261013170000_google_metric_observation_identity` changes Google metric
identity to connection + source + metric + canonical dimensions + source window. The
measured value is deliberately excluded, so provider corrections update an existing
observation instead of producing double counts. The migration deterministically
deduplicates prior rows, adds the bounded query index, and grants the platform role the
least-privilege reads needed for analytics evidence while preserving tenant/site RLS for
application and worker roles.

## Deployed Priority 2: Google ingestion hardening

The deployed slice replaced the single Search Console detailed request with separate
date-only property totals, date/query detail, and date/page detail. This prevents KPI
totals from being inferred by summing privacy-filtered query/page/country/device rows.
The branch adds bounded Search Console `startRow` and GA4 `offset` pagination, stable GA4
ordering, versioned collection diagnostics, explicit partial/truncated state, actionable
safe failure codes, and continuation of the other mapped property when one collection
fails. Legacy observations remain a per-date fallback only when the new grain is absent,
preventing overlapping old/new rows from being counted twice.

It also records the last collection attempt independently from the last successfully
stored result, clears old scoped observations atomically when a connection is remapped
to a different provider property, and exposes bounded sync-window diagnostics without
provider response bodies. Repository and disposable production-Compose verification are
complete. PR #63 passed both protected checks and was squash-merged as
`9fea6a0d40a3fc9484895ef179888f07892b0ccb`. Production deployment run `38524868938`
successfully built, tested, packaged, transferred, activated, and verified that exact
commit before removing its ephemeral SSH identity.

## Priority 3 release candidate: backup operational readiness

The active `feature/offsite-backup-readiness` branch contains repository-only backup
hardening. It does not install production secrets, create a schedule, upload production
data, delete a real backup, activate email, or perform a live restore. The candidate:

- creates bounded authenticated AES-256-GCM archives from PostgreSQL custom dumps,
  content/media, and selected configuration inputs;
- rejects symbolic links, unsafe paths, invalid manifests, wrong keys, corrupt or
  truncated data, non-empty restore targets, and configured production filesystem or
  database targets;
- bounds source, encrypted, decompressed, member-count, R2 request/list/response/object
  work, including streaming byte enforcement when `Content-Length` is absent;
- enforces dry-run retention by default, owner authorization plus JSONL audit for manual
  deletion, and exactly 7 daily/4 weekly points for automatic deletion;
- tracks host-local and off-site copy deletion independently so a record becomes pruned
  only after all recorded copies are gone, while preserving active and held points;
- records non-secret recovery, verification, off-site, and restore-drill status through
  the restricted worker role, using protected file-based database URLs;
- opens a deduplicated ORAP platform alert with only a fixed safe error class when a
  recorded backup/integrity/off-site operation fails, and resolves it on success;
- renders an authorization-gated ORAP Backup & Recovery panel without storage paths,
  object keys, manifests, checksums, archive contents, or credentials.

Production status remains unverified until separately authorized secrets are installed,
the host-only daily schedule runs, a separate downloaded R2 copy verifies, and a timed
isolated production-volume restore proves the 24-hour RPO and 8-hour RTO.

## Verification evidence

The deployed Priority 1 slice passed:

- TypeScript typecheck and ESLint;
- 66 unit-test files: 350 passed, 1 skipped;
- 12 integration-test files: 70 passed;
- 15 security-test files: 69 passed;
- 5 Playwright end-to-end tests;
- application build, documentation check, workflow check, and all 57 migrations;
- secret scan of 580 files with zero findings;
- production dependency audit with zero high-severity findings;
- disposable production Compose verification.

The Compose verifier applied every migration, synchronized 89 capabilities and 11 role
templates, provisioned restricted runtime roles, and verified PostgreSQL/Redis
authentication, private isolation, API readiness, persistence after restart, static
availability through a control-plane restart, and all six worker kinds. It also seeded a
disposable authorized site and successfully ran the analytics service against migrated
PostgreSQL with the restricted runtime role. No production resource was changed, and the
harness removed its disposable containers, networks, and volumes.

That real-database check initially exposed a missing platform-role `SELECT` grant on
`publication_requests`. The migration now includes the least-privilege grant, and the
complete rerun passed. Aggregate statements are intentionally sequential on one `pg`
client because concurrent client queries are deprecated for removal in `pg` 9.

Repository-wide Prettier is not a clean baseline signal in this Windows checkout because
many untouched files have CRLF normalization. Changed files still require targeted
formatting, and protected Linux CI is authoritative.

PR #62 and production run `38522156745` completed successfully. Independent checks after
deployment returned 200 for API readiness, OmniReach home, Terms, and the Coop site. An
unauthenticated Analytics request returned 403, proving the page is not public. An
authenticated employee-session rendering smoke remains pending because no session or
purpose-built non-secret smoke credential is available; do not weaken MFA to obtain it.

The Priority 2 release candidate passes 66 unit files (356 passed, 1 skipped), 12
integration files (70 passed), 15 security files (72 passed), 2 contract files (10
passed), and 5 Playwright tests, plus typecheck, lint, build, documentation, Compose,
workflow, 58-migration, Prisma-schema, changed-file formatting, full secret-scan, and
production dependency-audit gates. The disposable production Compose verifier applied
all 58 migrations and repeated the restricted-role analytics, authentication, isolation,
persistence, availability, six-worker, and credential-metadata checks successfully.
Independent post-deployment checks returned 200 for API readiness, OmniReach home,
Terms, and the Coop site. An unauthenticated Analytics request returned 403 as required.

The Priority 3 release candidate passes 68 unit files (366 passed, 1 skipped), 12
integration files (70 passed), 15 security files (72 passed), 2 contract files (10
passed), and 5 Playwright tests. Typecheck, lint, build, documentation, Compose,
workflow, 59-migration, Prisma-schema, changed-file formatting, secret scan of 589 files,
and production dependency audit all pass. The synthetic backup harness verifies
encryption, integrity, isolated restore, retention, hold/active preservation, and
source/encrypted/decompressed limits. The R2 harness verifies signing, scoped prefixes,
upload/download/list/delete, streamed download limits, listing-response/object/page, and
request budgets. The disposable production Compose verifier applied all 59 migrations
and exercised restricted backup status writes, separate local/off-site prune lifecycle,
and backup alert open/resolve transitions, in addition to the existing isolation,
authentication, persistence, static availability, analytics, and six-worker checks.

## Production/provider readiness

| Area                  | State                                             | Remaining proof or owner action                                                                |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Domains and ORAP host | Live                                              | Explicit authorization for each future DNS change                                              |
| Cloudflare            | Zone-scoped access approved                       | Do not mutate DNS without explicit authorization                                               |
| Google                | Connected, owner-reported                         | Reconcile stored metrics with exact Search Console and GA4 properties                          |
| Backups               | Repository-ready; production inactive             | Install separate secrets, enable host schedule, verify real R2 copy/alerts, pass timed restore |
| Resend                | Planned/not activated                             | Verify domain, senders, recipient, key installation, quota, and live delivery                  |
| Contact forms         | Foundation implemented                            | Complete security/deployment testing, recipient/Turnstile setup, retention, legal consent text |
| OpenAI                | Ledger/policy implemented; provider disabled      | Benchmark models and obtain explicit paid-call authorization                                   |
| Subscriptions         | Entitlement controls planned/implemented in parts | Final commercial approval, setup/bespoke fees, collections/cancellation rules                  |
| Legal/privacy         | Partial                                           | Owner-approved final privacy, cookies, terms, consent, and deletion policies                   |

Approved operating targets are 99.5% monthly availability, Sunday 02:00–04:00
America/Chicago maintenance, 24-hour RPO, 8-hour RTO, 30-minute critical and 24-hour
noncritical incident acknowledgment, and approximately ten initial customer sites on
the existing 2-core/8 GiB VPS.

Backups are designed for daily encrypted PostgreSQL/content/media/necessary-config
captures with 7 daily and 4 weekly copies in private Cloudflare R2. The owner is the sole
encryption-key custodian and must authorize logged manual deletion. Production readiness
requires an automated off-site run and a successful isolated restore.

Planned Resend senders are `auth@updates.omnireach.cloud`,
`alerts@updates.omnireach.cloud`, and `forms@updates.omnireach.cloud`. Contact forms are
optional reusable centralized components, configurable per site, with Turnstile,
honeypots, rate limiting, 30-day retention except holds, and confirmations disabled by
default. Do not claim live delivery without current provider evidence.

OpenAI remains disabled in production. The default site cap is $5 per UTC calendar month
and the platform cap is $50, enforced atomically. Model aliases are configurable; current
benchmark candidates are not permanent product promises.

## Deployment and safe continuation

Only verified `main` deploys production. Feature branches and pull requests run CI but
do not deploy. GitHub Actions must use the restricted non-root `omnireach-deploy`
identity, immutable releases, a deployment lock, health checks, and rollback. Do not use
an interactive root credential for routine deployment, grant unrestricted sudo/Docker
access, or modify shared Caddy/Christians Reunite outside an explicitly reviewed change.

Next steps:

1. Review and release `feature/offsite-backup-readiness` through protected CI; this
   repository release does not authorize production backup activation.
2. Continue Priority 4 repository-only Resend/forms and staff UX review after that
   release; keep real delivery disabled.
3. Perform the authenticated Analytics smoke only with a normal verified employee
   session or purpose-built non-secret smoke credential; do not weaken MFA.
4. Keep production metrics unreconciled until stored results are compared with the exact
   Google source consoles, including date window, property time zone, lag, filters, and
   metric semantics.

## Authoritative references

- `docs/overnight-goal-progress.md` — active execution state and evidence
- `docs/architecture.md` and `docs/adr/` — architecture and decisions
- `docs/production-inputs.md` — owner approvals and unresolved production inputs
- `docs/roadmap.md` — dependency-ordered development plan
- `docs/security.md` and `docs/security-test-matrix.md` — security controls/evidence
- `docs/google-integration-runbook.md` — Google behavior and metric semantics
- `docs/operations.md` and `docs/production-compose.md` — operations and deployment
- `docs/integration-contract.md` — custom-site platform contract
