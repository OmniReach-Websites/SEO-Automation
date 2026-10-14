# Overnight goal progress

**Started:** 2026-10-13 (America/Chicago)

**Working branch:** `feature/email-form-operations`
**Source goal:** `OMNIREACH_AUTONOMOUS_OVERNIGHT_GOAL.md`

This file is the durable resume point for the autonomous overnight goal. Evidence states
are strict: `DONE` means implemented and verified, `IN_PROGRESS` means active repository
work, `WAITING_FOR_OWNER` needs a human decision/credential, and
`WAITING_FOR_PRODUCTION_PROOF` needs safe live evidence.

## Current milestone

- `IN_PROGRESS` — Priorities 1, 2, and the repository-only Priority 3 slice are merged
  and deployed through protected workflows. Production backup activation remains
  separately owner-gated and has not occurred.
- Current focus: release the verified Priority 4 email/forms operations slice, then
  continue the employee-facing accessibility and recovery-safe UX review while
  preserving all recorded production-proof gaps.

## Priority checklist

### P1 — ORAP Analytics & SEO Performance

- [x] Analytics navigation and authorized site selector.
- [x] Bounded 7/28/90/custom date-range and period comparison contract.
- [x] KPI cards for supported Search Console and GA4 measurements.
- [x] Accessible supported time series plus complete tabular equivalent.
- [x] Bounded, sortable Top Search Queries and landing pages with period click deltas.
- [x] Deterministic visibility opportunities with explicit limitations.
- [x] Crawl/finding health and actionable drill-down.
- [x] Work-performed timeline aligned with outcomes and labeled as correlation.
- [x] Integration/data-quality/freshness panel and honest partial states.
- [x] API/service authorization, RLS, query-bound, timezone, empty/stale, and UI tests.
- [x] PR, protected CI, protected-main deployment, readiness/public smoke, and
      unauthenticated route-denial evidence.
- [ ] `WAITING_FOR_PRODUCTION_PROOF` — authenticated employee-session dashboard smoke.

### P2 — Google ingestion hardening

- [x] Verify schedule, concurrency, mapping, backoff, and sync status.
- [x] Replace value-dependent source hashes with stable observation identity and a
      correction-safe upsert; add migration and focused tests.
- [x] Add diagnostics and wrong/missing/expired/throttled/partial-backfill tests.
- [ ] `WAITING_FOR_PRODUCTION_PROOF` — compare stored data with the exact Google source
      consoles; OAuth success alone is insufficient.

### P3 — Off-site backups

- [x] Complete safe repository-only backup/retention/alert/restore work and tests.
- [x] Protected PR checks, protected-main merge, production deployment, and independent
      readiness/public/authorization smoke evidence.
- [ ] `WAITING_FOR_OWNER` — production secret installation and schedule activation.
- [ ] `WAITING_FOR_PRODUCTION_PROOF` — timed isolated restore and RPO/RTO evidence.

### P4 — Email/forms and staff UX

- [x] Audit and harden repository-side Resend/form flags, quotas, retries, diagnostics,
      role boundaries, and tests without activating real delivery.
- [ ] Improve remaining employee-facing accessibility and recovery-safe affordances.
- [ ] `WAITING_FOR_OWNER` — activate or send real provider messages only with the
      recorded provider/sender/recipient authorization.

### P5 — AI proposal pipeline

- [ ] Complete durable disabled-by-default proposal job/material/result path and tests.
- [ ] Add synthetic benchmark harness and preserve protected-fact/budget gates.
- [ ] `WAITING_FOR_OWNER` — paid production activation remains disabled.

### P6 — Maintenance

- [ ] Review the six historical Dependabot PRs individually; do not blindly merge.
- [ ] Repair documentation, observability, and failing routine-operation checks found
      during the work.

## Evidence log

### 2026-10-13 — Goal startup

- Read the overnight goal, current context, architecture, production inputs, Google
  runbook, operations baseline, security baseline, and relevant ADRs 0002, 0003, 0007,
  0009, and 0010.
- Fetched `origin/main` and created `feature/orap-analytics-dashboard` from current main.
- Confirmed the preceding documentation-only production run is independent of this
  branch. No production credential or secret value was copied into repository state.
- Previous turn classification: `NO_PROGRESS` for this goal (it completed the separate
  current-context task before the overnight objective existed). This turn has now made
  durable progress by creating this tracked execution checklist and beginning code
  inspection.

### 2026-10-13 — Analytics dashboard repository slice

- Added an `analytics.view`-protected JSON endpoint and server-rendered ORAP Analytics &
  SEO page with an authorized-site selector, 7/28/90/custom source-date windows, equal-period
  comparisons, bounded server-side sorting, KPI definitions, accessible charts/tables,
  deterministic opportunities, technical findings, work timeline and data-quality
  states.
- Reused the existing platform transaction, persisted Google snapshots, crawls,
  findings, jobs and publication records. The page does not poll Google or introduce a
  parallel analytics store.
- Corrected metric idempotency: source identity no longer includes the measured value,
  existing duplicates are deterministically collapsed, and re-finalized values update
  the stored observation instead of adding a second count.
- Added explicit platform-role RLS branches for the crawl/finding/audit/publication
  evidence read by ORAP; exact tenant/site scope remains mandatory for app and worker
  roles, and API capability checks remain site-specific.
- Documented aggregate CTR, impression-weighted position, GA organic-medium rules,
  active-user limitations, unsupported measurements and correlation language in the
  Google runbook.
- Completion review added a sensible first-authorized-site default, separate charts for
  supported Search Console/organic series, all-channel session context, comparable query
  and page click deltas, resolved/affected-page technical evidence, and authorized exact
  property, availability-period and safe failure diagnostics. Source-specific calendar
  semantics are explicit instead of implying that Google observations share UTC days.
- Focused evidence passed: TypeScript typecheck; ESLint; migration checker; 8 analytics/
  idempotency unit tests; 3 analytics integration route tests; 5 relevant security tests;
  and 1 narrow-screen Playwright test.

### 2026-10-14 UTC — Full repository and disposable runtime verification

- Full evidence passed: 66 unit-test files (350 passed, 1 skipped), 12 integration-test
  files (70 passed), 15 security-test files (69 passed), 5 Playwright tests, typecheck,
  lint, build, documentation check, workflow check, 57-migration check, secret scan of
  580 files with zero findings, and production dependency audit with zero high-severity
  findings.
- The disposable production-compose harness applied all migrations, synchronized the
  89-capability/11-template ORAP catalog, provisioned restricted runtime roles, and
  verified PostgreSQL/Redis authentication, private isolation, API readiness,
  persistence after restart, static availability during control-plane restart, six
  healthy worker kinds, and absence of credentials in rendered configuration or
  container metadata. The harness also seeded a disposable authorized site and executed
  the analytics service against migrated PostgreSQL with the restricted runtime role,
  proving the new aggregate queries and RLS/grant path. It removed the disposable stack
  after success.
- The first real-database analytics check exposed a missing platform-role grant on
  `publication_requests`; the migration was corrected and the complete disposable test
  then passed. Analytics queries were also serialized on a single `pg` client to remain
  compatible with the announced `pg` 9 removal of concurrent client queries.
- Repository-wide formatting remains a baseline limitation in this Windows checkout due
  to CRLF normalization across many untouched files. Changed-file formatting and Linux
  protected CI remain required before merge.

### 2026-10-14 UTC — Priority 1 release review

- Refetched `origin/main` and confirmed the feature branch still starts exactly at the
  current protected-main commit with no unexpected ancestry divergence.
- Reviewed the route capability gate, exact site/tenant authorization, bounded SQL,
  migration/RLS changes, stable observation upsert, server-rendered UI wiring, and the
  associated security and integration coverage.
- Every changed Prettier-supported file passes targeted formatting, the Prisma schema
  validates with a disposable non-secret connection string, the documentation checker
  passes, and `git diff --check` reports no content errors. SQL and Prisma files are
  validated by their dedicated migration/schema checks rather than by Prettier, which
  has no configured parser for them.
- Added `docs/omnireach-handoff-context-2026-10-14.md` as the new first-read handoff and
  marked the October 13 snapshot as historical.

### 2026-10-14 UTC — Priority 1 protected release

- Committed the coherent slice as `c6c260e`, pushed only
  `feature/orap-analytics-dashboard`, opened and attached
  [PR #62](https://github.com/OmniReach-Websites/SEO-Automation/pull/62), and observed both
  protected Branch CI runs pass.
- Squash-merged through GitHub as protected-main commit
  `3ded900d2320e892026be36f6a7785098989aae8`. Production deployment run
  [38522156745](https://github.com/OmniReach-Websites/SEO-Automation/actions/runs/38522156745)
  passed the exact-commit test/build, immutable image/package, ephemeral restricted SSH,
  activation, Coop/OmniReach/SEO verification, and identity-removal steps.
- Independent post-deployment checks returned 200 for API readiness, OmniReach home,
  Terms, and Coop. An unauthenticated `/orap/analytics` request returned 403, confirming
  the page is not public. An authenticated employee-session rendering smoke remains
  `WAITING_FOR_PRODUCTION_PROOF`; no MFA or session safeguard was weakened to obtain it.

### 2026-10-14 UTC — Priority 2 ingestion hardening started

- Created `feature/google-ingestion-hardening` from deployed protected-main commit
  `3ded900d` and verified the official Search Console `startRow`/25,000-row and GA4
  `offset`/`limit`/`rowCount` pagination contracts.
- Replaced the single Search Console request grain with independent property-total,
  query, and landing-page grains so KPI totals are not inferred by summing privacy-
  filtered detailed rows. Added bounded pagination for every grain and GA4, a stable GA4
  order, validated versioned collection diagnostics, explicit `partial`/
  `collection_truncated` state, and legacy-date fallback without old/new double counts.
- The runner now continues the other mapped property after one connection fails, then
  surfaces a safe aggregate retryable/permanent job error. A queued job with no connected
  property cancels without a provider call. Provider classification now distinguishes
  missing property, expired authorization, insufficient scope, quota exhaustion,
  provider outage, and generic rejection without storing provider bodies.
- Typecheck and 17 focused Google/analytics unit tests pass, including bounded Search
  and GA pagination, expired authorization, throttling/backoff, correction-safe identity,
  partial diagnostics, cross-property continuation, and the new aggregate grain SQL.

### 2026-10-14 UTC — Priority 2 repository verification complete

- Added a durable `last_attempted_at` marker so ORAP distinguishes a recent failed
  collection attempt from the last successfully stored result. Remapping a connection
  to a different provider property now removes the old property's scoped snapshots and
  clears its sync cursor/status inside the same transaction, preventing old observations
  from being relabeled under a new property.
- Full evidence passed: 66 unit-test files (356 passed, 1 skipped), 12 integration-test
  files (70 passed), 15 security-test files (72 passed), 2 contract-test files (10
  passed), and 5 Playwright tests. Typecheck, lint, build, documentation, Compose,
  workflow, 58-migration, Prisma-schema, changed-file formatting, full secret scan (582
  files, zero findings), and production dependency audit (zero vulnerabilities) passed.
- The disposable production Compose verifier applied all 58 migrations and then passed
  the restricted-role analytics query, PostgreSQL/Redis authentication, private network
  isolation, API readiness, persistence after restart, static-site availability during
  control-plane restart, all six worker kinds, and rendered configuration/container
  metadata secret checks. It removed its disposable resources after success.
- Exact production Google-value reconciliation remains
  `WAITING_FOR_PRODUCTION_PROOF`; no claim of provider-value correctness has been made
  from OAuth success alone.

### 2026-10-14 UTC — Priority 2 protected release

- Committed the coherent slice as `78bdd38`, pushed only
  `feature/google-ingestion-hardening`, opened and attached
  [PR #63](https://github.com/OmniReach-Websites/SEO-Automation/pull/63), and observed both
  protected Branch CI runs pass.
- Squash-merged through GitHub as protected-main commit
  `9fea6a0d40a3fc9484895ef179888f07892b0ccb`. Production deployment run
  [38524868938](https://github.com/OmniReach-Websites/SEO-Automation/actions/runs/38524868938)
  passed exact-commit build/tests, immutable image/package creation, ephemeral restricted
  SSH activation, Coop and OmniReach/SEO verification, and identity removal.
- Independent post-deployment checks returned 200 for API readiness, OmniReach home,
  Terms, and Coop. An unauthenticated `/orap/analytics` request returned 403. The normal
  authenticated employee-session smoke and exact provider-console reconciliation remain
  `WAITING_FOR_PRODUCTION_PROOF` without weakening authentication.

### 2026-10-14 UTC — Priority 3 repository candidate complete

- Hardened encrypted backup creation and restore with safe path/manifest validation,
  logical PostgreSQL empty-target restore, immutable checksums, separate key-version
  metadata, and fail-closed source/encrypted/decompressed/member limits.
- Hardened the R2 adapter with prefix ownership, signed requests, bounded request/page/
  object/list-response work, repeated-token detection, and streaming response limits
  even when a provider omits `Content-Length`.
- Retention is dry-run by default. Manual application requires an owner authorization
  reference and protected JSONL audit; automatic application is fixed to 7 daily and 4
  weekly points. Active/held points survive outside those counts, and archive data is
  removed before its manifest.
- Added restricted PostgreSQL status recording for completed backups, integrity checks,
  copy-specific prune state, and restore drills. Local and off-site deletion timestamps
  are distinct. Added a narrowly granted security-definer function that opens/resolves
  one deduplicated platform backup alert using only fixed non-secret error classes.
- Added an authorization-gated ORAP Backup & Recovery panel with honest no-evidence,
  stale, local-only, failed, and healthy states. It never selects or renders storage
  references, manifests, hashes, credentials, or archive content.
- Full evidence passed: 68 unit files (366 passed, 1 skipped), 12 integration files (70
  passed), 15 security files (72 passed), 2 contract files (10 passed), 5 Playwright
  tests, typecheck, lint, build, docs/Compose/workflow checks, 59 migrations, Prisma
  validation, changed-file formatting, secret scan of 589 files with zero findings, and
  production dependency audit with zero vulnerabilities.
- Synthetic backup/R2 harnesses passed corruption, wrong-key, truncation, non-empty
  target, production-target, resource-limit, request-budget, listing-budget, and
  streaming-download negative cases. The disposable production Compose verifier applied
  all 59 migrations and proved restricted backup writes, independent copy lifecycle,
  platform alert transitions, PostgreSQL/Redis authentication, private networks,
  persistence, API readiness, static availability, analytics, six worker kinds, and no
  credential exposure in rendered config/container metadata; it removed all resources.
- Production secret installation and schedule activation remain `WAITING_FOR_OWNER`.
  A real downloaded-copy verification and timed isolated production-volume restore
  remain `WAITING_FOR_PRODUCTION_PROOF`; repository evidence does not satisfy R-005.

### 2026-10-14 UTC — Priority 3 repository release deployed

- PR #64 passed both protected Branch CI runs and was squash-merged as
  `e7bdb32d877ed58f5989366b3a19924b412dc8cd`.
- Production deployment run
  [38530243019](https://github.com/OmniReach-Websites/SEO-Automation/actions/runs/38530243019)
  rebuilt and tested the exact commit, built immutable images, transferred and activated
  the release through the restricted ephemeral SSH identity, verified both public sites,
  and removed the identity.
- Independent post-deployment checks returned 200 for API readiness, OmniReach home,
  Terms, and Coop. Unauthenticated `/orap/operations` returned 403 as required.
- No production backup credentials, schedule, uploads, deletions, or restore actions were
  activated by this release.

### 2026-10-14 UTC — Priority 4 email/forms operations candidate complete

- Added a PostgreSQL-authoritative UTC monthly email policy and reservation lifecycle
  shared by alert, authentication, contact, and platform-inquiry delivery. The initial
  no-spend cap is 3,000 messages. Restricted application/worker transactions call only
  security-definer reserve/finalize functions; the NOINHERIT runtime login cannot read
  the underlying tables directly.
- Quota state excludes recipients, subjects, bodies, form values, verification codes,
  credentials, and provider responses. It retains channel, lifecycle, provider
  reference, timestamps, and allowlisted safe failure codes. Reservation UUIDs are sent
  as Resend idempotency keys.
- Closed credential-implies-activation paths: contact/platform inquiry delivery now
  requires the explicit contact flag, contact activation fails startup without both
  Turnstile keys, and urgent alerts require their own explicit flag. All production
  examples remain disabled.
- Contact delivery now performs one initial attempt plus at most three bounded
  exponential-backoff retries for retryable network/429/5xx failures. Optional
  confirmation delivery is separately admitted and remains disabled by default.
- Wired health-check critical incidents to the Resend alert adapter behind the explicit
  alert flag while preserving the deduplicated ORAP alert as authoritative. Delivery
  failure is recorded and cannot affect public static-site availability.
- Added a nonsecret ORAP Operations panel showing activation/configuration state,
  monthly cap and counts, channel state, latest attempt, and safe failure class without
  recipients, credentials, or message/submission content.
- The first disposable production-Compose run exposed that a direct runtime query could
  not execute the quota function. The implementation was corrected to preserve the
  NOINHERIT model by explicitly assuming only `omnireach_app` or `omnireach_worker`
  inside each transaction. A second run proved the function path and correctly failed
  the verifier's attempted private-table read; the verifier moved that assertion to the
  platform inspection role and retained an explicit application-login denial check.
- Final disposable production-Compose verification passed all 60 migrations, restricted
  quota admission/finalization, direct-table denial, API readiness, authentication,
  PostgreSQL/Redis persistence and isolation, static availability during control-plane
  restart, analytics query, backup status/alert lifecycle, all six worker kinds, and
  credential-leak checks. Disposable resources were removed.
- Full evidence passed: 69 unit files (373 passed, 1 skipped), 12 integration files (70
  passed), 16 security files (75 passed), 2 contract files (10 passed), and 5 Playwright
  tests. Typecheck, lint, build, docs, 60-migration, Compose, production-Compose,
  workflow, 28-workspace, five-site build/contract, changed-file formatting, secret scan
  of 595 files, and production dependency audit with zero vulnerabilities all passed.
- Real Resend delivery, sender/domain verification, recipient confirmation, provider
  credentials, current free-tier reconciliation, and activation remain
  `WAITING_FOR_OWNER`. No provider message or external mutation occurred.

## Resume point

Release the verified Priority 4 email/forms operations candidate through protected CI
without enabling provider flags, then continue the employee-facing accessibility and
recovery-safe UX review. Preserve the authenticated Analytics, exact Google-console,
real R2, and timed isolated-restore production-proof gaps.
