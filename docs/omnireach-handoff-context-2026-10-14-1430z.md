# OmniReach handoff context — October 14, 2026, updated through 14:30 UTC

**Purpose:** authoritative first-read snapshot for the next Codex session or developer  
**Repository:** `OmniReach-Websites/SEO-Automation`  
**Protected production branch:** `main`  
**Latest protected-main commit:** `d73ab70f62b3eebf15df958e2161e755f64855c7`
(`Complete disabled AI proposal pipeline (#68)`)  
**Latest verified production workflow:** GitHub Actions run `38542647373`  
**Latest verified main CI:** GitHub Actions run `38542647400`  
**Current repository branch:** `feature/maintenance-review-20261014`, created from the
latest protected-main commit

This document supersedes
`docs/omnireach-handoff-context-2026-10-14-0900z.md` and
`docs/omnireach-current-context.md` as the first context document to read. Architecture,
ADRs, runbooks, production inputs, and the roadmap remain authoritative for their own
details.

Never put passwords, API keys, private keys, OAuth secrets, recovery codes, customer
submissions, database contents, or other credentials in this file, Git, logs, or chat.
Any credential previously shared through chat must be treated as exposed and rotated.

## Evidence language

- **Live:** current direct production evidence exists.
- **Deployed:** the named protected-main commit completed the protected production
  workflow.
- **Implemented/tested:** repository code and automated evidence exist, but activation
  or live proof may remain pending.
- **Owner-reported:** the owner completed an external step that has not been
  independently reconciled against the provider.
- **Waiting for owner:** a credential, legal/commercial decision, provider setup, or
  explicitly gated production action is required.
- **Waiting for production proof:** code may be deployed, but safe live evidence is
  still required.

Do not silently promote an evidence state.

## Permanent product and architecture constraints

OmniReach is an agency-first managed website and search-operations platform. It is not a
self-service SaaS website builder. OmniReach employees operate the OmniReach
Administration Platform (ORAP), while customers use isolated, site-specific customer
admin surfaces.

Completely custom customer website designs are allowed, but every implementation must
comply with the versioned OmniReach integration contract. GitHub is authoritative for
source code, templates, migrations, infrastructure definitions, and sanitized
configuration. PostgreSQL is authoritative for editable content, protected facts,
authorization, integrations, subscriptions, job state, audit history, and operational
state. Redis/BullMQ is transport, not durable business truth.

Public sites are immutable static releases and must remain available when the API,
PostgreSQL, Redis, workers, Google, OpenAI, Resend, or another provider is unavailable.
Activation is atomic, and a failed build or health check must preserve or restore the
last healthy release.

Christians Reunite and the shared Caddy service are protected independent production
workloads. Do not alter or restart them incidentally. Any shared routing change requires
explicit scope, a configuration backup, validation, service health checks, and a
rollback path.

## Security boundaries that must not regress

- Derive tenant and site scope from a verified hostname and authorized database records;
  never trust a request-provided tenant or site ID by itself.
- Enforce authorization in both the API and PostgreSQL RLS using composite tenant/site
  relationships and transaction-scoped context.
- Preserve Argon2id, secure host-only cookies, origin and CSRF checks, strict rate
  limits, session revocation, and durable audit events.
- Platform Owner, Platform Admin, and Staff accounts require two-step verification.
  Five-minute single-use hash-stored email codes are supported; TOTP and WebAuthn remain
  available as stronger options. Do not issue a full ORAP session before required
  verification succeeds.
- Customer Owner, Editor, and Viewer accounts use email/password by default and may
  voluntarily enable supported verification methods.
- Password reset and recovery must not bypass privileged-account verification.
- A Platform Owner may manage staff and promote another internal identity to Platform
  Owner. The last active owner cannot be disabled or demoted. Changes remain audited,
  although the UI no longer asks for a typed audit reason.
- Never expose hashes, factor secrets, recovery codes, session tokens, or raw audit
  internals as editable fields.
- AI may act only under a field's `AUTO`, `SUGGEST`, or `PROTECTED` policy and can never
  modify protected prices, hours, addresses, contact details, legal facts, or other
  protected business information.
- Queue payloads contain bounded identifiers, never credentials or customer content.
- Previews remain authenticated, expiring, site-bound, isolated, and `noindex`.

## Current verified production baseline

PR #68 was squash-merged as
`d73ab70f62b3eebf15df958e2161e755f64855c7`. Main CI run `38542647400` and production
deployment run `38542647373` both passed for that exact commit. The deployment rebuilt
and tested the source, built immutable artifacts, transferred and activated the release
through the restricted ephemeral SSH path, ran health checks, verified the Coop and
OmniReach sites, and removed the ephemeral identity.

Independent post-deployment checks returned:

| Surface                                      | Result                      |
| -------------------------------------------- | --------------------------- |
| `https://admin.omnireach.cloud/health/ready` | HTTP 200                    |
| `https://omnireach.cloud/`                   | HTTP 200                    |
| `https://omnireach.cloud/tos`                | HTTP 200                    |
| `https://coopsmobiledetailingaledo.com/`     | HTTP 200                    |
| Unauthenticated `/orap/operations`           | HTTP 403                    |
| `/v1/public/platform-inquiry/config`         | exactly `{"enabled":false}` |

These checks prove public availability and the unauthenticated boundary. They do not
replace an authenticated employee-session rendering and workflow test.

OmniReach uses consent-aware GA4 measurement ID `G-5H7ZB5HMLC`; Coop uses
`G-B6S8N9JHL8`. Never put one site's ID on the other site.

## Delivered milestone state

### Priority 1 — ORAP Analytics and SEO Performance

Deployed through PR #62 as `3ded900d2320e892026be36f6a7785098989aae8`.

The authorized dashboard includes bounded date ranges and comparisons, Search Console
and GA4 KPI cards, accessible charts and tables, query/page views, deterministic
opportunities, crawl/finding health, a correlation-labeled work timeline, exact property
mappings, freshness diagnostics, and honest disconnected, empty, partial, stale, and
unsupported states.

Remaining evidence: exercise the page with a normal verified employee session. Do not
weaken authentication or MFA to obtain this proof.

### Priority 2 — Google ingestion hardening

Deployed through PR #63 as `9fea6a0d40a3fc9484895ef179888f07892b0ccb`.

The collector separates property totals, queries, and pages; paginates Search Console
and GA4 within bounds; preserves stable ordering; handles corrections idempotently;
records partial/truncated diagnostics; continues one integration when the other fails;
and clears stale snapshots atomically when a property mapping changes.

Approved scopes:

- `https://www.googleapis.com/auth/webmasters.readonly`
- `https://www.googleapis.com/auth/analytics.readonly`

Callback: `https://admin.omnireach.cloud/v1/orap/integrations/google/callback`

The owner reported both connections complete. Exact reconciliation with the source
consoles for property, source date, time zone, lag, filters, and metric semantics remains
`WAITING_FOR_PRODUCTION_PROOF`.

### Priority 3 — backup operational readiness

Deployed through PR #64 as `e7bdb32d877ed58f5989366b3a19924b412dc8cd`.

Repository/runtime support includes AES-256-GCM authenticated archives, PostgreSQL
custom dumps, bounded archive and restore validation, separate key-version metadata,
seven-daily/four-weekly automatic retention, owner-authorized logged manual deletion,
independent local and R2 copy state, bounded R2 transport, safe alerts, and an authorized
ORAP backup panel.

R-005 remains incomplete for production. Do not claim the 24-hour RPO or eight-hour RTO
until separated production credentials and the encryption key are installed, the daily
schedule is active, an R2-downloaded copy is verified, and a timed isolated restore
succeeds. No backup activation, upload, deletion, or restore occurred as part of the
application release.

### Priority 4 — email/forms operations and staff authentication UX

Deployed through PRs #66 and #67, with the corrected verified baseline at
`b06756bee636da166ed80122714c60600f231197`.

The platform has a PostgreSQL-authoritative UTC monthly email policy and reservation
lifecycle shared by alert, authentication, contact, and platform-inquiry delivery. The
planned no-spend cap is 3,000 messages. Runtime roles use narrow security-definer
functions and cannot read private quota tables directly. Contact/inquiry delivery,
urgent alert email, Turnstile, and confirmation email all remain behind independent
explicit activation gates.

The authentication UI is branded, no-index/no-store where sensitive, and returns safe
browser feedback instead of raw JSON for invitation, MFA, recovery, and security-setting
errors. Email code, TOTP, WebAuthn, recovery code, hostname/session, same-origin, rate
limit, and recovery safeguards remain enforced.

Real Resend delivery remains off. Sender verification, credentials, recipient approval,
current provider-limit reconciliation, and explicit activation are still required.
Provider failure must not reduce public website availability.

### Priority 5 — controlled AI proposal pipeline

Deployed through PR #68 as `d73ab70f62b3eebf15df958e2161e755f64855c7`.

The release adds tenant/RLS-scoped durable proposal material, atomic idempotent
admission, worker-side content and policy revalidation, source-hash and protected-field
guards, emergency controls, budget and review-cycle enforcement, immutable result
linkage, and a dedicated resource-limited `aio_proposal` worker. Queue payloads contain
identifiers rather than customer copy or evidence.

A deterministic five-case synthetic benchmark covers safe copy, prompt injection as
untrusted data, protected facts, unsafe links, and unsupported claims. The repository
verification passed 71 unit files (375 passed, one skipped), 12 integration files (71
passed), 17 security files (78 passed), two contract files (10 passed), the ten-site load
test, five Playwright tests, and the full typecheck/lint/build/documentation/migration/
Compose/workflow/workspace/site/secret/audit gates. The disposable production stack
applied all 61 migrations and verified seven worker kinds before being removed.

Production remains fail-closed with `OPENAI_PROVIDER_ENABLED=false`; an admission
request returns `503 ai_provider_disabled`. No paid provider call was made. A
representative paid-provider benchmark and explicit production activation remain
`WAITING_FOR_OWNER`.

### Priority 6 — dependency and routine-maintenance review

The review is in progress on `feature/maintenance-review-20261014`. No dependency PR
has been merged blindly.

| PR  | Change                               | Current evidence and disposition                                                                                                                                                                |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1  | `actions/setup-node` 4.4.0 → 7.1.0   | Refreshed onto current main; both protected Branch CI checks passed and the diff contains only pinned action-SHA changes. Refresh again after the maintenance repair lands before merging.      |
| #2  | `actions/checkout` 4.4.0 → 7.0.1     | Refreshed onto current main; one duplicate check passed and one exposed an immediate post-restart heartbeat race. Hold until the bounded verifier repair lands, then refresh and rerun checks.  |
| #3  | TypeScript/Prisma/dev-tooling majors | Both checks fail during install because `typescript-eslint@8.71.1` requires TypeScript `<6.1.0`, while the PR selects TypeScript 7. Do not merge; this needs a coordinated toolchain migration. |
| #4  | BullMQ 5.61.2 → 6.3.12               | Both checks fail because the disposable production `publisher` worker becomes unhealthy. Do not merge until the queue/runtime compatibility change is understood and tested.                    |
| #5  | `@prisma/adapter-pg` 6.12.0 → 7.10.0 | Both checks pass, but do not merge this package independently from the Prisma CLI/client/schema-generation migration.                                                                           |
| #6  | `@prisma/client` 6.12.0 → 7.10.0     | Both checks pass, but do not merge independently; coordinate all Prisma packages and migration tooling.                                                                                         |

## Current provider and production-input state

| Area               | State                                         | Required next evidence/input                                                                  |
| ------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Domain/ORAP        | Live                                          | Explicit approval for each future DNS mutation                                                |
| Deployment         | Live                                          | Preserve protected `main`, immutable activation, health checks, rollback, and restricted SSH  |
| Google             | Deployed; owner-reported connected            | Authenticated employee smoke and exact source-console reconciliation                          |
| Backups            | Support deployed; production incomplete       | Install separated secrets, activate schedule, verify R2 copy, complete timed isolated restore |
| Resend auth/alerts | Implemented/tested; inactive                  | Verify sender domain, key, recipient, current limits, and explicit activation                 |
| Contact forms      | Implemented/tested; inactive                  | Final consent, recipients, Turnstile/provider setup, security proof, explicit activation      |
| OpenAI             | Proposal pipeline deployed; provider disabled | Representative benchmark, explicit paid-call authorization, production activation smoke       |
| Legal/privacy      | Partial                                       | Owner-reviewed final privacy, cookie, terms, consent, and deletion policies                   |
| Subscriptions      | Technical controls; prices remain a proposal  | Final commercial approval, setup/bespoke pricing, quotas, overages, billing rules             |

## Approved provider and commercial policy

- Resend domain: `updates.omnireach.cloud`.
- Senders: `auth@updates.omnireach.cloud`, `alerts@updates.omnireach.cloud`, and
  `forms@updates.omnireach.cloud` for their respective channels.
- Resend spend authorization: $0; do not create paid overage.
- Contact forms are optional centralized components with per-site ORAP control, scoped
  customer configuration and submission access, Turnstile, honeypots, rate limiting,
  and 30-day retention except legal/security holds. Confirmations are off by default.
- OpenAI default site cap: $5 USD per UTC calendar month.
- OpenAI initial platform cap: $50 USD per month.
- OpenAI provider calls remain disabled until explicit activation authorization.
- Subscription architecture has STARTER, GROWTH, PRO, and ELITE tiers at the selected
  proposal prices, but commercial approval, setup/bespoke fees, overages, and billing
  policy remain pending. No tier may weaken security or protected-field controls.

## Operational targets

Initial objectives are 99.5% monthly availability; Sunday 02:00–04:00
America/Chicago maintenance; 24-hour RPO; eight-hour RTO; critical alerting in ORAP and
email; 30-minute critical and 24-hour noncritical acknowledgment; seven daily and four
weekly encrypted backups; monthly restoration testing; and approximately ten customer
sites on the current two-core/eight-GiB VPS. These are targets, not proof of attainment.

## Exact safe resume point

1. Finish the current-main CI review for Dependabot PRs #1 and #2. Merge only if both
   protected checks pass and the pinned action changes preserve workflow security.
2. Write the durable Priority 6 dependency review and update the overnight progress
   ledger with exact evidence and dispositions.
3. Preserve the independent production-proof gaps: authenticated employee Analytics
   smoke, exact Google-console reconciliation, real R2 copy validation, and timed
   isolated restore.
4. Keep Resend/contact/alert delivery, backup scheduling, and paid OpenAI calls disabled
   unless the owner explicitly authorizes the specific production activation.

## Git/worktree warning

The historical local `main` is 25 commits ahead of and 76 commits behind protected
`origin/main`. Do not reset, delete, rewrite, or force-update it. New work must branch
from a freshly fetched `origin/main`. The current clean branch is
`feature/maintenance-review-20261014` at `d73ab70f62b3eebf15df958e2161e755f64855c7`.

## Detailed sources of truth

- Architecture: `docs/architecture.md`
- Decisions: `docs/adr/`
- Approved inputs and authorization: `docs/production-inputs.md`
- Operations and deployment: `docs/operations.md`, `docs/production-compose.md`
- Security: `docs/security.md`, `docs/security-test-matrix.md`
- Google: `docs/google-integration-runbook.md`
- Backup and restore: `docs/offsite-backup.md`
- Integration contract: `docs/integration-contract.md`
- Roadmap: `docs/roadmap.md`
- Active execution ledger: `docs/overnight-goal-progress.md`

When statuses conflict, current runtime evidence wins for **Live**, protected `main`
wins for repository implementation, ADRs define architecture, and
`docs/production-inputs.md` defines owner approvals. Resolve and document any mismatch
instead of silently selecting the most convenient statement.
