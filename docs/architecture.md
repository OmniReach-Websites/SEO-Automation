# OmniReach Architecture Baseline

**Status:** Approved planning baseline  
**Authority:** [`masterplan.md`](masterplan.md), refined by approved decisions in [`roadmap.md`](roadmap.md)  
**Scope:** G01 documentation only; no environment is provisioned by this document

## 1. Product boundary

OmniReach is permanently agency-first. OmniReach staff create and integrate sites; customers can manage only the fields, media, sections, users, and actions explicitly granted for an existing site. There is no customer site-provisioning flow, arbitrary code editor, or general-purpose page builder.

Sites may have completely custom visual designs. Compliance is behavioral rather than visual: each site must implement the versioned integration contract in [`integration-contract.md`](integration-contract.md). V1 supports static/prerendered public pages and bounded contact forms. Commerce, reservations, arbitrary server code, custom databases, and other transactional applications require a separately approved adapter, threat model, backups, and deployment plan.

### 1.1 Commitment and decision taxonomy

| Category                         | Meaning                                                                                                             | Examples                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Product invariant                | Owner-approved and non-negotiable unless the master plan is deliberately revised                                    | Agency-first, one source monorepo, per-field AI controls, protected facts, main-only deploy |
| Approved architecture decision   | Binding implementation direction recorded by D-ID/ADR                                                               | RLS plus API checks, static artifacts, host-only customer sessions, local media adapter     |
| Owner-supplied production input  | Concrete value/permission/policy that architecture must not invent                                                  | R-001 actual domain, R-006 legal policies, R-010 deploy credentials                         |
| Reversible implementation detail | May be selected by the implementing goal within the approved boundaries and documented in code/ADR if consequential | Package naming, conservative timeouts, internal module layout                               |

Unresolved R-series inputs do not reopen D-series architecture. They block only the production/external step that needs the concrete value.

## 2. System context and trust boundaries

```text
Users
  ├─ OmniReach staff ──> ORAP ───────────────┐
  ├─ Customer users ──> admin.<customer> ────┤
  └─ Public visitors ─> customer domains     │
                                               ▼
Cloudflare DNS ─> shared Caddy ─> immutable static artifacts
                         │          (serving plane)
                         ├─> ORAP / customer-admin
                         └─> Fastify control API
                                  │
                     ┌────────────┼─────────────┐
                     ▼            ▼             ▼
                 PostgreSQL      Redis      media adapter
                 authoritative   queue      local V1 store
                 live content    state      + backups
                     │            │
                     └────> bounded workers/scheduler
                                  │
                       ┌──────────┴──────────┐
                       ▼                     ▼
                   OpenAI API         Google/Cloudflare APIs

GitHub monorepo/main ─> Actions build/test ─> immutable artifact
                                               │ SSH
                                               ▼
                                        versioned VPS release
```

Trust boundaries:

1. **Public edge:** Cloudflare/Caddy and public visitors are untrusted. Hosts are accepted only when mapped to a verified domain record.
2. **Browser-to-control-plane:** ORAP and customer-admin browsers are untrusted clients. Authentication does not replace per-action authorization, CSRF protection, or input validation.
3. **Tenant boundary:** Every site-scoped read, write, asset, job, metric, and artifact reference is checked in service code, relational constraints, and PostgreSQL RLS.
4. **Worker boundary:** Redis payloads carry opaque identifiers, not credentials or bulk private content. Workers rehydrate scope and recheck policy at execution.
5. **AI/provider boundary:** Crawled text, customer content, provider output, and model output are untrusted data. The model receives no shell, raw database, filesystem, deployment, or unrestricted mutation capability.
6. **Deployment boundary:** GitHub builds verified source. A restricted SSH identity may activate only immutable releases through reviewed scripts. Production never authors or pushes source.
7. **Existing-service boundary:** Shared Caddy and Christians Reunite are external protected workloads. OmniReach integration is additive, inventoried, validated, and separately authorized.

## 3. Planes and failure isolation

### 3.1 Serving plane

- Versioned static site artifacts are served independently of the API, Redis, workers, OpenAI, and Google.
- Each active site points atomically to one verified artifact.
- An artifact records code SHA, site-contract version, content revision ID, asset-manifest hash, tool versions, routes, checksums, and health expectations.
- Contact-form failure can reject a submission gracefully but cannot prevent static pages from loading.
- A failed build or activation leaves the previous healthy artifact active.

### 3.2 Control plane

- Fastify API owns authorization, tenant context, content workflows, policies, budgets, integrations, and audit events.
- ORAP is the staff interface. Customer-admin is a shared application selected by an exact verified admin hostname.
- PostgreSQL is authoritative for identities, memberships, domains, structured content, protected facts, revisions, policies, ledgers, jobs, metrics, alerts, and deployment metadata.
- Control-plane unavailability does not remove or invalidate already published artifacts.

### 3.3 Worker plane

- BullMQ/Redis coordinates bounded, idempotent jobs; PostgreSQL remains authoritative for durable business state.
- A PostgreSQL lease admits due schedules and claims queued job rows; BullMQ receives
  opaque envelopes only after a durable job exists. Dispatch completion is recorded so
  a scheduler crash or transient Redis failure can be retried without duplicate intent.
- Workers share an initial runner but retain separate modules for crawling, SEO, AIO, publishing, scheduling, and monitoring.
- Per-type and per-site concurrency caps protect the initial 2-core/~8 GiB VPS.
- A single publish lock exists per site. Jobs recheck site status, effective policy, content revision, budget, and authorization when execution begins.

## 4. Component responsibilities

| Component                | Owns                                                                                          | Must not own                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/api`               | Validated HTTP contracts, authenticated context, authorization, orchestration                 | UI state, arbitrary tenant selection, provider secrets in responses |
| `apps/orap`              | Staff workflows, operations views, audited controls                                           | Direct DB/provider access, customer password visibility             |
| `apps/customer-admin`    | Site-resolved dashboard/editor/proposal UI                                                    | Cross-site selection, raw code editing, shared-domain cookies       |
| `sites/*`                | Custom frontend source, manifest, safe render/build hooks                                     | Live editable content, credentials, arbitrary production mutation   |
| `packages/database`      | Prisma schema, migrations, roles, RLS, constraints                                            | Authorization shortcuts based only on IDs supplied by callers       |
| `packages/auth`          | Credentials, account auth policy, verification methods, assurance, sessions, reset/revocation | Tenant entitlement decisions                                        |
| `packages/tenant`        | Tenant/site context, memberships, entitlements, overrides                                     | Content rendering or provider calls                                 |
| `packages/contracts`     | Versioned site manifest and field/component schemas                                           | Inference from arbitrary DOM                                        |
| `packages/content`       | Facts, drafts, revisions, proposals, publication state                                        | Source-code edits or direct provider side effects                   |
| `packages/queue`         | Job schemas, idempotency, retries, locks, opaque BullMQ transport                             | Secrets or large content payloads                                   |
| `packages/ai`            | OpenAI adapter, schemas, prompt/model versions, reservations/usage                            | Authorization, fact policy, direct publication                      |
| `packages/seo-core`      | Deterministic crawl/audit rules and evidence                                                  | Ranking guarantees or invented facts                                |
| `packages/integrations`  | Scoped Cloudflare/Google/email adapters                                                       | Global credentials in browsers or logs                              |
| `packages/observability` | Structured logs, traces, alerts, redaction                                                    | Sensitive content by default                                        |
| `workers/*`              | Bounded execution of registered job types                                                     | Ambient superuser access or direct source-tree writes               |
| `infrastructure/*`       | Isolated compose, routes, release, backup scripts                                             | Ownership of shared Caddy/Christians Reunite projects               |

## 5. Data ownership and lifecycle

| Data class                      | Authority                                        | Versioning/retention                                     | Publication behavior                              |
| ------------------------------- | ------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------- |
| Source code/templates/manifests | GitHub `main`                                    | Git history                                              | Actions builds exact verified SHA                 |
| Editable content                | PostgreSQL                                       | Stable field IDs, structured JSON, immutable revisions   | Snapshot referenced by artifact                   |
| Protected business facts        | PostgreSQL separate records                      | Verification/provenance plus audited human revisions     | Rendered through immutable references/tokens      |
| Original media                  | Media adapter; local persistent filesystem in V1 | Site-isolated keys, checksum, retention, backups         | Artifact references immutable derivative/manifest |
| Build artifacts                 | Versioned artifact store                         | Immutable checksums and active pointer                   | Atomic activation/rollback                        |
| Jobs/operational logs           | PostgreSQL/Redis as appropriate                  | 90-day detailed jobs; 30-day operational logs by default | Never source of published truth                   |
| Audit records                   | PostgreSQL append-oriented records               | 12-month default, configurable holds                     | Never silently rewritten                          |
| Backups                         | Local plus encrypted off-server store            | 7 daily, 4 weekly; monthly restore test                  | Recovery only; never committed                    |

Lifecycle:

```text
developer source change -> PR checks -> merge to main -> Actions build/test
-> checksummed immutable release -> restricted SSH stage -> health check
-> atomic code release activation -> deployment event

customer/staff/AI proposal -> authorization/effective field policy
-> draft or typed proposal -> deterministic validation -> immutable content revision
-> frozen content+asset snapshot -> site build -> output validation
-> atomic site artifact activation -> publication/deployment event
```

No process writes runtime content to `main`. Optional future sanitized exports use a non-deploying branch or artifact workflow.

## 6. Identity, tenancy, subscriptions, and policy

- Identities are global; authorization comes from Platform Owner, Platform Admin, Staff, Customer Owner, Customer Editor, or Customer Viewer grants.
- Authentication policy is account-level and evaluated with the exact resolved login
  host and membership. Platform Owner, Platform Admin, and Staff accounts require two
  steps. Their routine second step may be a five-minute, single-use, hash-only email code
  with strict atomic attempt and resend limits; no full ORAP session exists before the
  challenge succeeds.
- The configured canonical ORAP hostname is a reserved platform identifier. It cannot be
  assigned to or resolved through a customer domain, including recovery and security
  settings paths.
- TOTP remains available and WebAuthn/FIDO2 passkeys are the optional stronger methods.
  Sensitive owner recovery or security changes require a recent TOTP/WebAuthn step or an
  explicitly approved, one-time audited break-glass procedure. Email verification and
  an ordinary recovery-code session do not provide that stronger authorization.
- Customer Owner, Customer Editor, and Customer Viewer accounts are password-only by
  default. They may voluntarily enable email-code verification, TOTP, or WebAuthn from
  tenant-safe security settings. A method is not active until verified, and a customer
  setting cannot weaken a stricter policy on the same global identity.
- Sessions record method, assurance, and verification time. Customer sessions remain
  separate host-only secure sessions for each verified `admin.<customer-domain>`; ORAP
  session revocation of customer access is exact-site and audited. Session creation
  locks and revalidates the credential/password-hash state, membership, exact verified
  host, account policy, and selected factor immediately before insertion. Pending
  challenges bind a monotonic account authentication-state version that is compared
  again during session insertion, so password, membership, platform-role, policy, or
  factor changes invalidate stale challenges and concurrent changes fail closed.
- Recovery codes are the only ordinary fallback when an eligible customer has no
  deliverable email/TOTP method: password success may create a recovery-only pending
  challenge, but only a valid code can create the restricted 15-minute recovery session.
  Final code consumption, sibling revocation, and restricted-session insertion are one
  database transaction. Platform accounts never receive this fallback, and customer
  recovery or security-policy mutation rechecks platform membership after locking the
  identity so concurrent promotion fails closed.
- Some method-specific durable audit outcomes—such as issuance/resend failures, limiter
  denial, delivery exhaustion, bootstrap failure, and method change—remain G05 work.
  Generic request logs are not the authoritative security audit trail.
- Login, email issuance, verification, recovery issuance, invitation acceptance, and
  reset completion use atomic account/token-digest and client-network limits. Invitation
  and reset-completion admission happens before Argon2id work, limiting unauthenticated
  CPU and memory amplification across API processes.
- Customer Owners can publish. Customer Editors can publish only with an explicit site-scoped grant. Customer Viewers are read-only.
- A tenant may own multiple sites. Each website has exactly one subscription record, independent entitlements/overrides, and one AI budget period.
- Effective policy order is: nonoverrideable safety rules, platform kill switches, ORAP site overrides, plan defaults, customer field preferences, safe defaults.
- Nonpayment does not take the public site offline. Editing and new automation may be suspended only after the configured grace period.
- STARTER, GROWTH, PRO, and ELITE are versioned per-website plan proposals. Prices and
  setup/bespoke charges remain commercial proposals until final approval. Numeric seats,
  standard pages, locations, audit cadence, and AI review cycles require server-side
  quota enforcement rather than UI labels.
- Plan inclusion never proves capability readiness. An unfinished, untested, or inactive
  production feature remains unavailable regardless of its planned entitlement; contact
  forms are the explicit initial example.

Tenant isolation uses transaction-scoped database context, PostgreSQL RLS, composite foreign keys, server-side host resolution, service authorization, and adversarial tests. See [ADR 0002](adr/0002-tenant-isolation-and-data-scoping.md).

## 7. Site and content contract

The integration contract declares routes, content fields, component types, facts references, permissions, AI modes, build output, preview behavior, contact forms, and health checks. A site can be visually unique and developer-authored; only its managed surface is standardized.

Content fields have stable IDs, schema versions, optimistic concurrency, provenance, and one effective AI mode:

- `AUTO`: eligible marketing copy may proceed through proposal, deterministic validation, staging, and publication.
- `SUGGEST`: a proposal is stored for an authorized human; no automatic publication.
- `PROTECTED`: AI generation and mutation are rejected.

Protected prices, hours, addresses, contact details, legal text, and other material facts live separately. If a mixed field cannot preserve fact references safely, the whole field is protected. Authorized Customer Owners and ORAP staff use a separate audited fact workflow.

## 8. External integrations

- **OpenAI:** one server-side provider adapter; configurable model aliases; official SDK/Responses API; Structured Outputs where supported; refusal/incomplete handling; no direct side effects. Application policy remains authoritative.
- **Cloudflare:** DNS record planning/apply/verification only in V1. Domain purchase and renewal are manual and audited.
- **Search Console/GA4:** OAuth, encrypted token references, least-privilege scopes, exact property mapping, consent, provenance, and not-connected states.
- **Email:** internal alert delivery sends only policy-defined urgent errors, and the
  authentication adapter can deliver invitation, recovery, and five-minute verification
  messages. Authentication delivery is disabled by default until separately activated;
  failure never bypasses required ORAP verification. Codes and provider credentials are
  excluded from logs and audit payloads. Password-recovery requests commit a restricted
  recovery-token record and then enqueue the purpose-bound encrypted, short-lived
  delivery copy in a second consecutive transaction before a lease-based processor calls
  the provider. Those two transactions are not atomic: a narrow failure can leave a
  valid but undelivered token until expiry, while the response remains generic and a
  retry safely replaces it. Provider latency is outside the request path, failures have
  bounded retries, terminal records erase ciphertext, and nonexistent identities never
  generate decoy messages.
- **Contact forms:** contract-declared fields, verified site/origin, rate limits, abuse hooks, minimal retention, delivery adapter, and no attachments by default.

Production credentials, accounts, hostnames, providers, permissions, legal text, and spending commitments remain R-001 through R-012 in the roadmap.

## 9. Environments

| Name         | Purpose                                                | Data                               | External mutations                                                    |
| ------------ | ------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------- |
| `local`      | Developer execution and unit/integration testing       | Fabricated only                    | None; mock/sink providers by default                                  |
| `ci`         | Pull-request/branch checks and artifact creation       | Ephemeral fabricated fixtures      | None; cannot reach production secrets                                 |
| `staging`    | Isolated release, routing, restore, and E2E validation | Fabricated or explicitly sanitized | Only approved sandbox/test accounts                                   |
| `production` | Live OmniReach control/serving/worker planes           | Approved customer data             | Protected `main` deploy and separately authorized provider operations |

Environment names are logical contracts, not evidence that any environment has been provisioned. G19 creates an inert deployment foundation; G31 is the separately authorized production activation.

Auth Contract v2 is a release compatibility boundary, not merely a schema version.
Applying its schema or writing v2 authentication state establishes the cutoff. From that
point, deployment and rollback may activate only artifacts that explicitly declare v2
compatibility; missing or incompatible metadata fails closed. Production authentication
also remains gated on a versioned keyring and tested rotation/retirement procedure for
the current single `MFA_ENCRYPTION_KEY`. The ordinary release script already refuses to
cross from a running pre-v2 release to a v2 artifact; the first bridge/forward-recovery
runbook and explicit release metadata still require validation before activation.

## 10. Failure behavior

| Failure                                | Required behavior                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| API/admin unavailable                  | Published public artifacts remain available                                                                  |
| Redis/worker unavailable               | Serving continues; durable state remains; jobs recover/dedupe                                                |
| OpenAI unavailable or budget exhausted | Deterministic checks continue; no unsafe publication; alert/status recorded                                  |
| Google/Cloudflare/email unavailable    | No fabricated success; retry bounded; public serving unaffected                                              |
| Build/validation/health failure        | Prior artifact remains active; draft/proposal preserved; actionable alert                                    |
| Bad code release                       | Automatic rollback only to a contract-compatible prior artifact; otherwise forward fix or compatible restore |
| Backup failure                         | Critical alert; no destructive pruning; production readiness fails                                           |
| Caddy/config failure                   | Validation prevents reload or prior config is restored; existing routes checked                              |

## 11. Architecture invariants traceability

This table maps the 18 final product invariants in `masterplan.md` Section 28 to architecture evidence and delivery goals.

| Invariant                                         | Architecture evidence      | Primary goals          |
| ------------------------------------------------- | -------------------------- | ---------------------- |
| 1. Agency-operated                                | Sections 1 and 7           | G07, G09, G14–G16, G32 |
| 2. One monorepo for code                          | Sections 4–5               | G02–G03, G09–G10, G19  |
| 3. Main-only SSH production deploy                | Sections 5 and 9           | G03, G19, G31          |
| 4. Safe versioned live content without Git loop   | Sections 5 and 7           | G11, G13, G16, G19     |
| 5. Tenant isolation at multiple layers            | Sections 2 and 6           | G04–G06, G30           |
| 6. Site-resolved customer admin/editor            | Sections 2, 6, 7           | G14–G16, G18           |
| 7. ORAP site controls                             | Sections 4 and 6           | G07–G08, G21–G22       |
| 8. AUTO only for eligible text; off means SUGGEST | Section 7                  | G11, G25–G26           |
| 9. AI never changes protected facts               | Sections 2 and 7           | G11, G25–G26, G30      |
| 10. Separate audited human fact editing           | Section 7                  | G11, G15–G16           |
| 11. Typed AI proposals; no unrestricted editing   | Sections 2, 4, 8           | G25–G26                |
| 12. Automatic changes traceable/reversible        | Sections 5, 7, 10          | G11, G16, G26          |
| 13. $5/site/month budget                          | Sections 6 and 8           | G21, G25–G26           |
| 14. Honest SEO/AIO reporting                      | Section 8                  | G23–G28                |
| 15. Sites online without workers/OpenAI           | Sections 3 and 10          | G13, G16, G30          |
| 16. Protect Christians Reunite/shared Caddy       | Sections 2, 4, 9, 10       | G18–G19, G30–G32       |
| 17. Protect secrets/customer information          | Sections 2, 4, 8           | G02–G06, G12, G19, G30 |
| 18. Incremental tested milestones                 | Roadmap execution contract | G01–G32                |

## 12. Acceptance-scenario traceability

| Scenario                               | Evidence-producing goals |
| -------------------------------------- | ------------------------ |
| A. Multi-tenant isolation              | G06, G30                 |
| B. Customer editor/publish/recovery    | G15–G16, G30             |
| C. Protected facts                     | G11, G26, G30            |
| D. Suggestion-only mode                | G25–G26, G30             |
| E. Autonomous mode                     | G16, G25–G26, G30        |
| F. AI budget                           | G21, G25–G26, G30        |
| G. Main-only deploy/rollback           | G03, G19, G31            |
| H. Existing workloads unchanged        | G18–G19, G30–G32         |
| I. Domain onboarding/session isolation | G14, G17–G18, G31–G32    |
| J. Alerts                              | G21–G22, G29–G31         |
| K. Recovery                            | G16, G19, G29–G31        |
| L. Analytics honesty                   | G27–G28, G30             |

## 13. Related records

- [Security baseline](security.md)
- [Operations baseline](operations.md)
- [Site integration contract](integration-contract.md)
- [ADR index](adr/README.md)
- [Dependency-ordered roadmap](roadmap.md)
