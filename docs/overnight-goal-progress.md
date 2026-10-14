# Overnight goal progress

**Started:** 2026-10-13 (America/Chicago)

**Working branch:** `feature/overnight-goal-closure`
**Source goal:** `OMNIREACH_AUTONOMOUS_OVERNIGHT_GOAL.md`

This file is the durable resume point for the autonomous overnight goal. Evidence states
are strict: `DONE` means implemented and verified, `IN_PROGRESS` means active repository
work, `WAITING_FOR_OWNER` needs a human decision/credential, and
`WAITING_FOR_PRODUCTION_PROOF` needs safe live evidence.

## Current milestone

- `DONE` — All independently executable repository work in Priorities 1 through 6 is
  merged and deployed through protected workflows.
- `WAITING_FOR_OWNER` / `WAITING_FOR_PRODUCTION_PROOF` — the remaining unchecked items
  are deliberately gated production activation or live authenticated/provider evidence;
  they are listed under their owning priorities and were not bypassed.

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
- [x] Improve remaining employee-facing accessibility and recovery-safe affordances;
      merge, deploy, and independently smoke the exact protected-main release.
- [ ] `WAITING_FOR_OWNER` — activate or send real provider messages only with the
      recorded provider/sender/recipient authorization.

### P5 — AI proposal pipeline

- [x] Complete durable disabled-by-default proposal job/material/result path and tests.
- [x] Add synthetic benchmark harness and preserve protected-fact/budget gates.
- [x] Protected PR checks, protected-main merge, exact-commit production deployment,
      readiness/public/authorization smoke, and disabled-provider evidence.
- [ ] `WAITING_FOR_OWNER` — paid production activation remains disabled.

### P6 — Maintenance

- [x] Review the six historical Dependabot PRs individually; do not blindly merge.
- [x] Refresh the authoritative handoff and record exact dependency dispositions.
- [x] Merge and verify the bounded production-Compose worker-recovery check.
- [x] Refresh, re-review, merge, and deploy the safe pinned `setup-node` and `checkout`
      action upgrades one at a time; retain the coordinated holds on PRs #3 through #6.

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

### 2026-10-14 UTC — Priority 4 protected merge and release correction

- Committed the verified email/forms slice as `babd84d`, pushed only
  `feature/email-form-operations`, opened and attached
  [PR #66](https://github.com/OmniReach-Websites/SEO-Automation/pull/66), and observed both
  protected Branch CI runs pass. PR #66 was squash-merged as protected-main commit
  `cd444d23955f3da25439cd6ca23e8014b07322f8`.
- Production workflow
  [38535619433](https://github.com/OmniReach-Websites/SEO-Automation/actions/runs/38535619433)
  built and tested the exact commit, built immutable images, configured the restricted
  ephemeral SSH identity, activated the release, verified Coop, and removed the identity.
  Its final OmniReach check failed because the workflow still asserted
  `{"enabled":true}` for the platform-inquiry endpoint even though Priority 4 deliberately
  requires explicit activation and the live endpoint correctly returned
  `{"enabled":false}`. Real delivery remains off; the assertion is being corrected rather
  than enabling Resend.
- Created `feature/staff-ux-recovery` from `cd444d2`. The current slice centralizes the
  branded authentication shell, replaces raw browser JSON failures with safe accessible
  invitation/MFA/security/recovery feedback, adds browser password confirmation, adds
  `no-store` handling to sensitive pages, preserves mandatory verification and recovery
  restrictions, and tests the new behavior.
- Full repository evidence passed: 69 unit files (373 passed, 1 skipped), 12 integration
  files (70 passed), 16 security files (75 passed), 2 contract files (10 passed), and 5
  Playwright tests; typecheck, lint, build, documentation, 60-migration, Compose,
  production-Compose, workflow, 28-workspace, five-site build/contract, secret scan of
  595 files, and production audit with zero vulnerabilities. The disposable runtime
  again proved restricted quota/database/authentication behavior, persistence, private
  isolation, six healthy worker kinds, and no credential leakage, then removed its
  resources. Protected release remained pending at this point in the evidence log.

### 2026-10-14 UTC — Priority 4 corrective release completed

- Committed the staff authentication UX and corrected production assertion as `b8d3c1e`,
  pushed only `feature/staff-ux-recovery`, opened and attached
  [PR #67](https://github.com/OmniReach-Websites/SEO-Automation/pull/67), and observed both
  protected Branch CI runs pass. PR #67 was squash-merged as protected-main commit
  `b06756bee636da166ed80122714c60600f231197`.
- Main Branch CI run `38538086305` and production deployment run
  [38538086374](https://github.com/OmniReach-Websites/SEO-Automation/actions/runs/38538086374)
  passed for that exact commit. The deployment rebuilt and tested the source, created
  immutable images/package, activated through the restricted ephemeral SSH identity,
  verified Coop and OmniReach including the fail-closed inquiry endpoint, and removed
  the identity.
- Independent checks returned 200 for API readiness, OmniReach home, Terms, Coop,
  login, recovery, and the MFA error state. The inquiry configuration returned exactly
  `{"enabled":false}`; unauthenticated ORAP Operations returned 403; and login,
  recovery, and MFA returned HTML with `Cache-Control: no-store`.
- Real Resend/contact/alert delivery remains disabled. No provider message, DNS change,
  backup activation, or paid OpenAI call was made by this release.

### 2026-10-14 UTC — Priority 5 repository candidate

- Added RLS-protected tenant/site proposal-job material, atomic idempotent admission,
  worker-side content/policy rehydration, source-hash and protected-field revalidation,
  immutable proposal-result linkage, and a charge-within-reservation database guard.
- Added dated official price rows for the selected balanced and economy aliases. The
  configured alias must match its provider model and effective price record.
- Replaced the unconditional queue cancellation with a dedicated `aio_proposal` worker.
  The provider flag is still checked first; production remains disabled by default and
  no paid call was made.
- Added bounded same-origin customer request admission, a stable disabled response,
  safe provider error classification, deterministic evaluation, budget/cycle handling,
  and deduplicated safe AUTO-failure alerts.
- Added a five-case synthetic benchmark covering bounded copy, prompt injection as
  untrusted data, protected-fact removal, unsafe links, and unsupported claims. Reports
  contain hashes and violation codes, not fixture source text.
- Full evidence passes: 71 unit files (375 passed, 1 skipped), 12 integration files (71
  passed), 17 security files (78 passed), 2 contract files (10 passed), the 10-site load
  test, and 5 Playwright tests. Typecheck, lint, build, docs, migrations, Compose,
  workflow, workspace, five-site contract/build, full secret scan (604 files), and
  production dependency audit (zero vulnerabilities) also pass. The disposable stack
  applied all 61 migrations, ran seven healthy worker kinds, proved restricted roles,
  private isolation, persistence, and static-site independence, then was removed.
- Paid-provider benchmarking, explicit activation, and production smoke remain
  `WAITING_FOR_OWNER`; `OPENAI_PROVIDER_ENABLED=false` remains required.

### 2026-10-14 UTC — Priority 5 protected release

- Committed the verified proposal slice as `5db4782`, pushed only
  `feature/ai-proposal-pipeline`, opened and attached
  [PR #68](https://github.com/OmniReach-Websites/SEO-Automation/pull/68), and observed both
  protected Branch CI runs pass.
- PR #68 was squash-merged as protected-main commit
  `d73ab70f62b3eebf15df958e2161e755f64855c7`. Main CI run `38542647400` and production
  deployment run
  [38542647373](https://github.com/OmniReach-Websites/SEO-Automation/actions/runs/38542647373)
  passed for that exact commit. Deployment rebuilt and tested the commit, produced
  immutable artifacts, activated through the restricted ephemeral SSH identity,
  verified Coop and OmniReach, and removed the identity.
- Independent checks returned 200 for API readiness, OmniReach home, Terms, and Coop;
  unauthenticated ORAP Operations returned 403; and the public inquiry configuration
  returned exactly `{"enabled":false}`.
- `OPENAI_PROVIDER_ENABLED=false` remains required. No paid provider call was made, and
  proposal admission remains fail-closed with `503 ai_provider_disabled`.

### 2026-10-14 UTC — Priority 6 dependency and routine-maintenance review

- Created `feature/maintenance-review-20261014` from deployed protected main and reviewed
  all six historical Dependabot PRs individually against current main.
- PR #1 (`actions/setup-node` 7.1.0) contains only pinned action-SHA updates and passed
  both refreshed checks. PR #2 (`actions/checkout` 7.0.1) preserves exact-ref and
  `persist-credentials: false` controls; one check passed while the duplicate check
  exposed a routine verifier race after PostgreSQL/Redis restart.
- PR #3 cannot install because TypeScript 7 is outside the installed
  `typescript-eslint` peer range. PR #4 makes the disposable `publisher` worker
  unhealthy. PRs #5 and #6 pass independently but must not split the Prisma adapter,
  client, CLI, generator, and migration toolchain across major versions.
- Added `docs/dependency-maintenance-review-2026-10-14.md` with exact evidence and
  dispositions. Refreshed the first-read handoff without recording any secret value.
- Replaced the immediate seven-worker count with a bounded 45-second exact-set poll
  scoped to the disposable release SHA and current heartbeat window. Static Compose,
  formatting, ESLint, documentation, and diff checks pass locally. The local Docker
  daemon is unavailable, so protected Linux CI is required to prove the full disposable
  runtime repair before merge.

### 2026-10-14 UTC — Priority 6 protected releases complete

- PR #69 passed protected Branch CI runs `38581211410` and `38581243080`, including the
  repaired disposable production-Compose check, and merged as
  `ad04297bbd1909b80ab341d6c8df09b92759dd5f`. Main CI run `38581722196` and production
  deployment run `38581722099` passed that exact commit. Independent checks returned
  200 for readiness, OmniReach home, Terms, and Coop; unauthenticated ORAP Operations
  returned 403; and the public inquiry endpoint remained exactly `{"enabled":false}`.
- Dependabot PR #1 was refreshed onto the repair, re-reviewed as pinned action-SHA-only,
  and passed both checks `38582993746` and `38583006116`. It merged as
  `2848e4fb604b43a25ac79c1edc405c1ae44db729`; main CI `38583492763` and production
  deployment `38583492784` passed the exact commit.
- Dependabot PR #2 was then refreshed onto that deployed commit. It retained exact-ref,
  history-depth, and `persist-credentials: false` controls and passed both checks
  `38584662472` and `38584672613`. It merged as
  `2cf8302b039b3b1be481edb40d112b84db554bd4`; main CI `38585086048` and production
  deployment `38585086093` passed the exact commit.
- The final main CI emitted no deprecated Node 20 action annotation. Independent final
  checks returned 200 for readiness, OmniReach home, Terms, and Coop; unauthenticated
  ORAP Operations returned 403; and public inquiry remained disabled. PRs #3 through #6
  remain intentionally unmerged under their documented coordinated-upgrade holds.
- The named source goal file is not present in the worktree or any reachable Git object.
  This ledger is the durable requirement/evidence record available for completion
  auditing; missing source text was not invented.

## Resume point

No unblocked overnight repository implementation remains. Resume only with the relevant
owner authorization or live access needed for an explicitly waiting item: authenticated
employee Analytics smoke, exact Google-console reconciliation, production backup secret
installation/scheduling and timed restore proof, Resend/contact activation evidence, or
paid OpenAI benchmark/activation. Do not weaken authentication, enable a provider, or
invent production proof to close these gates. Keep PRs #3 through #6 unmerged until their
documented coordinated migrations are completed.
