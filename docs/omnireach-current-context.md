# OmniReach current context

> Historical snapshot. The current first-read handoff is
> `docs/omnireach-handoff-context-2026-10-14-1430z.md`.

**Snapshot:** October 13, 2026 (America/Chicago; latest deployment completed October 14 UTC)  
**Repository:** `OmniReach-Websites/SEO-Automation`  
**Latest application-changing release:** `ef35878b258845fd8e88ef6fcc340a72d84fef27`
**Audience:** Codex agents, developers, and authorized OmniReach operators

This is the current handoff document for ongoing OmniReach work. It supersedes
`omnireach-planning-context.md` as the starting context for new work, but does not erase
that earlier planning snapshot or replace the detailed architecture, ADRs, runbooks, and
production-input worksheet.

## Evidence rules

- **Live** means current direct production evidence exists.
- **Deployed** means the named commit completed the protected production workflow.
- **Implemented/tested** means source and automated evidence exist, but the capability
  may still need production configuration or a live smoke test.
- **Owner-reported** means the owner completed an external action that has not yet been
  independently reconciled against provider data.
- **Waiting** means a named credential, approval, provider setup, legal decision, or
  production proof is still required.
- Never describe a roadmap item as live merely because code or a plan exists.

## Current verified production baseline

The protected `main` workflow deployed the latest application-changing commit,
`ef35878b258845fd8e88ef6fcc340a72d84fef27`, successfully in GitHub Actions run
`38511007593`. The workflow checked out the exact commit, ran the repository build and
test gate, built immutable runtime images, packaged and transferred the release through
the restricted SSH path, activated it, and passed post-deployment checks. Later
documentation-only commits may have a newer active release SHA without changing this
application baseline; verify the latest workflow when an exact active SHA matters.

Direct checks after activation returned:

| Surface               | URL                                          | Evidence                                              |
| --------------------- | -------------------------------------------- | ----------------------------------------------------- |
| ORAP/API              | `https://admin.omnireach.cloud/health/ready` | HTTP 200; PostgreSQL and Redis ready; auth contract 3 |
| OmniReach public site | `https://omnireach.cloud/`                   | HTTP 200                                              |
| OmniReach Terms       | `https://omnireach.cloud/tos`                | HTTP 200                                              |
| OmniReach Privacy     | `https://omnireach.cloud/privacy`            | HTTP 200                                              |
| Coop pilot            | `https://coopsmobiledetailingaledo.com/`     | HTTP 200                                              |

The OmniReach public site includes GA4 measurement ID `G-5H7ZB5HMLC`. The Coop site
includes `G-B6S8N9JHL8`. Their loaders are consent-aware and site-specific; do not copy
either ID to the other site.

The latest ORAP release removes the redundant shared banner containing “OmniReach
Administration Platform,” “Managed websites, automation, and customer operations,” and
“Secure workspace.” ORAP now opens directly into each page's operational content.

## Product identity and permanent scope

OmniReach is an agency-first, managed website and search-operations platform. It is not
a self-service SaaS site builder. Staff use ORAP; authorized customers use a host-bound
Customer Admin. Public customer sites are independently served static releases.

Custom website designs are supported, but every site must comply with the versioned
OmniReach integration contract. GitHub is authoritative for application source,
templates, infrastructure definitions, and sanitized configuration. PostgreSQL is
authoritative for live editable content, facts, identities, permissions, jobs,
integrations, and audit state.

The current production scope contains:

- the OmniReach marketing and legal site;
- ORAP at `admin.omnireach.cloud`;
- the Coop pilot website and its customer-administration contract;
- centralized APIs, PostgreSQL, Redis, schedules, and bounded worker services;
- immutable GitHub Actions releases with health checks and rollback behavior.

Do not turn OmniReach into a generic visual builder, expose arbitrary HTML/CSS/JavaScript
editing, or add unapproved commerce, booking, SMS, reputation-management, social-posting,
competitor-monitoring, CRO-experiment, or advanced transactional application features.

## Architecture summary

1. Caddy terminates TLS and routes exact public and admin hostnames.
2. Static site containers serve immutable Astro output independently from the control
   plane.
3. Fastify serves authentication, ORAP, Customer Admin, integration, form, preview, and
   API routes.
4. PostgreSQL owns durable application state. Composite keys, transaction-scoped tenant
   context, Row-Level Security, and API authorization enforce tenant isolation.
5. Redis/BullMQ transports schema-validated opaque job identifiers. PostgreSQL remains
   the durable job truth.
6. Resource-limited workers rehydrate tenant/site scope, lease work, heartbeat, retry
   within policy, and persist terminal state.
7. Publishing builds a versioned content/fact/media snapshot, verifies the artifact,
   stages immutable files, and atomically changes the active release pointer. Failure
   preserves or restores the prior working release.
8. PostgreSQL and Redis are private to Docker networks and have no public host ports.

The existing shared Caddy deployment and Christians Reunite are protected workloads.
Future changes must preserve their routes, containers, networks, data, and availability.

## Authentication and staff administration

Argon2id password hashing, host-only secure cookies, origin and CSRF enforcement, rate
limits, audit records, and tenant/hostname binding remain mandatory.

Platform Owner, Platform Admin, and Staff accounts require two-step verification. A
five-minute, single-use, hash-stored email code is the routine supported second step.
TOTP and WebAuthn/passkeys remain supported stronger methods. Customer Owner, Editor,
and Viewer accounts are password-only by default and may opt into supported verification
methods.

ORAP's Team & access area now supports owner-managed staff invitation, account profile
updates, password replacement, session revocation, disabling, and authority changes.
A Platform Owner may promote another internal staff identity to Platform Owner. Changes
remain automatically audited even though the UI no longer asks employees to type an
audit reason. The final active owner cannot be demoted or disabled, and sensitive values
such as password hashes, factors, recovery codes, session tokens, and internal audit
history are never displayed as editable fields.

Email-only verification is weaker than phishing-resistant WebAuthn. Owner-level recovery
and factor replacement still need a controlled recovery procedure. Never bypass the
required second step to repair an account.

## ORAP and customer-control status

Implemented and deployed ORAP areas include:

- tenants, sites, domains, plans, subscriptions, feature overrides, and emergency state;
- internal staff authority and customer memberships;
- site detail, integration, job, schedule, crawl, finding, alert, reporting, and audit
  views;
- owner-assisted staff account recovery controls;
- Google Search Console and GA4 connection controls;
- the OmniReach dark brand system and responsive staff shell.

Customer Admin has contract-driven content editing, optimistic concurrency, draft save
and reload, preview, publish, revision history, restore, media, security/session views,
and optional contact-form controls. Owners publish; Editors publish only when explicitly
granted; Viewers are read-only.

Protected prices, hours, addresses, contact details, legal facts, owner statements, and
other contract-marked business facts remain separate from ordinary editable content.
AI must never modify them. Human changes require an authorized role and audit history.

## Public sites

### OmniReach

The public site includes responsive Home, Services, About, Contact, Privacy, Terms,
robots, sitemap, canonical metadata, and a centralized inquiry component. The `/tos`
route belongs only to `omnireach.cloud`.

The deployed design uses the approved dark palette and OmniReach brand assets. The GA4
tag is deployed. A successful public-page response does not prove that Resend delivery,
Turnstile enforcement, or legal consent wording has received final production approval;
use the provider/input statuses below.

### Coop pilot

The Coop site is a custom Astro implementation governed by its OmniReach site contract.
It includes Home, Services, Our Work, About, Contact, Privacy, 404, robots, and sitemap
routes. Its GA4 tag is deployed. Contract-governed content and media paths exist, while
protected business facts remain outside AI editing.

## Google integrations and metrics workers

The OAuth implementation uses one owner-controlled Google Cloud project and requests
only:

- `https://www.googleapis.com/auth/webmasters.readonly` for Search Console;
- `https://www.googleapis.com/auth/analytics.readonly` for GA4.

The exact callback is
`https://admin.omnireach.cloud/v1/orap/integrations/google/callback`. State, PKCE, nonce,
encrypted token storage, exact-site property mapping, disconnect behavior, and callback
error handling are implemented.

The owner reported completing both intended connections on October 13. Scheduled metrics
collection is deployed: a successful connection enables one site-scoped `metrics_sync`
schedule, admits the first run immediately, then runs daily at 04:00 UTC with up to 30
minutes of deterministic per-site jitter. Work is concurrency-one and tenant/site scope
is rehydrated under the worker database role.

Current classification: **deployed and owner-reported connected; production data not yet
fully verified**. Record first successful sync evidence, selected property identifiers in
nonsecret form, expected time zone/lag, and an exact comparison with the Google source
consoles before treating reporting values as production-verified.

## Provider and production-input status

| Input                             | Current state                                                   | Remaining proof or decision                                                                                                              |
| --------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| R-001 domain/ORAP host            | Complete/live                                                   | Continue exact-host enforcement                                                                                                          |
| R-002 owner/auth/custody          | Complete for current owner-operated model                       | Review custody before broader employee operations                                                                                        |
| R-003 infrastructure inventory    | Complete historical inventory                                   | Refresh read-only evidence before material shared-host changes                                                                           |
| R-004 Cloudflare zone/token scope | Complete for approved zone access                               | Every DNS mutation still needs explicit scope and review                                                                                 |
| R-005 off-site backup             | Partial                                                         | Install separated secrets, enable automated encrypted transfer, prove 7 daily/4 weekly retention, alerts, cost, and a timed real restore |
| R-006 legal/privacy               | Partial                                                         | Owner-approved final privacy, cookie, terms, consent, and deletion policies                                                              |
| R-007 Google                      | Partial/deployed                                                | First-sync and live-console reconciliation; confirm consent-screen/provider status                                                       |
| R-008 auth/alert email            | Complete and active                                             | Maintain dynamic active-Platform-Owner delivery and the 100/day and 3,000/month account-wide enforcement                                 |
| R-009 contact forms               | Partial                                                         | Verify customer recipients, Turnstile/provider activation, retention operation, and approved consent text                                |
| R-010 deployment                  | Complete/live                                                   | Preserve restricted non-root deployment and protected `main` policy                                                                      |
| R-011 subscriptions               | Technical controls implemented; commercial approval incomplete  | Final prices, setup/bespoke pricing, quota definitions, overages, collection, cancellation                                               |
| R-012 OpenAI                      | Model/cost verified; safety benchmark failed; provider disabled | Tune and pass representative safety/quality evaluation, then obtain explicit ongoing activation                                          |
| R-013 service objectives          | Approved                                                        | Measure them with ongoing production evidence and restoration drills                                                                     |

R-013 targets are 99.5% monthly availability; Sunday 02:00–04:00
America/Chicago maintenance; 24-hour RPO; 8-hour RTO; 30-minute critical and 24-hour
noncritical acknowledgment; and an initial target of about ten sites on the current
2-core/8 GiB VPS.

## Backup state

The private Standard-class R2 bucket `omnireach-production-backups` and a credential
limited to that bucket were created and passed an upload/download-integrity/list/cleanup
transport probe. Public `r2.dev` access is disabled, and no custom domain or CORS rule is
configured.

This does not make production backup readiness complete. The R2 credential has not been
documented as installed on the VPS, off-site mode remains disabled, and the separately
held encryption key, automated daily run, 7-daily/4-weekly retention, failure alerting,
budget evidence, and timed isolated restore still require proof. Manual deletion requires
the owner's authorization and an audit record.

## Email and forms

Approved Resend senders are:

- `auth@updates.omnireach.cloud` for authentication;
- `alerts@updates.omnireach.cloud` for urgent operational alerts;
- `forms@updates.omnireach.cloud` for centralized contact forms.

The testing address is recorded in `production-inputs.md`; do not duplicate personal
addresses in new logs or fixtures. On 2026-10-15, the provider reported the domain
verified, the host-only credential passed domain/usage checks, and controlled auth and
alert messages were reported delivered and recorded without message content.
Authentication and urgent-alert delivery are active. A two-owner production alert was
reported delivered after the dynamic active-Platform-Owner resolver was deployed.
Account-wide provider usage plus recipient-counted atomic reservations are enforced
against 100/day and 3,000/month hard caps at the approved $0 spend.

Contact forms are optional reusable components, not separate per-customer backends. ORAP
administrators can enable them per site; authorized customers can configure supported
fields and view only their site's submissions. The shared design uses Turnstile,
honeypots, rate limiting, 30-day retention except legal/security holds, and optional
confirmation email disabled by default.

## OpenAI and automation

The default per-site AI ceiling is $5 USD per UTC calendar month and the initial platform
ceiling is $50. One atomic internal ledger must admit spending only when both limits have
capacity. ORAP may configure aliases, limits, and per-site modes.

`content-review-balanced` currently maps to the selected benchmark candidate
`gpt-6.1-sol`; `content-review-economy` maps to `gpt-6-luna`. These are configurable
candidates rather than permanent promises. The 2026-10-15 production benchmark verified
model access and recorded a $0.002240 call, but deterministic proposal evaluation rejected
the output and nothing was persisted or published. Paid production calls remain disabled
with `OPENAI_PROVIDER_ENABLED=false` until a representative safety/quality benchmark
passes and ongoing activation is explicitly authorized.

Eligible fields use `AUTO`, `SUGGEST`, or `PROTECTED`. No plan, override, prompt, model,
or administrator convenience may override protected-fact restrictions.

## Deployment and repository workflow

- Only verified pushes to protected `main` deploy production.
- Branches and pull requests run CI without deployment.
- GitHub Actions uses protected secrets and an ephemeral restricted SSH identity.
- The target account is `omnireach-deploy`; do not grant unrestricted sudo or Docker
  daemon access.
- Releases are immutable, locked, health-checked, and rollback-capable.
- Production environment values, customer data, uploads, database contents, secrets,
  private keys, and backups must never enter Git, chat, artifacts, or logs.
- Do not disable root/password SSH until non-root access and emergency recovery are
  separately tested. Any credential previously transmitted through an insecure channel
  must be rotated without repeating its value in an issue, document, or chat.

The most relevant deployment definitions are:

- `.github/workflows/deploy-production.yml`
- `.github/workflows/deploy-artifact.yml`
- `infrastructure/compose/production.compose.yml`
- `infrastructure/deploy/`
- `docs/production-compose.md`
- `docs/operations.md`

## Security invariants

Never weaken these to make a feature work:

- exact verified hostnames determine tenant/site scope;
- server authorization and PostgreSQL RLS both enforce access;
- composite tenant/site references and transaction-scoped context remain mandatory;
- PostgreSQL/Redis have no public ports;
- session cookies remain secure, host-only, and scoped to their admin hostname;
- password reset never bypasses privileged verification policy;
- AI cannot propose or apply protected-fact changes;
- queue payloads contain bounded identifiers, not secrets or customer content;
- previews are authenticated, expiring, site-bound, and no-index;
- public static releases stay available during API, datastore, worker, AI, Google, or
  email-provider failures;
- failed publication or activation preserves the prior healthy public release;
- customer data, secrets, uploads, and backups never enter the public repository;
- existing Caddy/Christians Reunite behavior must be verified before and after relevant
  infrastructure changes.

## Highest-priority remaining work

1. Verify the first Search Console and GA4 metrics sync against the exact authorized
   properties and source-console totals.
2. Complete production off-site backup installation and a timed isolated restore without
   exposing either the R2 credential or encryption key.
3. Keep forms and confirmations disabled until all R-009 gates are complete; maintain
   the active urgent-alert owner resolver and quota controls.
4. Obtain final owner/legal approval for privacy, cookie, consent, terms, and deletion
   text before customer launch claims.
5. Diagnose the deterministic OpenAI evaluation failure, tune the bounded prompt/model
   path, and obtain a passing representative result before enabling ongoing paid calls.
6. Run employee-focused ORAP usability and accessibility passes using real permitted
   workflows, without weakening authorization or audit safeguards.
7. Resolve or close the six old Dependabot pull requests only after reviewing their major
   version and workflow compatibility; do not merge them as routine patch updates.

## Genuine owner decisions still pending

- final commercial approval of subscription prices, setup/bespoke fees, overages,
  cancellation, and collection rules;
- final legal/policy text and consent language;
- contact/form recipient, consent, and Turnstile approvals;
- authorization to install backup credentials/key material and enable the production
  backup schedule;
- explicit authorization to enable paid OpenAI calls after technical gates pass;
- any new DNS mutation, paid service, external purchase, new customer onboarding, or
  material shared-host change.

Credentials, secret values, private keys, provider tokens, and customer data are never
“missing context” to request in chat. Ask the owner to place them directly in the approved
host-only or GitHub Actions secret channel.

## Safe continuation checklist

Before starting a new task:

1. Read this file and the ADR/runbook for the affected subsystem.
2. Fetch `origin/main` and create a focused branch; preserve unrelated user changes.
3. Confirm whether the task is repository-only or explicitly authorizes an external
   mutation.
4. Inspect current production or provider state read-only when freshness affects the
   decision.
5. Add tests for the changed security, tenant, UI, or deployment contract.
6. Run the smallest focused tests, then the repository checks proportional to risk.
7. Use a pull request and protected `main` for production code. Watch the production run
   through post-deployment verification.
8. Update this context only with evidence established during the task.

Useful repository checks include:

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

Do not run every expensive suite blindly for a documentation-only change. Use the full
protected workflow before production deployment.

## Detailed sources of truth

- Architecture: `docs/architecture.md`
- Decisions: `docs/adr/`
- Approved inputs and authorization: `docs/production-inputs.md`
- Operations and deployment: `docs/operations.md`, `docs/production-compose.md`
- Google: `docs/google-integration-runbook.md`
- Backup/restore: `docs/offsite-backup.md`
- Security: `docs/security.md`, `docs/security-test-matrix.md`
- Site contract: `docs/integration-contract.md`
- Roadmap and historical progress: `docs/roadmap.md`
- Earlier planning snapshot: `docs/omnireach-planning-context.md`

When a status conflicts, current runtime evidence wins for “Live,” current protected
`main` wins for repository implementation, the ADRs define architecture, and
`production-inputs.md` defines owner approvals. Resolve and document the discrepancy
instead of silently choosing the most convenient statement.
