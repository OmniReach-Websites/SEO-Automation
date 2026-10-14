# OmniReach handoff context — October 14, 2026, updated through 08:45 UTC

**Purpose:** authoritative first-read snapshot for the next Codex session or developer

**Repository:** `OmniReach-Websites/SEO-Automation`

**Protected production branch:** `main`

**Current local branch:** `feature/staff-ux-recovery`

**Latest protected-main commit:** `cd444d23955f3da25439cd6ca23e8014b07322f8`

**Latest verified production workflow:** GitHub Actions run `38531510238`, completed
successfully for `c514e3c92066acca8389ac873ca5ef5aa094d9d2`

**Latest attempted production workflow:** run `38535619433` activated `cd444d2`, verified
Coop, then failed its OmniReach check because the workflow still expected the inquiry
endpoint to report enabled. The deployed fail-closed endpoint correctly reports
`{"enabled":false}`. Treat this as an incomplete release until a protected corrective
workflow passes; do not enable Resend merely to satisfy the stale assertion.

This snapshot supersedes the October 13 and earlier October 14 context documents as the
first handoff document to read. It does not replace the architecture, ADRs, production
inputs, roadmap, security documentation, or operating runbooks. Those remain
authoritative for their respective details.

Never add a password, API token, private key, recovery code, OAuth secret, customer
submission, database content, or other credential value to this document, Git, logs, or
chat. Credentials previously disclosed in conversation must be treated as compromised
and rotated; they are intentionally not reproduced here.

## Evidence language

- **Live:** current direct production evidence exists.
- **Deployed:** the named protected-main commit completed the production workflow.
- **Implemented/tested:** repository code and automated evidence exist, but production
  activation or live proof may still be pending.
- **Owner-reported:** the owner completed an external action that has not been
  independently reconciled with the provider's source data.
- **In progress:** the work exists only in the current dirty working tree and must not be
  described as merged, deployed, or live.
- **Waiting for owner:** a credential, legal/commercial decision, provider setup, or
  explicitly gated production action still needs the owner.
- **Waiting for production proof:** code/configuration may exist, but safe live evidence
  is still required.

## Product identity and permanent constraints

OmniReach is permanently an agency-first managed website and search-operations platform.
It is not a self-service SaaS website builder. OmniReach employees operate the OmniReach
Administration Platform (ORAP). Authorized customers use site-specific customer admin
surfaces.

Customer websites may use completely custom designs, but every site must implement the
versioned OmniReach integration contract. GitHub is authoritative for application
source, templates, migrations, infrastructure definitions, and sanitized configuration.
PostgreSQL is authoritative for live editable content, protected facts, identities,
authorization, integrations, jobs, subscriptions, audit history, and operational state.
Redis/BullMQ is transport and must not become durable business truth.

Public websites are immutable static releases and must remain available when the API,
PostgreSQL, Redis, workers, OpenAI, Google, Resend, or other providers are unavailable.
Publication activation is atomic. A failed build or health check must preserve or restore
the previously active release.

Christians Reunite and the shared Caddy service are protected independent production
workloads. Do not modify, restart, remove, or disrupt them as an incidental part of
OmniReach work. Shared routing changes require validation, a backup, a narrowly scoped
change, health checks, and a rollback path.

## Current production baseline

Protected main now contains Priority 4 commit
`cd444d23955f3da25439cd6ca23e8014b07322f8`, delivered by PR #66 after both protected
Branch CI runs passed. Production workflow `38535619433` completed activation and Coop
verification but failed a stale post-deploy assertion that expected the newly
fail-closed inquiry endpoint to be enabled. The last fully successful production
workflow remains `38531510238` for `c514e3c`; the Priority 4 release must not be called
fully verified until a corrective protected workflow passes.

Last independently recorded public checks returned HTTP 200 for:

| Surface               | URL                                          |
| --------------------- | -------------------------------------------- |
| ORAP/API readiness    | `https://admin.omnireach.cloud/health/ready` |
| OmniReach public site | `https://omnireach.cloud/`                   |
| OmniReach Terms       | `https://omnireach.cloud/tos`                |
| OmniReach Privacy     | `https://omnireach.cloud/privacy`            |
| Coop pilot            | `https://coopsmobiledetailingaledo.com/`     |

An unauthenticated request to `/orap/operations` returned 403 after the Priority 3
deployment. That proves the route is not public; it does not replace an authenticated
employee rendering test.

The OmniReach site uses GA4 measurement ID `G-5H7ZB5HMLC`. The Coop pilot uses
`G-B6S8N9JHL8`. The tags are consent-aware and site-specific. Never copy one site's
measurement ID into the other site.

## Runtime architecture

1. Caddy terminates TLS and routes exact public and admin hostnames.
2. Static site containers serve immutable Astro output independently from the control
   plane.
3. Fastify serves authentication, ORAP, Customer Admin, integration, contact, preview,
   and API routes.
4. PostgreSQL owns durable state. Composite keys, transaction-scoped tenant context,
   Row-Level Security, and API authorization enforce tenant isolation.
5. Redis/BullMQ carries schema-validated, bounded identifiers. Workers rehydrate
   tenant/site scope from PostgreSQL.
6. Resource-limited workers lease jobs, heartbeat, retry within policy, and persist
   terminal results.
7. Publishing creates a versioned content/fact/media snapshot, builds and verifies an
   immutable artifact, and atomically switches the active release pointer.
8. PostgreSQL and Redis remain on private Docker networks without public host ports.

The initial production capacity target is approximately ten customer websites on the
existing 2-core, 8 GiB VPS. Expansion is allowed only with owner approval.

## Security boundaries

- Resolve tenant and site scope from verified hostnames and authorized database records;
  never trust a request-supplied tenant/site identifier by itself.
- Enforce authorization in both the API and PostgreSQL RLS. Keep composite tenant/site
  references and transaction-scoped context.
- Preserve Argon2id password hashing, secure host-only cookies, origin checks, CSRF
  protection, rate limits, session revocation, and durable audit events.
- Platform Owner, Platform Admin, and Staff accounts require two-step verification.
  Email code is supported; TOTP and WebAuthn/passkeys remain available as stronger
  methods.
- Privileged email codes expire after five minutes, are single-use and hash-stored, and
  have strict attempt/resend limits. Never issue the full ORAP session before required
  verification succeeds.
- Customer Owner, Editor, and Viewer accounts use email/password by default and may
  voluntarily enable supported email-code, TOTP, or WebAuthn verification.
- ORAP administrators can manage customer access and revoke customer sessions, but
  customer identities and sessions remain tenant- and verified-host-bound.
- AI may change only eligible fields according to each field's `AUTO`, `SUGGEST`, or
  `PROTECTED` policy. AI can never change protected prices, hours, addresses, contact
  details, legal facts, or other protected business information.
- Queue payloads contain bounded identifiers, not credentials or customer content.
- Previews are authenticated, expiring, site-bound, and `noindex`.

Owner-approved staff UX allows a Platform Owner to promote another internal identity to
Platform Owner, update permitted account details, replace a password through the
controlled owner workflow, disable access, and revoke sessions. The UI does not require
a typed audit-reason field. The operation itself remains durably audited. The final
active owner cannot be disabled or demoted, and password hashes, factor secrets,
recovery codes, session tokens, and raw audit data are never exposed as editable fields.

## Deployed milestone state

### Priority 1 — ORAP Analytics and SEO Performance

PR #62 deployed as `3ded900d2320e892026be36f6a7785098989aae8`.

Implemented and deployed:

- authorized site selection and bounded 7/28/90/custom source-date ranges;
- equal-length previous-period comparison;
- Search Console and GA4 KPI cards with explicit definitions;
- accessible charts and complete tabular equivalents;
- bounded query/page tables and deterministic visibility opportunities;
- crawl/finding health and a correlation-labeled work timeline;
- exact property mapping, persisted availability periods, freshness, and safe failure
  diagnostics;
- honest disconnected, empty, partial, stale, and unsupported states.

Remaining production proof: render and exercise the dashboard with a normal verified
employee session. Do not weaken MFA or invent a bypass to obtain this evidence.

### Priority 2 — Google ingestion hardening

PR #63 deployed as `9fea6a0d40a3fc9484895ef179888f07892b0ccb`.

Implemented and deployed:

- separate Search Console property totals, query detail, and page detail;
- bounded Search Console and GA4 pagination with stable ordering;
- correction-safe observation identity and upsert behavior;
- versioned collection diagnostics and explicit partial/truncated states;
- cross-property continuation when one provider collection fails;
- safe provider error classes without provider response bodies;
- atomic clearing of old observations when a property mapping changes.

The configured scopes are:

- `https://www.googleapis.com/auth/webmasters.readonly`;
- `https://www.googleapis.com/auth/analytics.readonly`.

The callback is
`https://admin.omnireach.cloud/v1/orap/integrations/google/callback`.

The owner reported both intended Google connections completed. Production correctness is
not yet proven: compare stored results with the exact Search Console and GA4 consoles,
including property, date window, property time zone, lag, filters, and metric semantics.

### Priority 3 — backup operational readiness

PR #64 deployed as `e7bdb32d877ed58f5989366b3a19924b412dc8cd`.

Repository/runtime capability includes authenticated AES-256-GCM archives, PostgreSQL
custom dumps, bounded archive/resource handling, safe restore validation, fixed automatic
retention of seven daily and four weekly points, owner-authorized audited manual deletion,
separate local/off-site copy state, R2 request/list/download limits, safe backup alerts,
and an authorization-gated ORAP backup panel.

The private Standard-class R2 bucket `omnireach-production-backups` and a bucket-scoped
credential were previously transport-probed. Production R-005 remains incomplete:

- production backup/storage credentials and a separately held encryption key are not
  recorded as installed on the VPS;
- the host-only daily schedule is not recorded as active;
- a separately downloaded R2 copy has not been verified;
- a timed isolated restore has not yet proven the 24-hour RPO and 8-hour RTO;
- monthly restoration evidence remains pending.

No production backup activation, upload, deletion, or restore was performed by the
Priority 3 release.

## Priority 4 email/forms operations

The email/forms operations slice was committed as `babd84d`, passed two protected Branch
CI runs, and was squash-merged through PR #66 as `cd444d2`. The production workflow
activated that exact commit but did not complete successfully for the stale endpoint
expectation described above.

### Implemented and merged

- New migration `20261014110000_email_delivery_operations` introduces a global Resend
  email-delivery policy, UTC monthly periods, and reservation lifecycle.
- The planned monthly no-spend/free-plan cap is 3,000 messages. Admission is atomic and
  shared across `alert`, `authentication`, `contact`, and `platform_inquiry` channels.
- Reservation records contain channel, lifecycle, provider reference, and a bounded safe
  error code. They do not contain recipients, subjects, message bodies, credentials, or
  customer submissions.
- Application and worker roles use narrowly granted security-definer functions to
  reserve and finalize delivery. They do not receive direct table access.
- Resend adapters meter delivery through the shared quota and use the reservation ID as
  the provider `Idempotency-Key`.
- Contact delivery is fail-closed behind `CONTACT_DELIVERY_ENABLED`. Merely installing a
  Resend key no longer activates public forms or platform inquiries.
- Enabling contact delivery also requires both Cloudflare Turnstile keys. Disabled forms
  reject before database or provider work.
- Contact delivery allows four total attempts: the initial attempt plus up to three
  retries with exponential backoff. Confirmation email remains separately metered and
  disabled by default.
- Authentication, verification-code, invitation/recovery, contact, platform-inquiry,
  and urgent-alert adapters use the same quota when enabled.
- Urgent alert email is explicitly gated by `ALERT_EMAIL_DELIVERY_ENABLED`; provider
  failure is recorded and must not reduce public website availability.
- ORAP Operations receives a nonsecret email-delivery status panel with provider,
  enabled/configured state, monthly limit, sent/reserved/failed counts, safe latest error,
  and channel state. It never displays recipients, keys, message contents, or submissions.

### Principal files

New files:

- `packages/database/prisma/migrations/20261014110000_email_delivery_operations/migration.sql`
- `packages/database/src/email-delivery-quota.ts`
- `packages/integrations/src/email-quota.ts`
- `tests/security/email-delivery-fail-closed.test.ts`
- `tests/unit/email-delivery-quota.test.ts`

Modified areas include API wiring and ORAP operations rendering, contact fail-closed
behavior, Prisma/database exports, all Resend adapters, shared configuration validation,
worker alert delivery, focused unit/security tests, and the disposable production
Compose verifier.

### Verification completed for the merged candidate

The complete repository candidate passes:

- 69 unit files: 373 passed, 1 skipped;
- 12 integration files: 70 passed;
- 16 security files: 75 passed;
- 2 contract files: 10 passed;
- 5 Playwright end-to-end tests;
- TypeScript typecheck, ESLint, build, documentation, migration, Compose,
  production-Compose, workflow, workspace, site-build, and site-contract checks;
- 60 migrations and Prisma generation/validation in the disposable runtime;
- changed-file formatting and whitespace checks;
- secret scan of 595 files with zero findings;
- production dependency audit with zero vulnerabilities.

The disposable production-Compose verifier applied all migrations and proved restricted
atomic quota admission/finalization, direct application-login table denial, platform
status inspection, API readiness, authentication, PostgreSQL/Redis isolation and
persistence, static availability through a control-plane restart, analytics, backup
status/alerts, all six worker kinds, and no credential exposure in rendered/container
metadata. Its disposable resources were removed.

### Known residual design concerns

- A provider success followed by database finalization failure could be retried by a
  higher-level caller with a new reservation. Provider idempotency protects retries
  within one reservation, but a durable outbox/deduplication key is still preferable for
  crash-safe exactly-once intent.
- Contact and platform-inquiry sends are synchronous. They do not yet have a durable
  send outbox across process failure.
- Platform inquiries share the contact activation flag but are not the same retained,
  customer-visible submission workflow as site contact forms.
- The 3,000-message limit is currently a singleton database policy visible in ORAP, not
  an owner-editable ORAP control.
- Alert email is wired for the monitoring/health-check path. Confirm that every critical
  incident source reaches the centralized alert center before calling urgent email
  coverage complete.

All real Resend delivery remains off. Do not verify this work by sending a production
message until sender-domain verification, credentials, recipient approval, free-tier
limits, and explicit activation are confirmed.

### Current staff UX and release-correction work

The new `feature/staff-ux-recovery` branch starts at protected-main `cd444d2`. Its current
working tree:

- corrects the production smoke assertion to require the explicitly disabled,
  fail-closed platform-inquiry endpoint instead of expecting real delivery;
- centralizes the branded, no-index authentication shell for invitation, MFA, security,
  and recovery results;
- converts browser MFA resend/failure, recovery request/completion, invitation failure,
  restricted recovery, and supported security-setting errors from raw JSON into bounded,
  accessible HTML feedback while preserving JSON API behavior;
- adds password confirmation to browser invitation and recovery forms;
- preserves email-code, TOTP, WebAuthn, recovery-code, host/session, rate-limit, and
  same-origin enforcement; password recovery still cannot bypass required verification;
- marks challenge, invitation, security, and recovery pages `no-store` and keeps secrets
  out of query notices and rendered errors;
- adds integration and Playwright coverage for the browser flows and recovery safeguards.

This branch is not yet merged or deployed. Full evidence passes: 373 unit tests (1
skipped), 70 integration tests, 75 security tests, 10 contract tests, 5 Playwright tests,
typecheck, lint, build, documentation, migration/Compose/workflow/workspace/site checks,
the complete disposable production runtime, a 595-file zero-finding secret scan, and a
zero-vulnerability production dependency audit. Protected release remains to be
completed.

## Approved provider and operating policy

### Resend and contact forms

- Provider: Resend.
- Sending domain: `updates.omnireach.cloud`.
- Alert sender: `alerts@updates.omnireach.cloud`.
- Authentication sender: `auth@updates.omnireach.cloud`.
- Contact sender: `forms@updates.omnireach.cloud`.
- Spend authorization: $0; do not silently incur paid overage.
- Contact forms are optional reusable centralized components, not separate customer
  backends.
- ORAP administrators can enable/disable forms per site. Authorized customers can
  customize supported fields and view only their own submissions.
- Contact submissions retain for 30 days except legal/security holds.
- Spam defenses are Cloudflare Turnstile, honeypots, and rate limiting.
- Confirmation email is optional and disabled by default.
- Final consent wording still requires legal approval.

### OpenAI

- Use a dedicated OmniReach Production OpenAI project.
- The owner retains API-key and spending authority.
- Default per-site cap: $5 USD per UTC calendar month.
- Initial platform-wide cap: $50 USD per UTC calendar month.
- Both caps use the atomic internal spending ledger.
- Per-field `AUTO`, `SUGGEST`, and `PROTECTED` permissions remain mandatory.
- Paid production calls stay disabled until model cost/quality testing and explicit
  owner activation.

### Subscription proposal

The selected architecture proposal is not final commercial approval:

| Tier    | Monthly price | Seats | Standard pages | SEO audits | AI review cycles |
| ------- | ------------: | ----: | -------------: | ---------- | ---------------: |
| STARTER |          $500 |     2 |              5 | Weekly     |          2/month |
| GROWTH  |        $1,000 |     5 |             10 | Daily      |          8/month |
| PRO     |        $1,500 |    10 |             20 | Daily      |         16/month |
| ELITE   |        $2,000 |    20 |             30 | Daily      |         30/month |

Subscriptions are per website and include one primary website/location by default.
ORAP owns configurable quotas and site-specific overrides. The nonpayment grace period
is 14 days; public sites remain online while editing/automation suspension follows the
approved policy. No plan may override protected-fact restrictions or infrastructure
safeguards. Setup fees, bespoke pricing, quota definitions, overages, and final prices
still need commercial approval before sale.

## Production inputs and honest readiness

| Area                 | State                                              | Remaining proof or owner input                                                                                |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Domain and ORAP host | Live                                               | Explicit authorization for each future DNS mutation                                                           |
| Cloudflare           | Zone-scoped access approved                        | No DNS change without explicit scoped authorization                                                           |
| Deployment           | Live                                               | Preserve protected `main`, non-root `omnireach-deploy`, immutable releases, lock, health checks, and rollback |
| Google               | Deployed; owner-reported connected                 | Authenticated UI smoke and exact provider-console reconciliation                                              |
| Backups              | Repository support deployed; production incomplete | Install separated secrets, activate schedule, verify off-site copy, complete timed isolated restore           |
| Resend auth/alerts   | Repository candidate verified; production inactive | Verify domain/senders, credential, recipient, current limits, and explicitly activate                         |
| Contact forms        | Repository candidate verified; production inactive | Approve consent text, verify recipients/Turnstile/provider, and explicitly activate                           |
| OpenAI               | Policy/ledger implemented; paid calls disabled     | Model benchmark, provider evidence, and explicit activation                                                   |
| Legal/privacy        | Partial                                            | Owner-approved final privacy, cookie, terms, consent, and deletion policies                                   |
| Subscriptions        | Technical controls exist; proposal only            | Final commercial prices, setup/bespoke pricing, definitions, overage and collection/cancellation policy       |

R-013 initial objectives remain:

- 99.5% monthly availability;
- maintenance Sunday 02:00–04:00 America/Chicago;
- 24-hour backup RPO and 8-hour recovery RTO;
- critical notification through ORAP and email;
- 30-minute critical and 24-hour noncritical acknowledgment targets;
- daily encrypted backups with seven daily and four weekly copies;
- monthly restoration testing.

These are targets, not proof that every target is currently met.

## Safe continuation order

1. Finish and fully verify the current `feature/staff-ux-recovery` correction and UX
   slice, then release it through protected CI without enabling Resend.
2. Confirm the corrected production workflow passes for the exact protected-main commit
   and run independent readiness/public/unauthenticated-route smoke checks.
3. Preserve the documented email idempotency/outbox tradeoff or resolve it in a
   separately reviewed durability slice; do not imply an exactly-once guarantee.
4. Preserve the open production-proof gaps: authenticated ORAP analytics smoke, exact
   Google-console reconciliation, real R2 copy verification, and timed isolated restore.
5. Continue Priority 5 AI proposal pipeline, then Priority 6 dependency/maintenance
   review.

Release safeguards:

1. Do not rerun provider delivery or enable any email flag merely to prove the code path.
2. Do not treat repository evidence as sender-domain, recipient, free-tier, or live
   delivery proof.
3. Do not weaken authentication, tenant isolation, or direct-table denial to simplify
   the release.

The email/forms candidate's repository validation, operations/security/test-matrix
documentation, full automated suites, disposable production-Compose verification,
formatting, secret scan, and dependency audit are complete. The staff UX correction still
needs full validation and protected release.

## Useful first commands for the next session

Run from the repository root:

```powershell
git status --short
git branch --show-current
git log -5 --oneline --decorate
git diff --stat
npm run check:migrations
npm run check:production-compose
```

Do not clean, reset, checkout, or overwrite the dirty working tree. Its staff UX and
release-correction work is intentional. Inspect it before making additional changes.

## Authoritative references

- `docs/overnight-goal-progress.md` — active execution state and evidence log
- `docs/architecture.md` and `docs/adr/` — architecture and approved decisions
- `docs/production-inputs.md` — owner approvals and unresolved production inputs
- `docs/roadmap.md` — dependency-ordered development goals and gates
- `docs/security.md` and `docs/security-test-matrix.md` — controls and evidence
- `docs/operations.md`, `docs/production-compose.md`, and `docs/offsite-backup.md` —
  production operations and recovery
- `docs/google-integration-runbook.md` — Google behavior and metric semantics
- `docs/integration-contract.md` — custom website platform contract
- `docs/commercial-readiness.md` and `docs/legal-policy-readiness.md` — launch blockers
