# OmniReach handoff context — October 14, 2026, updated through 09:00 UTC

**Purpose:** authoritative first-read snapshot for the next Codex session or developer

**Repository:** `OmniReach-Websites/SEO-Automation`

**Protected production branch:** `main`

**Latest protected-main commit:** `b06756bee636da166ed80122714c60600f231197`
(`Harden staff authentication UX (#67)`)

**Current repository branch:** `feature/ai-proposal-pipeline`, created from the
protected-main commit above; Priority 5 is implemented locally but is not yet merged or
deployed

**Latest verified production workflow:** GitHub Actions run `38538086374` completed
successfully for exact commit `b06756bee636da166ed80122714c60600f231197`.

This document supersedes
`docs/omnireach-handoff-context-2026-10-14-0810z.md` as the first context document to
read. Architecture, ADRs, the roadmap, production inputs, security documents, and
runbooks remain authoritative for their own details.

Never copy a password, API token, private key, OAuth secret, recovery code, customer
submission, database content, or other credential into this document, Git, logs, or
chat. Any credential previously placed in chat must be considered exposed and rotated;
no credential value is reproduced here.

## Evidence language

- **Live:** current direct production evidence exists.
- **Deployed:** the named protected-main commit completed the protected production
  workflow.
- **Implemented/tested:** repository code and automated evidence exist, but production
  activation or live proof may still be pending.
- **Owner-reported:** the owner completed an external action that has not been
  independently reconciled against provider data.
- **Waiting for owner:** a credential, legal/commercial decision, provider setup, or
  explicitly gated production action is required.
- **Waiting for production proof:** code may be deployed, but safe live evidence is
  still required.

Do not silently upgrade one evidence state to another.

## Permanent product and architecture constraints

OmniReach is an agency-first managed website and search-operations platform, not a
self-service website builder. OmniReach staff operate the OmniReach Administration
Platform (ORAP). Authorized customers use isolated, site-specific customer admin
surfaces.

Customer sites may be completely custom designs, but every site must comply with the
versioned OmniReach integration contract. GitHub is authoritative for source code,
templates, migrations, infrastructure definitions, and sanitized configuration.
PostgreSQL is authoritative for editable content, protected facts, authorization,
integrations, subscriptions, jobs, audit history, and operational state. Redis/BullMQ is
transport and must never become durable business truth.

Public sites are immutable static releases. They must remain available when the API,
PostgreSQL, Redis, workers, Google, OpenAI, Resend, or another provider is unavailable.
Activation is atomic; a failed build or health check must preserve or restore the last
healthy release.

Christians Reunite and shared Caddy are protected independent production services. Do
not alter or restart them incidentally. Any shared routing change requires explicit
scope, configuration backup, validation, health checks, and a rollback path.

## Security boundaries that must not regress

- Derive tenant/site scope from a verified hostname and authorized database records;
  never trust a request-provided tenant or site ID by itself.
- Enforce authorization in the API and PostgreSQL RLS with composite tenant/site keys
  and transaction-scoped context.
- Preserve Argon2id, secure host-only cookies, origin/CSRF checks, strict rate limits,
  session revocation, and durable audit events.
- Platform Owner, Platform Admin, and Staff accounts require two-step verification.
  Email codes are supported; TOTP and WebAuthn/passkeys remain optional stronger
  methods. A full ORAP session is never issued before required verification succeeds.
- Privileged email codes expire after five minutes, are single-use and hash-stored, and
  have strict attempt and resend limits.
- Customer Owner, Editor, and Viewer accounts use email/password by default and may
  voluntarily enable supported email-code, TOTP, or WebAuthn verification.
- Password recovery must not bypass required privileged verification.
- A Platform Owner may manage internal staff and promote another identity to Platform
  Owner. The last active owner cannot be disabled or demoted. Operations remain audited
  even though the UI no longer asks for a typed audit reason.
- Never expose password hashes, factor secrets, recovery-code material, session tokens,
  or raw audit internals as editable fields.
- AI may act only according to per-field `AUTO`, `SUGGEST`, or `PROTECTED` policy and
  can never modify protected prices, hours, addresses, contact details, legal facts, or
  other protected business information.
- Queue payloads carry bounded identifiers, not credentials or customer content.
- Previews remain authenticated, expiring, site-bound, isolated, and `noindex`.

## Current production baseline

The latest fully successful production workflow is run `38538086374` for exact
protected-main commit `b06756bee636da166ed80122714c60600f231197`.

PR #66 merged the Priority 4 email/forms operations slice as protected-main commit
`cd444d23955f3da25439cd6ca23e8014b07322f8`. Its production run `38535619433` built,
activated, and verified Coop, then failed only because the workflow incorrectly expected
the intentionally fail-closed platform inquiry endpoint to report enabled. The live
endpoint correctly reported `{"enabled":false}`. Do not enable Resend to satisfy that
obsolete assertion.

PR #67 merged as `b06756bee636da166ed80122714c60600f231197` after both protected
Branch CI runs passed. It fixes that production assertion and delivers the staff
authentication UX described below. Main Branch CI run `38538086305` and production run
`38538086374` both completed successfully for that exact commit. The production run
rebuilt and tested the commit, created immutable images and a release package, activated
the release through the restricted ephemeral SSH identity, verified Coop and OmniReach,
confirmed the fail-closed inquiry state, and removed the identity.

Independent post-deployment checks returned HTTP 200 for:

| Surface               | URL                                          |
| --------------------- | -------------------------------------------- |
| ORAP/API readiness    | `https://admin.omnireach.cloud/health/ready` |
| OmniReach public site | `https://omnireach.cloud/`                   |
| OmniReach Terms       | `https://omnireach.cloud/tos`                |
| OmniReach Privacy     | `https://omnireach.cloud/privacy`            |
| Coop pilot            | `https://coopsmobiledetailingaledo.com/`     |

The public inquiry configuration returned exactly `{"enabled":false}`. An
unauthenticated request to `/orap/operations` returned 403. Safe GET checks of `/login`,
`/auth/recovery`, and an MFA error state returned HTML with HTTP 200 and
`Cache-Control: no-store`. These checks prove the public and unauthenticated boundaries;
they do not replace an authenticated employee rendering test.

OmniReach uses GA4 ID `G-5H7ZB5HMLC`; Coop uses `G-B6S8N9JHL8`. Both tags are
consent-aware and site-specific. Never put one site's ID on the other site.

## Delivered milestone state

### Priority 5 — controlled AI proposal pipeline (repository candidate only)

The current feature branch adds tenant/RLS-scoped durable proposal material, atomic
idempotent job admission, worker-side content and policy revalidation, protected-field
and emergency-control enforcement, dated model prices, budget reservation linkage,
immutable proposal-result linkage, and a dedicated resource-limited `aio_proposal`
worker. The customer request endpoint fails closed with `503 ai_provider_disabled`
while the provider flag is off. Queue payloads retain identifiers rather than customer
copy or evidence.

A deterministic five-case synthetic benchmark covers safe copy, prompt-injection data,
protected facts, unsafe links, and unsupported claims. A disposable production stack
applied all 61 migrations and observed seven healthy worker kinds. This work is
**implemented/tested**, not deployed. `OPENAI_PROVIDER_ENABLED=false` remains required;
no paid provider call was made. A representative paid-provider benchmark, explicit
activation, and production smoke remain waiting for the owner.

### Priority 1 — ORAP Analytics and SEO Performance

PR #62 deployed as `3ded900d2320e892026be36f6a7785098989aae8`.

Delivered behavior includes authorized site selection; bounded 7/28/90/custom source
date ranges; equal-length prior-period comparisons; Search Console and GA4 KPI cards;
accessible charts and table equivalents; bounded query/page tables; deterministic
visibility opportunities; crawl/finding health; a correlation-labeled work timeline;
exact property mappings; persisted availability/freshness diagnostics; and honest
disconnected, empty, partial, stale, and unsupported states.

Remaining proof: render and exercise the page with a normal verified employee session.
Do not weaken MFA or invent a bypass to obtain this evidence.

### Priority 2 — Google ingestion hardening

PR #63 deployed as `9fea6a0d40a3fc9484895ef179888f07892b0ccb`.

Delivered behavior includes separate Search Console property totals/query/page grains;
bounded Search Console and GA4 pagination; stable ordering; correction-safe observation
upserts; versioned partial/truncated diagnostics; continuation when one provider
collection fails; safe provider error classes; and atomic clearing of snapshots when a
property mapping changes.

Approved scopes:

- `https://www.googleapis.com/auth/webmasters.readonly`
- `https://www.googleapis.com/auth/analytics.readonly`

Callback:
`https://admin.omnireach.cloud/v1/orap/integrations/google/callback`

The owner reported that both integrations are connected. Remaining proof is exact
reconciliation against the Search Console and GA4 consoles for property, source date,
property time zone, lag, filters, and metric semantics.

### Priority 3 — backup operational readiness

PR #64 deployed as `e7bdb32d877ed58f5989366b3a19924b412dc8cd`.

Repository/runtime support includes AES-256-GCM authenticated archives, PostgreSQL
custom dumps, bounded archive handling, safe restore validation, seven-daily/four-weekly
automatic retention, owner-authorized logged manual deletion, independent local and
off-site state, bounded R2 transport, safe backup alerts, and an authorized ORAP backup
panel.

Production R-005 remains incomplete. Do not claim the 24-hour RPO or 8-hour RTO until
separated production credentials and an encryption key are installed, the host schedule
is active, an R2-downloaded copy is verified, and a timed isolated restore succeeds.
No backup activation, upload, deletion, or restore was performed by the code release.

### Priority 4 — email/forms operations and staff authentication UX

PR #66 provides a PostgreSQL-authoritative UTC monthly email policy and reservation
lifecycle shared across alert, authentication, contact, and platform-inquiry delivery.
The planned no-spend cap is 3,000 messages. Runtime roles use narrowly granted
security-definer functions and cannot read the private quota tables directly.

Contact and platform-inquiry delivery require `CONTACT_DELIVERY_ENABLED`; urgent alert
email requires `ALERT_EMAIL_DELIVERY_ENABLED`. Contact activation also requires both
Turnstile keys. Confirmation mail is separately metered and disabled by default.
Adapters use reservation IDs as provider idempotency keys. Contact retries are limited
to one initial attempt plus three retryable exponential-backoff attempts. ORAP Operations
shows nonsecret activation, quota, count, channel, and safe error state.

Real Resend delivery remains off. Sender verification, credentials, recipient approval,
current free-tier reconciliation, and explicit activation are still required. Provider
failure must not reduce public website availability.

PR #67 centralizes the branded, no-index authentication layout and prevents browser
invitation, MFA, security-setting, and recovery failures from falling through to raw
JSON. It adds browser password confirmation to invitations/recovery, keeps sensitive
pages/results `no-store`, labels one-time recovery material, and preserves the separate
JSON API behavior. Windows Hello/security-key wording is explicit. Email-code, TOTP,
WebAuthn, recovery-code, host/session, same-origin, rate-limit, and recovery enforcement
remain intact.

Full candidate evidence for PR #67 passed:

- 69 unit files: 373 passed, 1 skipped;
- 12 integration files: 70 passed;
- 16 security files: 75 passed;
- 2 contract files: 10 passed;
- 5 Playwright end-to-end tests;
- typecheck, lint, build, documentation, migration, Compose, production-Compose,
  workflow, workspace, five-site build, and site-contract checks;
- all 60 migrations in the disposable production runtime;
- secret scan of 595 files with zero findings;
- production dependency audit with zero vulnerabilities.

The disposable runtime also proved restricted quota functions/direct-table denial,
authentication, PostgreSQL/Redis persistence and private isolation, static availability
during control-plane restart, analytics, backup status/alerts, all six worker kinds, and
no credential exposure in rendered/container metadata. Disposable resources were
removed.

Known email durability limits remain: synchronous contact/inquiry sends do not yet use a
durable send outbox, and provider success followed by local finalization failure can
leave uncertain state. Provider idempotency protects retries for one reservation but is
not a general exactly-once guarantee.

## Approved provider and commercial policy

### Resend/contact forms

- Sending domain: `updates.omnireach.cloud`.
- Senders: `alerts@updates.omnireach.cloud`, `auth@updates.omnireach.cloud`, and
  `forms@updates.omnireach.cloud` for their respective channels.
- Spend authorization: $0; do not create paid overage.
- Contact forms are optional, reusable centralized components. ORAP can enable them per
  site; authorized customers can configure supported fields and view only their site's
  submissions.
- Retention is 30 days except legal/security holds. Turnstile, honeypots, and rate
  limiting are required. Confirmation email is optional and off by default.
- Final consent wording still requires legal approval.

### OpenAI

- Use a dedicated OmniReach Production project.
- Default per-site cap: $5 USD per UTC calendar month.
- Initial platform-wide cap: $50 USD per month.
- Enforce both with the atomic internal ledger.
- Model selections remain configurable after cost/quality testing.
- Paid production calls stay disabled until explicit owner authorization.

### Subscription proposal

The architecture currently models four configurable per-site tiers, but the listed
prices remain a selected proposal pending final commercial approval:

| Tier    | Monthly price | Seats | Standard pages | SEO audits | AI review cycles |
| ------- | ------------: | ----: | -------------: | ---------- | ---------------: |
| STARTER |          $500 |     2 |              5 | Weekly     |          2/month |
| GROWTH  |        $1,000 |     5 |             10 | Daily      |          8/month |
| PRO     |        $1,500 |    10 |             20 | Daily      |         16/month |
| ELITE   |        $2,000 |    20 |             30 | Daily      |         30/month |

Plans include one primary website/location by default. ORAP owns configurable quotas
and site overrides. The grace period is 14 days, and public sites remain online while
editing/automation suspension follows policy. No plan can weaken protected-field or
infrastructure safeguards. Setup fees, bespoke work, exact quota/overage definitions,
and billing/collection policy still need commercial approval.

## Operational targets and readiness gaps

Initial R-013 objectives are 99.5% monthly availability; maintenance Sunday 02:00–04:00
America/Chicago; a 24-hour backup RPO; an 8-hour recovery RTO; critical alerting in ORAP
and email; 30-minute critical and 24-hour noncritical acknowledgment; seven daily and
four weekly encrypted backups; and monthly restoration tests. These are targets, not
current proof.

| Area               | Current state                                      | Required next evidence/input                                                                  |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Domain/ORAP        | Live                                               | Explicit approval for each future DNS mutation                                                |
| Deployment         | Live; exact release and independent smoke verified | Preserve protected `main`, immutable activation, health checks, rollback, and restricted SSH  |
| Google             | Deployed; owner-reported connected                 | Employee UI smoke and exact provider-console reconciliation                                   |
| Backups            | Repository support deployed; production incomplete | Install separated secrets, activate schedule, verify R2 copy, timed isolated restore          |
| Resend auth/alerts | Implemented/tested; inactive                       | Domain/sender, key, recipient, current limit, explicit activation                             |
| Contact forms      | Implemented/tested; inactive                       | Consent, recipients, Turnstile, provider, security/deployment completion, explicit activation |
| OpenAI             | Policy/ledger exist; paid calls disabled           | Durable proposal path, benchmark/model evidence, explicit activation                          |
| Legal/privacy      | Partial                                            | Owner-reviewed final privacy, cookie, terms, consent, and deletion policies                   |
| Subscriptions      | Technical controls; prices are proposal            | Final commercial approval, setup/bespoke pricing, quota and billing rules                     |

## Exact safe resume point

1. Continue Priority 5. Audit the existing AI/provider/budget/content-policy code and
   complete a durable, disabled-by-default proposal job/material/result path. Add a
   synthetic benchmark harness. Preserve protected-fact, per-field mode, per-site cap,
   and platform-cap gates. Do not enable paid production calls.
2. Continue Priority 6 dependency and routine-maintenance review. Review historical
   Dependabot PRs individually; never merge them blindly.
3. Preserve outstanding production-proof gaps: authenticated employee Analytics smoke,
   exact Google-console reconciliation, real R2 downloaded-copy validation, and timed
   isolated restore.

Do not enable Resend, contact forms, paid OpenAI calls, backups, DNS changes, or shared
infrastructure merely to make a check pass.

## Git/worktree warning

The developer's historical local `main` branch diverges from protected `origin/main`
and must not be reset or force-updated. At the time this document was created it was 25
commits ahead and 75 behind. New work must branch from a freshly fetched `origin/main`,
for example:

```powershell
git fetch origin
git switch -c feature/ai-proposal-pipeline origin/main
```

Use a new branch name if that name already exists. Do not delete, overwrite, or rewrite
the historical local commits.

## Authoritative references

- `docs/overnight-goal-progress.md` — active execution state and detailed evidence log
- `docs/architecture.md` and `docs/adr/` — architecture and approved decisions
- `docs/production-inputs.md` — owner approvals and unresolved production inputs
- `docs/roadmap.md` — dependency-ordered goals and decision gates
- `docs/security.md` and `docs/security-test-matrix.md` — controls and test evidence
- `docs/operations.md`, `docs/production-compose.md`, and `docs/offsite-backup.md` —
  production operations and recovery
- `docs/google-integration-runbook.md` — Google behavior and metric semantics
- `docs/integration-contract.md` — custom-site contract
- `docs/commercial-readiness.md` and `docs/legal-policy-readiness.md` — launch blockers
