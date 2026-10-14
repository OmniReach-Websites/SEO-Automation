# OmniReach handoff context — October 13, 2026

**Purpose:** self-contained starting context for the next Codex session or developer

**Repository:** `OmniReach-Websites/SEO-Automation`

**Production branch:** protected `main`

**Active development branch:** `feature/orap-analytics-dashboard`
**Snapshot basis:** repository and GitHub Actions evidence observed through October 14,
2026 UTC

This historical snapshot is superseded by
`docs/omnireach-handoff-context-2026-10-14.md`. It remains available as a dated record
and supplements the architecture, ADRs, runbooks, and production-input register rather
than replacing them.

No credential, password, token, private key, customer submission, or database content
belongs in this file. A secret previously entered in chat must be treated as exposed and
rotated through the approved secret channel; never repeat it here.

## Status vocabulary

- **Live:** current direct production evidence exists.
- **Deployed:** the named commit completed the protected production workflow.
- **Implemented/tested:** code and automated evidence exist, but production activation
  or representative live proof may still be missing.
- **Owner-reported:** the owner completed an external action that has not yet been fully
  reconciled against provider evidence.
- **In progress:** work exists only on a development branch or as an uncommitted change.
- **Waiting:** a named external input, approval, credential installation, legal decision,
  or production proof is still required.

Do not describe a planned or repository-only feature as live.

## Executive state

OmniReach is an agency-operated platform for building, managing, optimizing, and
publishing customer websites. It is permanently agency-first and is not a self-service
website builder. Staff operate the OmniReach Administration Platform (ORAP); authorized
customers use site-specific Customer Admin surfaces. Public websites are served from
immutable static releases and remain available independently of the API, PostgreSQL,
Redis, workers, Google, OpenAI, or email providers.

The deployed production platform currently includes:

- ORAP/API at `admin.omnireach.cloud`;
- the OmniReach marketing and legal site at `omnireach.cloud`;
- the Coop pilot at `coopsmobiledetailingaledo.com`;
- PostgreSQL, Redis, scheduler, recovery runner, publisher, crawler, SEO, monitoring,
  and Google metrics worker services;
- a protected GitHub Actions release path using immutable artifacts, health checks,
  deployment locking, and rollback;
- the approved dark OmniReach brand system across the public OmniReach site and ORAP.

The newest protected production deployment observed for `main` is commit
`3fbbb1e9bbf993b4da1b5646e41934b793f1b65e`, GitHub Actions run `38516227676`, which
completed successfully. That commit is documentation-only. The latest known
application-changing production baseline remains
`ef35878b258845fd8e88ef6fcc340a72d84fef27`.

## Current production surfaces

The last recorded direct checks returned HTTP 200 for:

| Surface               | URL                                          |
| --------------------- | -------------------------------------------- |
| ORAP/API readiness    | `https://admin.omnireach.cloud/health/ready` |
| OmniReach public site | `https://omnireach.cloud/`                   |
| Terms                 | `https://omnireach.cloud/tos`                |
| Privacy               | `https://omnireach.cloud/privacy`            |
| Coop pilot            | `https://coopsmobiledetailingaledo.com/`     |

The OmniReach public site uses GA4 measurement ID `G-5H7ZB5HMLC`. The Coop site uses
`G-B6S8N9JHL8`. Each loader is consent-aware and site-specific. Never copy one site's
measurement ID to the other site.

The latest deployed ORAP shell no longer shows the redundant phrases “OmniReach
Administration Platform,” “Managed websites, automation, and customer operations,” or
“Secure workspace.”

## Source-of-truth boundaries

- GitHub is authoritative for application source, templates, migrations,
  infrastructure definitions, and sanitized configuration.
- PostgreSQL is authoritative for live editable content, protected facts, identities,
  permissions, integrations, jobs, audit events, subscriptions, and operational state.
- Redis/BullMQ transports schema-validated identifiers; it is not durable job truth.
- Customer sites may use completely custom designs, but each must implement the
  versioned OmniReach integration contract.
- Caddy terminates TLS and routes exact hostnames. The existing shared Caddy deployment
  and Christians Reunite are protected workloads and must not be disrupted.

## Non-negotiable security and availability rules

- Resolve tenant and site scope from exact verified hostnames and authorized database
  records, never from untrusted request input alone.
- Enforce access in both the API and PostgreSQL Row-Level Security, with composite
  tenant/site references and transaction-scoped context.
- Keep PostgreSQL and Redis on private Docker networking with no public host ports.
- Keep session cookies secure, host-only, and bound to the correct admin hostname.
- Preserve origin checks, CSRF defenses, Argon2id password hashing, rate limits, session
  revocation, and durable audit logs.
- Never let a password reset bypass the required privileged verification policy.
- Never let AI read protected business facts as replacement targets or modify them.
- Keep previews authenticated, expiring, site-bound, and `noindex`.
- Keep queue payloads bounded to identifiers; do not place secrets or customer content
  in queue messages.
- Preserve the previously active website when a build, health check, or activation fails.
- Keep public websites available through control-plane and provider outages.
- Never commit customer data, uploads, secrets, backups, private keys, or production
  environment values.
- Verify Christians Reunite and shared Caddy behavior before and after any relevant
  infrastructure change.

## Identity and access

Platform Owner, Platform Admin, and Staff accounts require two-step verification. The
routine supported second step is a five-minute, single-use, hash-stored email code with
strict attempt and resend limits. TOTP and WebAuthn/passkeys remain available as stronger
methods. Email-only verification is more susceptible to mailbox compromise and phishing,
so sensitive owner recovery and factor replacement still require the approved controlled
recovery procedure.

Customer Owner, Editor, and Viewer accounts use email and password by default and may
voluntarily enable supported verification methods. Their sessions remain isolated by
tenant and verified customer-admin hostname. ORAP administrators may manage customer
access and revoke sessions within their capability scope.

ORAP's Team & access area supports owner-managed invitations, profile updates, password
replacement, session revocation, disabling, and authority changes. Platform Owners can
promote another internal identity to Platform Owner. The final active owner cannot be
disabled or demoted. Sensitive hashes, factors, recovery codes, session tokens, and raw
audit history are not exposed as arbitrary editable fields. Changes are audited even
though the interface no longer asks for a typed audit reason.

## Content, publishing, and customer sites

Content uses stable field IDs, versioned structured JSON, optimistic concurrency, and
immutable revisions. Prices, hours, addresses, contact details, legal facts, owner
statements, and other contract-marked protected facts are stored and authorized
separately. AI can never change them. Authorized humans can change protected facts only
through audited controls.

Publication builds from an immutable content/fact/media snapshot, runs the allowlisted
site build, verifies routes and hashes, stages an immutable artifact, health-checks it,
and atomically activates it. Failure preserves or restores the last healthy artifact.

Customer Admin currently provides structured editing, draft save/reload, preview,
publish, revision history, restore, media, security/session views, and optional
contact-form controls. Customer Owners publish; Editors publish only when explicitly
authorized; Viewers are read-only.

## Google integrations and scheduled metrics

The Google OAuth integration requests only:

- `https://www.googleapis.com/auth/webmasters.readonly` for Search Console;
- `https://www.googleapis.com/auth/analytics.readonly` for GA4.

The exact production callback is
`https://admin.omnireach.cloud/v1/orap/integrations/google/callback`. OAuth state, PKCE,
nonce, encrypted token storage, exact-site property mapping, disconnect behavior, and
safe callback handling are implemented.

The owner reported completing the intended Search Console and GA4 connections. A
successful connection enables one site-scoped `metrics_sync` schedule, admits the first
run, and then runs daily at 04:00 UTC with up to 30 minutes of deterministic site jitter.
Execution is concurrency-one and rehydrates tenant/site scope under the worker role.

Current classification: **deployed and owner-reported connected, but production metrics
are not yet fully reconciled with the Google source consoles**.

The current provider collectors persist:

- Search Console: daily clicks, impressions, CTR, and position with date, query, page,
  country, and device dimensions;
- GA4: daily sessions, active users, and page views with date, session source, and
  session medium dimensions.

Engagement and conversion/key-event measurements are not presently collected. A new
dashboard must label them unsupported or unavailable instead of displaying fabricated
zeros.

## Active development work: ORAP Analytics & SEO Performance

The active branch is `feature/orap-analytics-dashboard`, created from current `main`.
The analytics slice is now **implemented and tested on the development branch but not
yet reviewed, merged, deployed, or production-smoked**. The working tree contains the
implementation, migration, tests, runbook updates, this context document, and the
durable execution log in `docs/overnight-goal-progress.md`.

The implemented slice provides a tenant-safe ORAP dashboard with:

- an Analytics navigation item and an authorized-site selector;
- bounded 7-, 28-, and 90-day ranges plus a practical bounded custom range;
- current-versus-previous-period comparisons;
- honest Search Console and GA4 KPI cards;
- accessible time-series visualization with an equivalent data table;
- bounded, sortable top-query and landing-page tables;
- deterministic search opportunities with explicit limitations;
- crawl/finding health and actionable drill-down;
- a work-performed timeline whose relationship to metrics is labeled as correlation,
  not causation;
- integration, freshness, partial-data, stale-data, and unsupported-data states;
- capability, RLS, direct-object-access, query-bound, timezone, empty-state,
  accessibility, and responsive-layout tests.

The dashboard must read persisted metrics. It must not make browser-triggered or
page-load-triggered Google API calls, invent ROI, promise ranking improvements, or build
a parallel analytics datastore.

### Implemented analytics architecture

- `apps/api/src/orap-analytics.ts` owns date-range rules, comparison calculations,
  dashboard contracts, data-state vocabulary, and deterministic opportunity derivation.
- `apps/api/src/postgres-orap.ts` performs bounded database-side aggregation inside the
  existing authorization-revalidating platform transaction. Every dashboard query is
  bound to the authorized tenant and site.
- `apps/api/src/orap-routes.ts` exposes site listing and site analytics endpoints, and
  `apps/api/src/orap-route-policy.ts` registers both under `analytics.view`.
- `apps/api/src/ui-routes.ts` renders `/orap/analytics`, rejects tampered site IDs, and
  returns safe validation or backend-failure states without exposing internal details.
- `packages/ui/src/analytics.ts` provides the responsive dark-mode dashboard, accessible
  inline charts with tabular equivalents, sortable tables, technical findings, work
  timeline, and explicit connection/freshness/unsupported states.
- `packages/ui/src/admin.ts` includes Analytics in the ORAP navigation when the active
  identity has `analytics.view`.
- The dashboard reads `metric_snapshots`, crawl/audit/finding records, jobs, job runs,
  and publication requests. It never calls Google during a page request.

Supported headline measurements are Search Console clicks, impressions, total CTR, and
impression-weighted average position plus GA4 organic sessions, active-user observations,
organic page views, and all-channel sessions for context. Separate accessible charts now
cover all supported Search Console time series and the primary organic traffic series.
Engagement and conversion measurements remain explicitly unsupported. Missing
observations render as unavailable data, not fabricated zeros. Standard date windows end
on the previous UTC day; custom windows are inclusive, bounded to 90 days, and may not
extend into the future. Stored date labels retain provider calendar semantics: Search
Console uses Pacific Time and GA4 uses the connected property's configured time zone.
Comparisons use an equal-length immediately preceding source-date period.

Top query and page rows include comparable-period click deltas. The technical panel
shows current severity counts, period resolutions, affected-page evidence when safely
available, and the latest crawl. The data-quality panel shows exact authorized property
IDs/mappings, persisted availability periods, last successful sync, source-calendar
notes, and safe collection failure diagnostics.

### Existing extension points

- `packages/auth/src/orap-capabilities.ts` already defines site-scoped
  `analytics.view`.
- `apps/api/src/postgres-orap.ts` is the existing ORAP transactional service and should
  remain the dashboard's server-side authorization/data boundary.
- `apps/api/src/orap-routes.ts` and `apps/api/src/orap-route-policy.ts` are the API and
  capability-registration points.
- `apps/api/src/ui-routes.ts` owns server-rendered ORAP pages.
- `packages/ui/src/admin.ts` owns the shared ORAP shell and navigation.
- `packages/integrations/src/google.ts` owns Google provider collection.
- `workers/runner/src/google-metrics.ts` owns scheduled metric ingestion.
- `metric_snapshots`, `crawl_runs`, `audit_runs`, `findings`, `jobs`, `job_runs`, and
  `publication_requests` are the existing persisted inputs.

### Resolved analytics correctness gap

The development branch replaces the value-dependent Google metric `source_hash` with a
stable observation identity derived from connection, source, metric, canonical
dimensions, and time window. Migration
`20261013170000_google_metric_observation_identity` deterministically deduplicates prior
observations, recalculates stable hashes, adds the source/window query index, and updates
RLS for platform analytics reads. Ingestion now updates a re-finalized observation's
value and metadata instead of creating a second count. This is repository-tested but is
not a production fact until the migration is deployed successfully through protected
`main`.

The same migration adds explicit platform-role read branches for crawl, audit, finding,
and publication evidence. Exact tenant/site RLS remains in force for application and
worker roles, while API capability checks and bound tenant/site predicates still protect
ORAP reads.

### Analytics calculation rules

- Aggregate Search Console CTR as total clicks divided by total impressions; do not sum
  or average row CTR values.
- Calculate average position with a documented impression-weighted method where the
  stored dimensions support it; otherwise show the limitation.
- Define organic GA traffic with an explicit, tested `sessionMedium` allowlist and expose
  the definition in the UI.
- Use database-side bounded aggregation rather than returning all raw observations for a
  90-day range.
- Parameterize filters and identifiers. Any dynamic sort expression must come from a
  small server-side allowlist.
- Compare periods using equal-length, non-overlapping source-date windows. Document that
  Search Console and GA4 may use different day boundaries rather than pretending the
  provider observations share one UTC reporting timezone.
- Distinguish `available`, `partial`, `stale`, `no_data`, `not_connected`, and
  `unsupported`; they are not interchangeable.

## Other implementation priorities after Analytics

1. Harden Google ingestion diagnostics, mapping, backoff, partial backfill, and
   first-sync evidence; compare stored results to the exact source properties.
2. Complete repository-side off-site backup automation and tests, then separately obtain
   authorization for production secret installation and scheduling.
3. Audit Resend/contact-form flags, quotas, retries, and diagnostics; preserve safe
   behavior while external sending is disabled.
4. Complete the disabled-by-default durable AI proposal job/material/result path and a
   synthetic benchmark harness without enabling paid production calls.
5. Review historical Dependabot pull requests individually; do not blindly merge major
   upgrades or workflow changes.

Progress and evidence for these priorities belongs in
`docs/overnight-goal-progress.md`.

## Current verification evidence

The following checks passed against the uncommitted development-branch implementation:

- TypeScript typecheck and ESLint;
- all 66 unit-test files: 350 passed and 1 skipped;
- all 12 integration-test files: 70 passed;
- all 15 security-test files: 69 passed;
- all 5 Playwright end-to-end tests;
- application build, documentation check, migration check (57 migrations), workflow
  check, and repository secret scan (580 files, zero findings);
- production dependency audit at high severity: zero findings;
- disposable production-compose verification, including migrations, restricted runtime
  role provisioning, PostgreSQL and Redis authentication, private-network isolation,
  API readiness, persistence after restart, static-site availability during control-plane
  restart, and six healthy worker kinds. The harness also seeded an isolated authorized
  site and successfully executed the analytics service against migrated PostgreSQL with
  the restricted runtime role. It removed its disposable containers, networks, and
  volumes afterward.

The migrated-database check initially found that the platform role lacked `SELECT` on
`publication_requests`. The branch migration now grants that least-privilege read, and
the complete harness passes. The service also runs its aggregate statements sequentially
on one `pg` client, avoiding the concurrent-query behavior that `pg` has deprecated for
removal in version 9.

The repository-wide Prettier check is not a useful clean signal in the current Windows
checkout because the baseline contains CRLF-normalized files, including many untouched
files. Changed files must still pass targeted formatting and protected Linux CI remains
authoritative. No production service, VPS configuration, DNS record, provider account,
or credential was changed by this branch verification.

Remaining Priority 1 steps are final diff review, targeted formatting confirmation,
commit, pull request, protected CI, merge/deployment, and safe production smoke evidence.
Do not claim live analytics or live migration status before those steps complete.

## Provider and owner-input status

| Area                     | Current state                                       | What is still required                                                                                                 |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Domains/ORAP host        | Live                                                | Preserve exact-host enforcement; authorize each future DNS mutation explicitly                                         |
| Owner/auth custody       | Complete for the current owner-operated model       | Revisit custody and recovery before broader employee operations                                                        |
| Infrastructure inventory | Historical inventory complete                       | Refresh read-only evidence before material shared-host changes                                                         |
| Cloudflare               | Approved zone-scoped access                         | Explicitly review each DNS change                                                                                      |
| Off-site backups         | Partial                                             | Install separated production secrets, enable automation, prove retention and alerts, and pass a timed isolated restore |
| Legal/privacy            | Partial                                             | Owner-approved final privacy, cookie, terms, consent, and deletion policies                                            |
| Google                   | Deployed/owner-reported connected                   | Reconcile the first successful stored sync with the exact source-console totals                                        |
| Resend auth/alerts       | Planned or awaiting re-verification                 | Verify domain/senders, recipient, credential installation, flags, quota, and live delivery                             |
| Contact forms            | Implemented foundation; production proof incomplete | Verify recipient, Turnstile/provider activation, retention, and final consent wording                                  |
| Deployment               | Live                                                | Preserve restricted, non-root, protected-main workflow                                                                 |
| Subscriptions            | Controls implemented; commercial terms incomplete   | Final prices, setup/bespoke fees, quota definitions, overages, collection, and cancellation approval                   |
| OpenAI                   | Policy/ledger implemented; provider disabled        | Finish benchmark and material path, then obtain explicit paid-call authorization                                       |
| Service objectives       | Approved                                            | Continue evidence gathering and restoration drills                                                                     |

The approved operating targets are 99.5% monthly availability; Sunday 02:00–04:00
America/Chicago maintenance; 24-hour RPO; 8-hour RTO; 30-minute critical and 24-hour
noncritical incident acknowledgment; and roughly ten initial customer sites on the
existing 2-core/8 GiB VPS.

## Backup state

The private Standard-class R2 bucket `omnireach-production-backups` and a bucket-limited
credential passed an upload, download, integrity, list, and cleanup transport probe.
Public `r2.dev` access is disabled. No custom domain or CORS rule is configured.

Production backup readiness is still incomplete. The credential is not yet evidenced as
installed on the VPS, off-site mode remains disabled, and the separate encryption key,
daily automation, 7-daily/4-weekly retention, failure alerting, budget evidence, and
timed isolated restore remain unproven. The owner must authorize manual deletion, which
must be audited.

## Email and contact forms

Planned senders are:

- `auth@updates.omnireach.cloud` for authentication;
- `alerts@updates.omnireach.cloud` for urgent operational alerts;
- `forms@updates.omnireach.cloud` for centralized contact forms.

Contact forms are optional reusable components backed by one centralized system, not a
different backend for every website. ORAP can enable them per site; authorized customers
can configure supported fields and view only their own submissions. The design includes
Turnstile, a honeypot, rate limiting, 30-day retention except approved holds, and optional
confirmation messages disabled by default. Do not claim production email delivery until
sender, credential, flag, recipient, quota, and live delivery evidence are current.

## OpenAI policy

The default site ceiling is $5 USD per UTC calendar month and the initial platform-wide
ceiling is $50. The atomic internal ledger must reject a call unless both budgets have
capacity. ORAP may configure model aliases, limits, and site policies.

`content-review-balanced` currently maps to benchmark candidate `gpt-6.1-sol`, and
`content-review-economy` maps to `gpt-6-luna`. These are configurable candidates, not a
permanent model promise. `OPENAI_PROVIDER_ENABLED=false` remains mandatory until the
benchmark, dated pricing, complete job-material path, production smoke evidence, and
explicit paid-call authorization are complete.

Eligible fields use `AUTO`, `SUGGEST`, or `PROTECTED`. No role, plan, feature override,
prompt, or model may bypass protected-fact restrictions.

## Deployment workflow

- Only a verified push to protected `main` deploys production.
- Pull requests and non-main branches run CI without deploying.
- GitHub Actions uses protected secrets and an ephemeral restricted SSH identity.
- The target account is `omnireach-deploy`; it must not have unrestricted sudo or Docker
  daemon access.
- Production releases are immutable, locked, health-checked, and rollback-capable.
- Do not use an interactive root credential as the normal deployment path.
- Do not disable root/password SSH until non-root access and emergency recovery have
  been separately tested.

Relevant files:

- `.github/workflows/deploy-production.yml`
- `.github/workflows/deploy-artifact.yml`
- `infrastructure/compose/production.compose.yml`
- `infrastructure/deploy/`
- `docs/production-compose.md`
- `docs/operations.md`

## Safe resume procedure

1. Read this file, `docs/overnight-goal-progress.md`, and the Google/security runbooks.
2. Run `git status`, fetch `origin/main`, and confirm that
   `feature/orap-analytics-dashboard` has not diverged unexpectedly.
3. Preserve the entire current working tree; its analytics implementation and progress
   document are intentional, not disposable scratch changes.
4. Run targeted formatting on changed files, inspect the complete diff and migration,
   and rerun any check affected by review fixes.
5. Commit the coherent slice, push the feature branch, open a pull request, and require
   protected CI. Do not bypass protected `main` or deploy manually as root.
6. After merge and the protected deployment workflow, verify public readiness and the
   authenticated Analytics page without weakening MFA or hostname/session controls.
7. Record deployment and production smoke evidence separately from repository proof.
8. Keep Google values classified as unreconciled until persisted results are compared
   with the exact Search Console and GA4 source properties.
9. Continue with Priority 2 ingestion diagnostics, mapping, backoff, and partial-backfill
   behavior after the complete Priority 1 release gate succeeds.

Common verification commands include:

```text
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:security
npm run test:e2e
npm run check:docs
npm run check:migrations
npm run check:production-compose
npm run check:workflows
npm run scan:secrets
```

## Authoritative detailed references

- Architecture: `docs/architecture.md`
- Decisions: `docs/adr/`
- Owner approvals and unresolved production inputs: `docs/production-inputs.md`
- Roadmap: `docs/roadmap.md`
- Active execution log: `docs/overnight-goal-progress.md`
- Security: `docs/security.md`, `docs/security-test-matrix.md`
- Operations: `docs/operations.md`, `docs/production-compose.md`
- Google: `docs/google-integration-runbook.md`
- Backup/restore: `docs/offsite-backup.md`
- Site contract: `docs/integration-contract.md`
- Prior context snapshot: `docs/omnireach-current-context.md`
- Historical planning snapshot: `docs/omnireach-planning-context.md`

When sources disagree, current direct runtime evidence governs **Live**, protected
`main` governs deployed repository state, ADRs govern architecture, and
`docs/production-inputs.md` governs owner approvals. Record and resolve any discrepancy;
do not silently choose the most convenient status.
