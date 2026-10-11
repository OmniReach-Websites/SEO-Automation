# OmniReach Development Roadmap

**Status:** Approved architecture roadmap; implementation state is tracked in Section 7  
**Source of truth:** `docs/masterplan.md` version 1.0 (2026-10-10)  
**Last reviewed against master plan:** 2026-10-10  
**Progress values:** `not started`, `in progress`, `blocked`, `complete`  
**Planning constraint:** The architecture decisions in Section 3 are approved. On 2026-10-11
the owner authorized G31 production completion work. That authorization does not invent
missing legal text, customer consent, paid-provider credentials, or a real G32 pilot.

## 1. Repository assessment

The original planning baseline contained only `README.md` and `docs/masterplan.md`. The repository now contains local implementation artifacts, tests, and documentation created by goals recorded as complete or in progress in Section 7. Future Codex runs must inspect the current working tree and preserve unrelated or user-owned changes rather than assuming a blank repository.

The production VPS, shared Caddy, Cloudflare configuration, external accounts, and Christians Reunite deployment remain external systems whose current state is not inferred from local files. Their discovery is a separate read-only, explicitly authorized operation, and production mutation remains gated by G31/G32.

## 2. Non-negotiable implementation boundaries

Every goal below must preserve these invariants:

1. OmniReach is permanently agency-first. Customers can edit existing managed sites within granted permissions, but cannot self-provision sites or use OmniReach as a general-purpose self-service website builder.
2. Customer sites may have completely custom frontend designs, provided each site implements and passes the versioned OmniReach integration contract. Complex applications require separately approved adapters and security review.
3. GitHub is authoritative for source code; PostgreSQL is authoritative for editable live content; the configured media store is authoritative for original media; published versions are immutable artifacts.
4. Only verified `main` builds may automatically reach production. Branch builds run CI without deploying, and deployment is push-triggered rather than periodically polled.
5. Public sites remain available if the API, dashboards, Redis, workers, OpenAI, or Google integrations fail.
6. Site and tenant authorization is derived server-side from authenticated membership and verified host mappings, never from a caller-provided tenant or site identifier alone.
7. AI receives bounded context and returns typed, field-scoped proposals. Deterministic application code owns authorization, per-field editing permissions, protected facts, costs, persistence, publication, and rollback.
8. AI can automatically edit only eligible marketing fields. Disabling automatic editing means suggestion-only. AI can never modify or suggest replacement values for protected business information.
9. Every state-changing operation is attributable, validated, idempotent where applicable, observable, and reversible where technically possible.
10. Real credentials, customer records, private assets, backups, and secrets must never enter the repository.
11. No production infrastructure, DNS, shared proxy configuration, external account, or existing service is changed in a planning or local-development goal.
12. A goal is not complete merely because files exist; its tests and goal-specific end-to-end check must pass using fictional data.

## 3. Approved architecture decisions and remaining owner inputs

The architecture choices below are approved and are no longer open design questions. ADRs created by G01 must record these decisions rather than reconsider them. Only the concrete production information in Section 3.2 remains unresolved.

| ID    | Status                                | Approved decision                                                                                                                                                                                                                                                                                                          | Applies to            |
| ----- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| D-001 | Approved, production value supplied   | Use `admin.<OmniReach-domain>` for ORAP. The approved V1 base domain is `omnireach.cloud`, making the canonical ORAP hostname `admin.omnireach.cloud`; keep both values configurable.                                                                                                                                      | G01, G17–G19, G31–G32 |
| D-002 | Approved                              | Use email/password with Argon2id, mandatory authenticator-app MFA for ORAP staff, recovery codes, and secure one-time owner setup.                                                                                                                                                                                         | G05, G07, G31–G32     |
| D-003 | Approved                              | Use a central identity database with separate secure, host-only sessions for each `admin.<customer-domain>`.                                                                                                                                                                                                               | G05, G14              |
| D-004 | Approved                              | Enforce PostgreSQL RLS, composite foreign keys, transaction-scoped tenant context, and API authorization.                                                                                                                                                                                                                  | G04, G06              |
| D-005 | Approved; four-tier proposal selected | Use one subscription per website, four versioned configurable plan proposals, and per-site ORAP feature/quota overrides that cannot weaken mandatory security rules.                                                                                                                                                       | G04, G08, G21         |
| D-006 | Approved                              | Roles are Platform Owner, Platform Admin, Staff, Customer Owner, Customer Editor, and Customer Viewer. Customer Owners and explicitly authorized Editors can publish. All action grants remain deny-by-default and site-scoped.                                                                                            | G05–G08, G14–G16      |
| D-007 | Approved                              | Store live editable content in PostgreSQL using stable field IDs, versioned structured JSON, optimistic concurrency, and immutable revisions.                                                                                                                                                                              | G09, G11, G15–G16     |
| D-008 | Approved                              | Store prices, hours, addresses, contact details, legal facts, and other protected information separately. AI can never modify or suggest replacements for them; protect the entire field when safe separation is impossible. Authorized Customer Owners and ORAP staff may edit facts through a separate audited workflow. | G11, G26              |
| D-009 | Approved                              | Publish immutable static website builds from versioned content snapshots, activate atomically, and roll back automatically on failure.                                                                                                                                                                                     | G13, G16, G19, G31    |
| D-010 | Approved                              | Use authenticated, expiring, no-index previews isolated from production pages.                                                                                                                                                                                                                                             | G13, G15              |
| D-011 | Approved                              | Use a persistent local filesystem initially behind an object-storage adapter, with site isolation, upload validation, integrity checks, retention, and backups.                                                                                                                                                            | G12, G29              |
| D-012 | Approved                              | GitHub Actions builds and tests verified commits, then transfers immutable artifacts to the VPS over SSH. Only `main` can deploy, and deploys are push-triggered.                                                                                                                                                          | G03, G19, G31         |
| D-013 | Approved                              | Reuse Caddy, keep Christians Reunite isolated and untouched, and require a read-only infrastructure inventory before any production integration.                                                                                                                                                                           | G18–G19, G29–G32      |
| D-014 | Approved                              | Automate Cloudflare DNS records and domain verification. Handle domain purchasing and renewal manually in V1.                                                                                                                                                                                                              | G17–G18, G31–G32      |
| D-015 | Approved                              | Default to a hard cap of $5 USD per website per UTC calendar month, resetting at 00:00 UTC on the first day. Allow audited ORAP configuration.                                                                                                                                                                             | G21, G25–G26          |
| D-016 | Approved; R2 proposed, proof pending  | Create daily encrypted database/content/media/configuration backups, retain 7 daily and 4 weekly copies, keep an encrypted off-server copy in proposed Cloudflare R2, and perform a full isolated restoration test monthly.                                                                                                | G29, G31–G32          |
| D-017 | Approved                              | Keep code, templates, manifests, and sanitized configuration in GitHub. Never commit customer data, uploads, secrets, tokens, backups, or unsanitized runtime exports.                                                                                                                                                     | G02, G09, G12, G19    |
| D-018 | Approved; Texas, policy text pending  | Use consent-aware analytics, configurable retention, and minimal collection. Initial operation is in Texas, USA; owner-approved legal policies are required before customer launch.                                                                                                                                        | G27–G29, G32          |
| D-019 | Approved; project strategy supplied   | Integrate Search Console and GA4 through one owner-controlled OmniReach Google Cloud OAuth project, encrypted tokens, least-privilege scopes, and individually authorized verified site/property mappings.                                                                                                                 | G27–G28               |
| D-020 | Approved                              | Permit completely custom customer frontend designs that comply with the OmniReach integration contract. V1 supports static pages and bounded contact forms; complex applications require separate approval, adapters, data stores, backups, and security review.                                                           | G09–G10, G13, G32     |
| D-021 | Approved; Resend selected             | Provide an ORAP alert center plus Resend email for critical errors, with fingerprinting, deduplication, acknowledgment, assignment, and resolution.                                                                                                                                                                        | G22, G28–G32          |
| D-022 | Approved                              | Report verifiable AI referral traffic, structured-data completeness, and clearly labeled sampled AI mentions. Never promise rankings or present proxy measures as established external ranking.                                                                                                                            | G24, G27–G28          |
| D-023 | Approved                              | Use configurable retention categories with defaults of 30 days for operational logs, 90 days for detailed job records, and 12 months for audit records. Preserve content revisions according to site policy and never silently prune them.                                                                                 | G11, G20, G22, G29    |
| D-024 | Approved                              | G01 creates architecture, security, operations, integration-contract, and ADR documentation before application implementation.                                                                                                                                                                                             | G01–G02               |

### 3.1 Additional approved product and delivery decisions

| Topic                  | Approved decision                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operating model        | OmniReach remains agency-first permanently and does not become a self-service SaaS site builder.                                                                  |
| Customer editor        | Use structured form-based editing with live preview; do not expose arbitrary source, DOM, HTML, CSS, or JavaScript editing.                                       |
| AI text editing        | Enable AUTO by default only for eligible fields; turning it off changes the field to SUGGEST, not disabled.                                                       |
| Protected fact editing | Authorized Customer Owners and ORAP staff can manually edit protected facts through a dedicated audited workflow. AI remains categorically unable to change them. |
| Nonpayment             | Keep public websites running. Suspend new automation and editing only according to an explicit grace-period policy.                                               |
| Subscription proposal  | Use STARTER, GROWTH, PRO, and ELITE as configurable per-website plans; proposed prices require final commercial approval.                                         |
| Git branching          | Only `main` deploys to production; testing branches run CI without deployment.                                                                                    |
| Deployment timing      | Use push-triggered GitHub Actions, not periodic repository polling.                                                                                               |
| Deployment sequencing  | Implement the GitHub Actions/SSH foundation early, but make full production release activation a separate late goal after backup and release-gate validation.     |
| OpenAI models          | Keep model selections configurable behind one provider integration with per-site cost tracking.                                                                   |
| Reporting              | Show traffic, search performance, completed improvements, and defined AIO measurements with provenance and limitations.                                           |
| Scaling                | Start on the existing 2-core, approximately 8 GiB VPS; cap worker resources and retain independently scalable worker/storage adapters.                            |

### 3.2 Remaining owner-supplied production information

These are not architecture choices for Codex to invent. A goal may implement a configurable interface or local fixture without them, but any affected production step remains blocked.

| ID    | Owner input still required                                                                                                                                                                                                                                                                                                                                                                  | Needed before                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| R-001 | Complete: base domain and DNS zone `omnireach.cloud`; canonical ORAP hostname `admin.omnireach.cloud`.                                                                                                                                                                                                                                                                                      | Production domain/routing setup in G31                         |
| R-002 | Complete: owner account is `rhajj@omnireach.cloud`; owner retains MFA recovery codes in encrypted storage and is the sole initial break-glass approver. Protected GitHub Actions secrets and host-only restricted environment files or Docker/Compose secret mounts are approved.                                                                                                           | Production identity bootstrap in G31/G32                       |
| R-003 | Complete: owner-authorized read-only inventory and supplemental runtime/SSH evidence reviewed; no production mutation performed.                                                                                                                                                                                                                                                            | G18 design finalization and all production work                |
| R-004 | Complete: owner controls `omnireach.cloud`; the ignored token/account pair resolved exactly one active matching zone in a read-only 2026-10-11 check without logging identifiers. The DNS adapter repeats this fail-closed lookup. Every concrete DNS mutation remains separately approved.                                                                                                 | Production DNS in G31/G32                                      |
| R-005 | Partial: Cloudflare R2 is the proposed production off-server provider with a proposed $5 monthly budget. Owner is sole encryption-key custodian/manual-deletion approver. Least-privilege setup, separate credentials/keys, automated 7-daily/4-weekly upload, cost validation, and a successful real restore remain pending; no spending is authorized.                                    | Production backup activation in G29/G31                        |
| R-006 | Partial: initially operate in Texas, USA. Privacy, cookie-consent, terms, and deletion policies require business-owner review before launch; exact approved policy text, incident notification, and revision-retention rules remain pending.                                                                                                                                                | Real analytics or customer launch in G27/G32                   |
| R-007 | Partial: use one owner-controlled OmniReach Google Cloud OAuth project and connect each customer's Search Console/GA4 properties individually through authorized accounts. Project ID, redirect URIs, consent-screen status, concrete properties, and access remain pending.                                                                                                                | Live Search Console/GA4 connection in G27/G32                  |
| R-008 | Planned: Resend free plan with `updates.omnireach.cloud`; alert sender `alerts@updates.omnireach.cloud`; auth sender `auth@updates.omnireach.cloud`; testing recipient `rhajj@omnireach.cloud`; $0 spend, 3 retries, dedupe, and ORAP delivery-failure history. Verification, provider setup, credentials, final production recipient confirmation, and activation remain pending.          | Production email alerts in G22/G31                             |
| R-009 | Partial: optional reusable centralized forms use Resend with selected sender `forms@updates.omnireach.cloud`, verified per-site recipients, 30-day retention except legal/security holds, Turnstile, honeypots, rate limits, and confirmation email off by default. Recipient verification, provider/DNS setup, credentials, explicit activation, and legal consent wording remain pending. | Live contact forms in G31/G32                                  |
| R-010 | In progress: repository, restricted `omnireach-deploy` identity, verified ED25519 host key, protected `production` environment, main-only deployment policy, and key custody are configured. The owner authorized end-to-end G31 completion on 2026-10-11. The one-time root install, live permission/prechecks, deployment, and rollback evidence remain pending.                          | Production release activation in G31                           |
| R-011 | Selected proposal: STARTER $500/2 seats/5 pages/weekly SEO/2 AI cycles; GROWTH $1,000/5/10/daily/8; PRO $1,500/10/20/daily/16; ELITE $2,000/20/30/daily/30. One site/location by default, ORAP configuration/overrides, $5 site AI budget, and 14-day grace apply. Final prices, setup/bespoke fees, definitions, and overage policy remain pending.                                        | Commercial customer onboarding in G32                          |
| R-012 | Partial: dedicated project/key is host-configured; owner controls spend. Atomic $5/site and $50 platform caps apply. Candidate aliases map balanced content review to `gpt-6.1-sol` and economy to `gpt-6-luna`; `OPENAI_PROVIDER_ENABLED=false` until representative cost/quality tests and explicit paid-call activation.                                                                 | Live OpenAI calls in G25/G32                                   |
| R-013 | Approved 2026-10-10: 99.5% monthly availability; Sun 02:00–04:00 America/Chicago maintenance; RPO 24h; RTO 8h; critical/noncritical acknowledgment 30m/24h; initial ~10-site capacity.                                                                                                                                                                                                      | Release thresholds in G30 and production activation in G31/G32 |

#### R-011 selected subscription proposal

| Tier    | Proposed monthly price | Customer seats | Included standard pages | SEO audit frequency | AI content-review cycles |
| ------- | ---------------------- | -------------- | ----------------------- | ------------------- | ------------------------ |
| STARTER | $500                   | 2              | 5                       | Weekly              | 2/month                  |
| GROWTH  | $1,000                 | 5              | 10                      | Daily               | 8/month                  |
| PRO     | $1,500                 | 10             | 20                      | Daily               | 16/month                 |
| ELITE   | $2,000                 | 20             | 30                      | Daily               | 30/month                 |

Each plan is assigned per website and includes one primary website and one business
location by default. ORAP owns versioned plan settings, quotas, feature entitlements,
site overrides, and budget controls. The $5 per-site AI budget and $50 platform-wide cap
remain independent hard spending limits; an available review cycle cannot bypass either
cap. No plan or override can weaken protected facts, tenant isolation, or infrastructure
safeguards. The 14-day nonpayment grace period remains.

All four plans may describe the shared core roadmap capability set, but a capability is
saleable or deployable only when its implementation goal, security validation,
dependencies, and production activation have passed. Contact forms are specifically
unavailable for sale until G13 implementation/security validation and G31 production
activation have passed.

The following are excluded from plan entitlements: competitor monitoring, reputation
management, Google Business Profile automation, social publishing, AI answer sampling,
conversion-optimization experiments, automated content expansion, payment automation,
and advanced transactional websites. D-022's sampled AI-mention work, if retained for
internal evaluation, is not a subscription benefit or customer promise.

#### R-011 current enforcement assessment

| Entitlement or rule                         | Current application evidence                                                      | Planning status                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| One subscription per website                | Database has a unique site subscription and tested assignment path                | Enforceable locally                                              |
| Binary plan features and per-site overrides | Versioned features, precedence, audit, and protected-rule rejection exist         | Enforceable locally for registered feature keys                  |
| Public site survives nonpayment             | Subscription-state policy is tested                                               | Enforceable locally                                              |
| Automatic 14-day grace default              | Past-due transitions calculate 14 days unless an authorized date is supplied      | Enforceable locally                                              |
| Four plan codes and proposed prices         | Exact versioned proposal records and integer-cent prices are seeded               | Configurable locally; no billing automation                      |
| Customer-seat limits                        | Invite creation and acceptance share a site lock and recheck active/pending seats | Enforceable locally                                              |
| Standard-page limits                        | Contract routes are counted and checked when assigning a plan                     | Enforceable at assignment; billable-page definition remains open |
| One included business location              | Address facts are counted and checked when assigning a plan                       | Enforceable at assignment; extra-location policy remains open    |
| Weekly/daily SEO audit cadence              | Exact plan intervals gate deterministic deduplicated scheduler admission          | Enforceable locally                                              |
| Monthly AI review-cycle quotas              | Every AI provider entry point atomically reserves/consumes or releases UTC usage  | Enforceable locally                                              |
| $5 site / $50 platform AI caps              | One transaction locks platform then site capacity; audited cap APIs exist         | Enforceable locally; paid production calls remain disabled       |
| Shared roadmap capabilities                 | Individual local/test goals vary; production is not activated                     | Gate capability-by-capability; never infer readiness from a plan |
| Reusable contact forms                      | G13 implementation and local security gates pass; capability remains `tested`     | Unavailable for sale until G30/G31 production gates pass         |

Setup fees, bespoke-development pricing, final commercial approval, the meaning of a
billable standard page and AI review cycle, rollover/overage behavior, and extra-location
policy remain owner/commercial inputs. These gaps do not block unrelated local goals.

### 3.3 Resolved tensions

- GitHub is authoritative for reviewed source code; PostgreSQL is authoritative for live editable content. Runtime content never creates an automatic production Git push loop.
- Human fact editing does not weaken the AI prohibition. It uses a distinct permissioned and audited path that is not exposed as an AI tool.
- The backup cadence is now explicit: daily encrypted backups, 7 daily plus 4 weekly copies, and a monthly isolated restoration test.
- A custom visual design is fully supported, but its editable surface and build/publish behavior must be declared through the integration contract.
- A one-monorepo rule does not imply a single runtime container or shared customer executable environment. Services and artifacts remain separated by trust boundary.
- The approved `Staff` role is the durable platform role below Platform Admin. Developer and operator/SEO-specialist duties are permission bundles assigned to Staff, not additional global roles that weaken D-006.
- The approved AI budget period is a UTC calendar month. Earlier master-plan references to a billing month/timezone are superseded by D-015 for V1 cost enforcement.

### 3.4 Owner decision gates

No further platform-architecture choice is open before local implementation continues. The remaining owner decisions are concrete production commitments and must be supplied only at their named gates:

- **Identity and authority:** R-001 and R-002 are supplied. GitHub environment approvers and production change authority remain under R-010; the single-owner break-glass arrangement must be revisited before staff access is introduced.
- **Vendors and financial commitments:** Resend, contact delivery, the four-tier structure/grace period, OpenAI ownership/caps, and Cloudflare R2 are selected or proposed. External account activation/spend, verified email identities/recipients, final commercial approval of plan prices, setup/bespoke fees, quota definitions, and overage policy remain (R-005, R-008, R-009, R-011, R-012).
- **Legal and data governance:** Texas is the initial jurisdiction; exact owner-approved privacy, consent, terms, incident-notification, deletion, and revision-retention policies remain (R-006).
- **External account access:** R-003 and R-004 are approved; Google project/redirect/property details and GitHub/VPS host/key configuration remain and must use approved secret channels (R-007, R-010).
- **Operational commitments:** R-013 is supplied; measured proof that production meets those targets remains a release requirement.
- **Launch authorization:** name and approve the real pilot only after the fictional rehearsal and all G30/G31 evidence pass.

These decisions do not block local work with fictional data or provider adapters. They do block the corresponding live integration, production activation, or customer launch, and Codex must not fill them with guessed domains, credentials, policies, providers, recipients, prices, budgets, or service promises.

## 4. Dependency map and execution rules

Goals are dependency-ordered, not merely phase-ordered. A goal may begin only when all listed dependencies are `complete`. Approved D-series decisions are mandatory constraints; unresolved R-series production inputs block only the named external or production step, not local implementation with fictional data. Production-facing activation is deliberately split from local implementation.

```text
G01 → G02 → G03
       └──→ G04 → G05 → G06 → G07 → G08
                  └──→ G09 → G10
                       └──→ G11 → G12 → G13 → G14 → G15 → G16
G03 + G08 ───────────────────────────────────────→ G17 → G18
G03 + G13 ───────────────────────────────────────→ G19
G04 + G06 ─→ G20 → G21 → G22
G20 + G13 ─→ G23 → G24
G21 + G24 + G11 ─→ G25 → G26
G06 + G22 ─→ G27
G08 + G16 + G22 + G24 + G26 + G27 ─→ G28
G12 + G19 + G22 ─→ G29
G19 + G21 + G26 + G28 + G29 ─→ G30
G16 + G18 + G19 + G29 + G30 ─→ G31 → G32
```

### Goal completion protocol

For every implementation goal, Codex must:

1. Mark only that goal `in progress`; do not opportunistically implement later goals.
2. Re-read its approved decision basis and remaining R-series owner inputs, then inspect current files before editing.
3. Use fictional tenant/site data and local or isolated test infrastructure.
4. Add or update tests, documentation, environment placeholders, observability, and rollback notes in the same change.
5. Run the stated validation plus repository-wide checks established by G02.
6. Report files changed, migrations, tests run, remaining risks, and the next unblocked goal.
7. Mark the goal `complete` only after its definition of done is met; otherwise leave it `in progress` or `blocked` with a reason.

### Validation command contract

G02 must create a root validation registry and the exact command `npm run verify:goal -- GNN`. From G02 onward, every goal must register its concrete format, lint, type, unit, integration, contract, E2E, security, infrastructure, or load commands under its goal ID. The registry must reject an unknown goal ID and must not use empty placeholder tests. The implementing agent runs both:

```powershell
npm run verify:goal -- GNN
npm run verify:all
```

The detailed cases listed under each goal's **Validation tests** are the minimum behaviors its `verify:goal` entry must exercise. Commands that require Docker, a provider sandbox, staging, or production authorization must be separated into named subcommands and report `blocked` rather than silently skip. G01 is the only exception because it precedes the toolchain: its document checks may be run with read-only PowerShell/`rg`, and G02 must subsequently register them as `G01`.

## 5. Development goals

### G01 — Architecture and decision baseline

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** None  
**Decision basis / remaining inputs:** Record approved D-001 through D-024 as ADRs. R-001 through R-013 remain external production inputs and must not be invented.

**Requirements**

- Translate the master plan into system context, trust boundaries, data/control flows, and developer/operations contracts.
- Distinguish confirmed product commitments from provisional defaults.
- Establish an ADR index and owner-review queue without making infrastructure changes.

**Prerequisites**

- `docs/masterplan.md` remains unchanged and is treated as the source of truth.
- D-001 through D-024 and the additional decisions in Section 3.1 are treated as approved; R-001 through R-013 remain explicit production placeholders.

**Expected files and components**

- `docs/architecture.md`
- `docs/security.md`
- `docs/operations.md`
- `docs/integration-contract.md`
- `docs/adr/README.md`
- `docs/adr/0001-*.md` through the minimum ADR set for source of truth, tenant isolation, auth/session domains, site contract, static publishing, deployment, AI policy, and media storage

**Implementation tasks**

1. Document component boundaries and failure isolation for control, serving, and worker planes.
2. Define data ownership and the code/content/media/artifact lifecycle.
3. Write a threat model and control checklist covering tenant access, auth, uploads, SSRF, AI input/output, deployment, and secrets.
4. Define local/staging/production environment names, without provisioning them.
5. Record each approved decision, alternatives considered, consequences, and its approved state without reopening it.
6. Cross-link requirements and acceptance scenarios to later roadmap goals.

**Database impact:** None.  
**Rollback:** Documentation-only; revert individual ADRs only by superseding them, preserving history.

**Validation tests**

- Verify every D-ID has an owner, disposition, and blocking targets.
- Verify all 18 final product invariants map to at least one architecture section and one goal.
- Run a Markdown link check and confirm no credential-like values or real customer data appear.

**Definition of done**

- Required planning documents exist, agree with the master plan, and contain no invented production facts.
- ADRs faithfully record the approved decisions, and unresolved production values are referenced only by their R-ID.
- No application, infrastructure, DNS, or deployment state has changed.

### G02 — Repository governance and TypeScript workspace baseline

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** G01  
**Decision basis / remaining inputs:** D-017. G02 may select and document a supported Node LTS and package naming convention; this is a reversible technical choice, not owner input.

**Requirements**

- Create the npm-workspaces skeleton and common TypeScript, lint, format, and test conventions.
- Make public-repository secret and data restrictions enforceable.
- Do not scaffold functional platform behavior yet.

**Prerequisites**

- Architecture package boundaries and repository naming are approved.

**Expected files and components**

- Root `package.json`, `package-lock.json`, `tsconfig.base.json`, formatter/linter configs
- `.gitignore`, `.editorconfig`, `.nvmrc` or equivalent pinned runtime file
- `.env.example` with documented placeholders only
- Empty documented workspace directories from the master plan
- `CODEOWNERS` or documented review ownership
- Root scripts: `format:check`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `verify:goal`, `verify:all`

**Implementation tasks**

1. Pin the Node/npm toolchain and enable strict TypeScript.
2. Define workspace naming, package exports, dependency direction, and import boundaries.
3. Configure formatting, linting, unit test discovery, and generated-file exclusions.
4. Add secret scanning configuration and forbidden fixture/path patterns.
5. Document public-repository rules and fictional-data requirements.
6. Implement the validation registry, initially registering G01 and G02 with concrete commands and machine-readable pass/fail output.
7. Ensure placeholder directories have purpose documentation without fake implementation.

**Database impact:** None.  
**Rollback:** Remove the workspace/config commit; no runtime state exists.

**Validation tests**

- `npm ci`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run verify:goal -- G01`
- `npm run verify:goal -- G02`
- `npm run verify:all`
- Secret scanner against the complete working tree and history introduced by this goal

**Definition of done**

- A clean clone installs reproducibly and every root check passes.
- The repository rejects obvious secrets and ignores local runtime data, uploads, artifacts, and backups.
- No app claims functionality beyond a documented placeholder.

### G03 — Branch CI and supply-chain safety baseline

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** G02  
**Decision basis / remaining inputs:** D-012 and D-017. Repository-admin action may be required to enable branch protection; production credentials remain deferred to R-010/G31.

**Requirements**

- Run safe checks on pull requests and all branches.
- Prove non-main branches have no production deployment path.
- Pin third-party actions and minimize token permissions.

**Prerequisites**

- Root validation scripts are stable.

**Expected files and components**

- `.github/workflows/ci.yml`
- `.github/dependabot.yml` or documented dependency-update mechanism
- Secret/dependency scanning workflow configuration
- `docs/operations.md` CI and branch-protection section

**Implementation tasks**

1. Add install, format, lint, typecheck, unit-test, and build jobs with dependency caching.
2. Pin actions by immutable commit and set least-privilege permissions.
3. Add secret scanning and dependency audit output with a triage policy.
4. Add a workflow-policy test asserting that branch/PR workflows contain no SSH or production environment reference.
5. Document required checks and CODEOWNERS approval for auth, infrastructure, AI policy, and deployments.

**Database impact:** None.  
**Rollback:** Disable/revert the CI workflow; no external runtime is touched.

**Validation tests**

- Validate workflow syntax locally with the selected workflow linter.
- Run the same root commands CI invokes.
- Push or simulate a test branch and confirm checks run while no deployment job is eligible.

**Definition of done**

- Pull requests receive deterministic checks and no branch workflow can deploy.
- Required GitHub settings are documented; settings that need owner action are clearly marked, not reported as complete prematurely.

### G04 — Local configuration, Postgres/Redis, database foundation, and API shell

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** G02  
**Decision basis / remaining inputs:** D-004, D-005, D-007, and D-023 are approved. No production input is required for local implementation.

**Requirements**

- Boot an isolated local control-plane foundation with validated configuration, Postgres 16, Redis, migrations, JSON logs, and health endpoints.
- Avoid production compose files, public database/Redis exposure, or collisions with existing services.

**Prerequisites**

- Local port allocation and environment conventions are documented.
- The initial entity ownership rules and RLS approach are approved.

**Expected files and components**

- `apps/api/`
- `packages/database/`
- `packages/shared/`
- `packages/observability/`
- `infrastructure/compose/dev.compose.yml`
- `tests/integration/health/`
- `.env.example` additions for local database/Redis/API configuration

**Implementation tasks**

1. Implement typed configuration parsing that fails closed and redacts secrets.
2. Create dev-only private Postgres/Redis services with health checks and named volumes.
3. Add Prisma initialization and the minimum core schema for users, tenants, sites, domains, memberships, audit events, and schema metadata.
4. Add migration and fictional seed commands; no real customer identifiers.
5. Implement API liveness and dependency-aware readiness endpoints.
6. Add structured logging with trace IDs and a redaction test.
7. Document startup, teardown, volume handling, and safe local reset.

**Database impact**

- First reversible development migration.
- No content, billing, jobs, or integration tables beyond what the shell requires.

**Rollback:** Stop the dev compose project and remove only its explicitly named local volumes after resolving and verifying their paths/names.

**Validation tests**

- `docker compose -f infrastructure/compose/dev.compose.yml config`
- `docker compose -f infrastructure/compose/dev.compose.yml up -d --wait`
- Run migrations twice to prove idempotent startup behavior.
- Run integration tests for liveness, readiness degradation, schema constraints, and log redaction.
- Confirm Postgres and Redis are not bound to public interfaces.

**Definition of done**

- A clean local environment starts, migrates, seeds fictional records, reports honest health, and shuts down safely.
- No production compose, Caddy, shared network, or existing service has been read or modified.

### G05 — Identity, credentials, sessions, password recovery, and platform MFA

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G04  
**Decision basis / remaining inputs:** D-002, D-003, and D-006 are approved. R-002 is required only for production bootstrap.

**Requirements**

- Implement secure centralized identities with site-scoped host-only sessions.
- Require authenticator-app MFA for every ORAP role (Platform Owner, Platform Admin, and Staff) and support secure reset/revocation flows.
- Never expose stored passwords or recovery tokens.

**Prerequisites**

- Approved role/action matrix, session architecture, bootstrap, MFA, and recovery design.

**Expected files and components**

- `packages/auth/`
- Auth routes/services in `apps/api/`
- Auth migrations under `packages/database/`
- `tests/integration/auth/` and security fixtures
- Security and operations documentation updates

**Implementation tasks**

1. Implement normalized identity uniqueness, Argon2id parameters, password policy, and safe timing behavior.
2. Add rotating hashed sessions, host-only cookie configuration, expiry, revocation, and device/session listing.
3. Add rate-limited login and recovery with non-enumerating responses and one-time hashed tokens.
4. Add authenticator-app MFA enrollment, challenge, recovery codes, and enforcement for all ORAP staff roles.
5. Implement one-time owner bootstrap without a committed/default credential.
6. Define the fixed role identifiers Platform Owner, Platform Admin, Staff, Customer Owner, Customer Editor, and Customer Viewer, with deny-by-default action grants rather than role-name shortcuts in business services.
7. Audit sign-in, failure threshold, reset, MFA, bootstrap, and revocation events without logging secrets.

**Database impact**

- Add credentials, sessions, recovery tokens, MFA factors/recovery material, and auth audit metadata.
- Store secrets encrypted or irreversibly hashed as appropriate.

**Rollback:** Disable new login entry points, revoke sessions, and roll back only before real accounts exist; later schema rollback requires a data-preservation migration.

**Validation tests**

- Unit tests for hashing, token expiry, cookie flags, and permission predicates.
- Integration tests for login, logout, global/site revocation, reset reuse, lock/rate limits, and mandatory admin MFA.
- Security tests for user enumeration, session fixation, CSRF, open redirect, and cookie leakage across unrelated hosts.

**Definition of done**

- Privileged login requires configured MFA; recovery and revocation are audited and tested.
- No session cookie is shared across unrelated customer domains, and no secret appears in responses or logs.

### G06 — Tenant isolation, verified host resolution, authorization, and RLS

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G04, G05  
**Decision basis / remaining inputs:** D-004 and D-006 are approved. No production input is required for isolated tests.

**Requirements**

- Enforce tenant/site isolation in API services, relational constraints, worker context, and PostgreSQL defense-in-depth.
- Resolve customer context from an exact verified host mapping.

**Prerequisites**

- RLS connection-context approach and permission matrix are approved.

**Expected files and components**

- `packages/tenant/`
- RLS policies and tenant constraints in `packages/database/`
- API request context/authorization middleware
- `tests/security/tenant-isolation/`

**Implementation tasks**

1. Normalize hostnames, IDNs, ports, canonical aliases, and explicit admin-host mappings.
2. Require active verified domain plus active membership for customer context.
3. Implement deny-by-default authorization helpers for platform, tenant, and site actions.
4. Apply composite keys/constraints and RLS policies to all current site-scoped tables.
5. Define controlled worker/service roles and prohibit ambient superuser access.
6. Create a reusable cross-tenant adversarial test harness for future tables and endpoints.

**Database impact**

- Add normalized unique host columns, verification state, composite foreign keys, policies, and restricted application roles.

**Rollback:** Disable affected endpoints and revert policies only in local/test before data use; never remove RLS in production as a quick fix.

**Validation tests**

- Site A versus Site B read/write/delete tests at API and direct database-policy layers.
- Host-header spoofing, unknown host, Unicode/punycode, inactive domain, sister-site membership, and worker payload tests.
- Connection-pool reuse test proving tenant context cannot leak between requests.

**Definition of done**

- Acceptance scenario A passes for every existing site-scoped resource.
- Unknown or ambiguous hosts fail closed without revealing another tenant's existence.

### G07 — ORAP tenant, site, user, and audit administration slice

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G06  
**Decision basis / remaining inputs:** D-002 and D-006 are approved. Use local fixture hosts; R-001 and R-002 apply only to production.

**Requirements**

- Provide the first usable staff-only ORAP vertical slice for tenant/site creation and customer account membership management.
- All sensitive changes require authorization, validation, and audit records.

**Prerequisites**

- A local privileged account can be bootstrapped securely.

**Expected files and components**

- `apps/orap/`
- ORAP routes/services in `apps/api/`
- `packages/ui/` only for genuinely shared accessible primitives
- E2E fixtures and `tests/e2e/orap-admin.spec.*`

**Implementation tasks**

1. Build staff login/challenge and accessible ORAP shell.
2. Add tenant/site list, create, view, disable, and status flows using fictional data.
3. Add customer user creation/invitation, site membership, role change, reset initiation, disable, and session revocation.
4. Require reason/confirmation for high-risk changes and create audit events transactionally.
5. Prevent display of hashes, tokens, credential values, or cross-site data.

**Database impact:** Use current identity/tenant tables; add invitation lifecycle only if approved by the auth ADR.  
**Rollback:** Disable ORAP mutations behind a platform switch; preserve audit records and created identities.

**Validation tests**

- API integration tests for every role and denial path.
- E2E: privileged staff creates a fictional tenant/site and a site-scoped customer user, then disables access.
- Accessibility smoke test for forms, errors, keyboard flow, and focus management.

**Definition of done**

- Authorized staff can manage fictional tenants/sites/users end to end; unauthorized staff cannot.
- Every state change has actor, reason, target, before/after metadata, and trace ID.

### G08 — Plans, entitlements, site overrides, emergency controls, and manual subscription state

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G07  
**Decision basis / remaining inputs:** D-005 and D-006 are approved, including keeping public sites online during nonpayment. R-011 replaces the former three-tier assumption with four versioned plan proposals and retains a 14-day grace period. Commercial prices are selected proposals pending final approval. Standard-page/cycle commercial definitions, rollover/overage behavior, extra-location policy, setup fees, and bespoke pricing remain before customer launch; the technical quota and cadence boundaries are implemented.

**Requirements**

- Represent editable plan defaults and per-site overrides using the required policy precedence.
- Enforce one subscription record per website while allowing one tenant to own multiple independently subscribed websites.
- Add site emergency switches without allowing any override of protected-fact invariants.
- Keep payment processing behind an unused adapter boundary.
- Represent STARTER, GROWTH, PRO, and ELITE as versioned plan data with proposed price,
  customer seats, included standard pages, included business locations, SEO audit cadence,
  and monthly AI content-review cycles.
- Treat shared features as capability references with readiness state; plan inclusion must
  never imply that unfinished or inactive production capability is available for sale.

**Prerequisites**

- Entitlement ownership/cardinality, the four proposed plan definitions, and initial
  feature keys are approved for architecture planning. Commercial approval and precise
  quota-unit/overage definitions may remain external inputs.

**Expected files and components**

- Policy/entitlement module in `packages/tenant/` or a dedicated package justified by ADR
- Plan, numeric entitlement/quota, subscription, feature, override, usage counter, and
  policy-version migrations
- ORAP plan/site-control screens and API routes
- Policy matrix tests

**Implementation tasks**

1. Implement deterministic precedence: nonoverrideable rules, kill switches, site overrides, plan defaults, customer field preference, safe defaults.
2. Add versioned feature definitions rather than code-only magic strings.
3. Add one manual subscription per website with explicit, configurable operational effects and a uniqueness constraint on the site relationship.
4. Implement nonpayment state so public serving continues while new automation/editing can be suspended only after the configured grace period.
5. Add site editing freeze, autonomous-change stop, and automation stop controls.
6. Audit override reason, actor, effective time, policy version, and queued-job cancellation intent.
7. Add the four proposed plan versions without activating billing or presenting prices as
   final. Store currency and amounts as exact data, not floating-point values.
8. Enforce seat, standard-page, location, audit-cadence, and AI-cycle entitlements at the
   authoritative mutation/job-admission boundary, including concurrency-safe counters.
9. Calculate the default 14-day grace end deterministically when a subscription becomes
   past due, while retaining an audited authorized override.
10. Separate AI review-cycle availability from the $5 site and $50 platform hard spending
    ledgers; admission requires capacity in every applicable control.
11. Add per-capability readiness so contact forms and any other incomplete capability
    cannot be sold/enabled merely because a plan references it.
12. Reject the R-011 excluded expansion features from plan definitions and ORAP overrides.

**Database impact:** Extend plans with exact proposed-price metadata and versioned numeric
entitlements/cadences; add quota usage/reservation data where needed. Preserve existing
subscriptions, overrides, emergency state, and immutable policy audit history.  
**Rollback:** Revert effective policy to prior version; never delete history or protected system rules.

**Validation tests**

- Exhaustive precedence table tests, including conflicting flags and disabled subscriptions.
- Multi-site tenant tests proving each website has an independent subscription, entitlements, grace-period state, and AI budget.
- Cross-tenant mutation tests and queued-work recheck fixtures.
- E2E: ORAP disables site autonomy while public serving remains healthy.
- Boundary/concurrency tests for every numeric quota, including invitation races, page
  classification, schedule admission, AI-cycle reservation/release, and site overrides.
- Plan fixtures prove the exact four proposed definitions and demonstrate that changing
  one version does not rewrite existing subscription history.
- Tests prove an available AI cycle cannot bypass either spending cap and no plan/override
  can grant protected-fact access or weaker infrastructure safeguards.
- Readiness tests prove contact forms and all excluded expansion features are unavailable
  for sale/enabling.

**Definition of done**

- Effective policy is explainable, versioned, and consistent in API and UI.
- No plan or owner override can grant AI access to protected facts.
- The four plan proposals are configurable in ORAP, every enforceable quota has a tested
  server-side admission boundary, and unfinished capabilities are visibly unavailable.
- Prices remain labeled proposed until final commercial approval; no billing or paid
  service is activated.

### G09 — Versioned site integration contract

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G02, G06  
**Decision basis / remaining inputs:** D-007, D-008, D-017, and D-020 are approved.

**Requirements**

- Define a typed, runtime-validated contract for routes, components, fields, protected fact references, build output, preview, and health checks.
- Permit completely custom visual designs and developer-authored frontend structure while standardizing only the management, content, security, build, contact-form, and publication interfaces.
- Reject arbitrary production write endpoints and secrets in manifests.

**Prerequisites**

- Content identity/versioning and protected-placeholder approach are decided.

**Expected files and components**

- `packages/contracts/`
- `docs/integration-contract.md` updates
- Contract JSON Schema/type exports and compatibility tests
- Valid/invalid manifest fixtures under `tests/contracts/`

**Implementation tasks**

1. Define contract versioning, stable IDs, allowed field/component types, routes, locales, build, preview, bounded contact-form declarations, and validation hooks.
2. Validate uniqueness, path containment, URL schemes, facts references, edit permissions, and AI modes.
3. Add backward-compatibility and explicit migration behavior.
4. Provide a command that validates one or all site manifests without executing arbitrary site code.
5. Document how a fully custom design complies without inheriting the starter site's appearance or layout.
6. Document that complex applications, commerce, reservations, arbitrary server code, and custom databases require separately approved adapters and security review.

**Database impact:** Add contract version/hash and source package path to site metadata if not already present.  
**Rollback:** Retain support for the prior contract version until all registered sites migrate.

**Validation tests**

- Valid manifest serialization/type tests.
- Invalid duplicate field IDs, traversal paths, hardcoded secrets, missing fact refs, unsupported schemes, and unsafe commands must fail.
- Two materially different frontend designs must satisfy the same contract without sharing layout components.
- Compatibility fixture for the oldest supported version.

**Definition of done**

- A developer can validate a manifest locally and receive stable actionable errors.
- Contract validation is deterministic and makes no network or production changes.

### G10 — Fictional Astro starter site and contract fixture

**Status:** `complete`
**Priority:** P1  
**Dependencies:** G09  
**Decision basis / remaining inputs:** D-020 requires a fully custom-design fixture that complies with the approved contract; no production input is required.

**Requirements**

- Provide a fictional, accessible static restaurant reference site that demonstrates the complete V1 contract surface.
- Demonstrate that the starter is guidance rather than a mandatory visual template by including a materially different custom-design fixture.
- Do not imply the example content belongs to a real business.

**Prerequisites**

- Contract validator and workspace build conventions are stable.

**Expected files and components**

- `sites/_starter/`
- `sites/restaurant-example/`
- A second lightweight custom-design contract fixture with distinct structure and styling
- Contract fixtures, static assets safe for a public repository, and site contract tests

**Implementation tasks**

1. Build homepage, about, menu, contact form, privacy, sitemap, robots, and structured-data examples.
2. Include text, rich text, image, button/link, cards/list, metadata, theme, visibility, reorderable section, and protected fact examples.
3. Mark all business details as fictional in visible content and metadata.
4. Add responsive, semantic, keyboard-accessible layouts with no unnecessary client runtime.
5. Add a visibly and structurally distinct custom-design fixture that uses the same management contract without copying the starter layout.
6. Add contract, build, link, HTML, structured-data, contact-form schema, accessibility, and snapshot checks.

**Database impact:** None; fixtures remain static until G11 seed integration.  
**Rollback:** Remove the example workspace without affecting platform packages.

**Validation tests**

- Validate both manifests with the G09 validator.
- Build both sites from a clean install.
- Run automated accessibility, broken-link, sitemap/robots, and structured-data checks.
- Validate the fictional contact form's fields, consent metadata, destination reference, and failure state without sending email.
- Verify generated output contains no real domains, credentials, or customer data.

**Definition of done**

- The starter is a reproducible reference implementation and contract test fixture, not a one-off mockup.

### G11 — Content, protected facts, drafts, revisions, and proposals data services

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G06, G09  
**Decision basis / remaining inputs:** D-007, D-008, and D-023 are approved. Site-specific revision retention is configured conservatively until R-006 supplies customer/legal policy.

**Requirements**

- Store structured content, verified facts, drafts, immutable revisions, and proposal lifecycle with optimistic concurrency.
- Separate human fact editing from all AI proposal paths.

**Prerequisites**

- Field schema and retention defaults are documented.

**Expected files and components**

- `packages/content/`
- Content/fact/revision/proposal migrations
- Content API services without customer UI
- `tests/integration/content/`

**Implementation tasks**

1. Add pages, sections, stable fields, business facts, drafts, revisions, and proposal state machines.
2. Implement compare-and-swap updates using revision/ETag values.
3. Add rich-text sanitization, link validation, Unicode preservation, and schema-version checks.
4. Implement deterministic protected-token extraction/comparison and whole-field fallback.
5. Create a separate fact edit/verification workflow limited to authorized Customer Owners and ORAP staff, with provenance and audit; Customer Editors/Viewers cannot receive this permission.
6. Ensure restoration creates a new revision rather than rewriting history.

**Database impact:** Add content tables, immutable revision records, verified fact provenance, proposal states, indexes, tenant constraints, and RLS.  
**Rollback:** Disable writes and retain data; schema removal is allowed only before persistent data exists.

**Validation tests**

- Revision conflict, stale proposal, invalid transition, sanitization, and fact-preservation unit/integration tests.
- Role tests prove only authorized Customer Owners and ORAP staff can use the manual fact workflow; Customer Editors/Viewers and every AI/service proposal path are denied.
- Cross-tenant content and reference attacks.
- Restore-old-version test proving a new revision is created.

**Definition of done**

- Services can create, draft, validate, revise, and restore fictional content without UI.
- Protected values cannot enter an AI-editable mutation path.

### G12 — Site-isolated asset storage and media validation

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G06, G11  
**Decision basis / remaining inputs:** D-011, D-016, D-017, and D-023 are approved. R-005 is required only for the production off-server adapter.

**Requirements**

- Provide an object-storage abstraction and safe V1 adapter for original media.
- Prevent cross-site references, dangerous uploads, premature deletion, and public-repo leakage.

**Prerequisites**

- Storage adapter, quarantine, URL, retention, and backup design are approved.

**Expected files and components**

- Asset module under `packages/content/` or `packages/assets/` if justified
- Local development storage adapter and non-committed data directory
- Asset migrations and API endpoints
- Upload/security test corpus with harmless synthetic fixtures

**Implementation tasks**

1. Stream uploads with byte limits; inspect MIME and file signatures; decode image dimensions safely.
2. Define SVG policy, filename normalization, checksums, duplicate handling, quarantine, attribution, and alt text.
3. Store opaque site-isolated keys and derive URLs server-side.
4. Track draft/live artifact references and use delayed garbage collection.
5. Add download authorization for originals and immutable public derivative behavior.
6. Add storage metrics and quota/error reporting.

**Database impact:** Add assets, variants, integrity state, ownership, references, and retention markers with RLS.  
**Rollback:** Disable uploads and preserve stored objects/metadata; garbage collection remains off until recovery is proven.

**Validation tests**

- Valid image upload/render tests.
- Polyglot, oversized, decompression/dimension bomb, executable/SVG, traversal, duplicate, and cross-tenant reference tests.
- Deleting a draft reference must not remove media used by a published artifact.

**Definition of done**

- Safe fictional media can be uploaded and referenced by one site only; malicious fixtures fail safely.
- Local asset data and originals cannot be committed accidentally.

### G13 — Reproducible snapshot renderer, preview, artifact manifest, and static server

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G10, G11, G12  
**Decision basis / remaining inputs:** D-009, D-010, and D-020 are approved. R-009 makes contact forms optional reusable components backed by one centralized service. It selects Resend sender `forms@updates.omnireach.cloud`, verified per-site recipients, 30-day retention except legal/security holds, Cloudflare Turnstile, honeypots, rate limits, and optional confirmation email disabled by default. Concrete verified recipients, provider/DNS setup, credentials, explicit activation, and owner-approved consent wording remain production gates, not local implementation gaps.

**Requirements**

- Build one site from an immutable code SHA, content revision, and asset manifest hash.
- Serve versioned static artifacts without requiring API/Redis/OpenAI availability.
- Provide authenticated, isolated previews.
- Provide a bounded centralized contact-form submission service whose failure cannot take
  the static site offline; no site receives its own form backend.
- Treat forms as optional reusable components that ORAP administrators enable or disable
  per website. Authorized customers may configure supported fields and view only their
  own site's submissions.

**Prerequisites**

- Artifact layout/switching and preview threat model are approved.

**Expected files and components**

- `workers/publisher/`
- Artifact/snapshot module in `packages/content/` or a dedicated package
- Static artifact server configuration/module
- Reusable contact-form schema/component, per-site enablement and supported-field policy,
  centralized submission endpoint, Turnstile adapter, honeypot/rate controls, customer
  submission views, and delivery adapter with local/mock implementation
- Artifact manifest schema and integration fixtures

**Implementation tasks**

1. Materialize a read-only content/assets snapshot transactionally.
2. Build an affected site in a resource-limited temporary workspace with no production secrets.
3. Emit manifest containing code SHA, contract version, content revision, asset hash, build tool versions, routes, checksums, and health expectations.
4. Validate output for traversal, missing assets, HTML safety, links, metadata, and health.
5. Implement immutable serving and atomic active-version pointer locally.
6. Implement expiring authenticated no-index preview with CSP/sandbox boundaries.
7. Implement contract-declared contact submissions with origin/site resolution, per-site
   enabled state, supported field schemas, CSRF/origin controls as applicable, validation,
   Turnstile verification, rate limiting, honeypot/abuse hooks, 30-day retention with
   legal/security holds, audited delivery state, and no attachments by default.
8. Add ORAP per-site enable/disable controls and permissioned customer field configuration
   and tenant-scoped submission views.
9. Keep submission, spam protection, notification, and retention centralized. Keep
   delivery behind an adapter; local tests use a sink/mock and no real provider/recipient.
10. Make submitter confirmation email optional and disabled by default.

**Database impact:** Add artifact/build records, immutable snapshot references, and minimal site-scoped contact-submission/delivery metadata subject to retention policy; no deployment activation yet.  
**Rollback:** Switch the local active pointer to the prior verified artifact; never mutate an existing artifact.

**Validation tests**

- Rebuild identical inputs twice and compare manifests/content hashes, allowing only documented nondeterminism.
- Kill API/Redis during static-serving smoke test; public pages remain available.
- Failed build leaves prior artifact active.
- Unauthorized/expired preview access fails; preview is not indexable.
- Contact-form tests cover disabled sites, unsupported fields, invalid origin/site,
  missing/invalid/replayed Turnstile evidence, honeypots, rate limits, sensitive log
  redaction, cross-tenant reads/delivery, retention holds/deletion, optional confirmations,
  provider failure, and static-page availability while the submission API is down.
- Role tests prove only ORAP administrators toggle forms and authorized customers can
  configure supported fields and read submissions for their own sites.

**Definition of done**

- The fictional and custom-design sites can be previewed and atomically published locally with exact reproducibility metadata.
- The optional fictional contact form submits through the centralized mock adapter safely;
  per-site enablement, customer field configuration/submission visibility, anti-spam, and
  retention policies pass, and contact-service failure never prevents static pages from loading.

### G14 — Customer admin host resolution, authentication, and dashboard shell

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G06, G08, G13  
**Decision basis / remaining inputs:** D-003 and D-006 are approved.

**Requirements**

- Provide the shared customer-admin application selected by verified admin hostname.
- Show honest site/publication/feature status without exposing other sites.

**Prerequisites**

- Host/session behavior is approved; two fictional sites and users exist.

**Expected files and components**

- `apps/customer-admin/`
- Customer dashboard API routes
- Host/session middleware integration
- `tests/e2e/customer-login.spec.*`

**Implementation tasks**

1. Build accessible login/MFA-ready flow and dashboard navigation.
2. Resolve site only from verified server-side host context, then verify membership.
3. Display publication health, effective features, missing integrations, and editor/history links.
4. Use explicit not-connected/unavailable/loading/error states; no fabricated metrics.
5. Add CSP, CSRF, clickjacking, rate-limit, and safe redirect controls.

**Database impact:** None beyond session/audit updates.  
**Rollback:** Disable customer-admin routing while public artifacts remain live.

**Validation tests**

- Two-host/two-user E2E isolation matrix.
- Host spoofing, sister-site membership, cookie-domain, redirect, CSRF, and cached-response leakage tests.
- Customer-admin/API outage test proving public site remains healthy.

**Definition of done**

- Each fictional admin hostname shows only its authorized site and honest status.

### G15 — Structured customer editor, drafts, preview, and media workflow

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G12, G14  
**Decision basis / remaining inputs:** D-006, D-007, and D-010 are approved.

**Requirements**

- Render forms from the site contract for permitted fields/sections only.
- Support drafts, conflict-safe saves, validation, preview, and media without raw code editing.
- Allow Customer Owners to publish and Customer Editors to publish only when an explicit site-scoped grant permits it; Customer Viewers remain read-only.

**Prerequisites**

- Publish permission and review-required behavior are set per role/site.

**Expected files and components**

- Editor routes/components in `apps/customer-admin/`
- Draft/preview API routes and field-renderer components
- E2E editor fixtures

**Implementation tasks**

1. Implement supported text, rich text, image, link/button, cards/list, selected theme, visibility, and known-section reorder controls.
2. Hide/disable fields based on contract, role, effective policy, and protection state.
3. Save drafts using expected revisions and show resolvable conflicts.
4. Integrate safe upload selection, alt text, and reference tracking.
5. Generate isolated preview from a draft snapshot and visibly distinguish draft from live.
6. Add accessible errors, keyboard ordering controls, responsive preview modes, and timezone/Unicode tests.

**Database impact:** Draft updates and asset references only; no live pointer changes.  
**Rollback:** Disable editor writes and retain drafts/revisions/assets.

**Validation tests**

- E2E edit all supported field types and preview without publishing.
- Simultaneous edit conflict, stale ETag, forbidden field, invalid link/rich text, and protected field tests.
- Confirm no raw HTML/JS/code or arbitrary form destination can be edited.

**Definition of done**

- An authorized fictional customer can safely edit and preview only the contract-exposed surface.

### G16 — Content publication, revision history, restoration, and failure rollback

**Status:** `complete`
**Priority:** P0  
**Dependencies:** G13, G15  
**Decision basis / remaining inputs:** D-006 and D-009 are approved.

**Requirements**

- Publish an authorized draft through validation, build, health check, and atomic switch.
- Preserve the prior healthy version on every failure and support restoration as a new revision.
- Enforce the approved role model at both request and execution time: Customer Owners may publish, Customer Editors require an explicit grant, and Customer Viewers cannot publish.

**Prerequisites**

- Publisher locking/idempotency and publish/request-review permissions are approved.

**Expected files and components**

- Publication orchestration in `packages/content/` and `workers/publisher/`
- Customer history/restore UI and API
- Deployment/artifact event records used for content publication
- Publish E2E suite

**Implementation tasks**

1. Add idempotent publish request and one-publish-per-site lock.
2. Revalidate authorization, contract, current revision, facts, links, media, output, and site state at publish time.
3. Build/stage/health-check before transactional live-pointer change.
4. Record actor, origin, reason, input versions, validation, artifact, timing, outcome, and rollback pointer.
5. Implement history diff and permissioned restore that creates a new revision/build.
6. Preserve draft and raise an internal failure event when publication fails.

**Database impact:** Add publication requests/events and active artifact pointer with concurrency constraints.  
**Rollback:** Atomically reactivate prior verified artifact; database correction is a new event, never history deletion.

**Validation tests**

- Acceptance scenario B using text and image.
- Failure injection for build, validation, health check, crash/retry, and duplicate request.
- Restore prior revision and verify exact artifact/version trail.
- Public site continuity during all failure cases.

**Definition of done**

- Authorized local publication updates the fictional public site, and every failed attempt leaves the old site live and produces actionable state.

### G17 — Domain and Cloudflare adapter with verified onboarding state machine

**Status:** `complete`  
**Priority:** P1  
**Dependencies:** G08, G14  
**Decision basis / remaining inputs:** D-001 and D-014 are approved, and R-001/R-004 are complete. Live provider calls still require later token provisioning through an approved secret channel and separate authorization for each DNS mutation.

**Requirements**

- Model domain onboarding and implement a least-privilege Cloudflare DNS adapter without assuming registrar automation.
- Make all external mutations explicit, idempotent, auditable, and dry-runnable.

**Prerequisites**

- Owner supplies test zone strategy and scoped credential process; no production token is stored in source.

**Expected files and components**

- `packages/integrations/cloudflare/`
- Domain state-machine migrations and ORAP domain screens
- Mock provider and optional approved sandbox tests
- `docs/operations.md` onboarding checklist

**Implementation tasks**

1. Define requested, awaiting ownership, DNS pending, verified, TLS pending, active, failed, and disabled states.
2. Normalize public/admin/canonical/redirect mappings and prevent hostname takeover.
3. Implement scoped DNS read/plan/apply/status adapter with idempotency and audit events.
4. Handle TTL/propagation/certificate uncertainty without premature success.
5. Keep purchase, renewal, transfer, and deletion as manual audited checklists.
6. Add credential-reference metadata only; secrets remain in approved stores.

**Database impact:** Extend domains with provider reference, verification evidence/time, state, retry metadata, and audit links.  
**Rollback:** Disable mapping and restore prior DNS record through an explicit reviewed plan; never delete a domain automatically.

**Validation tests**

- Provider contract tests with recorded synthetic responses.
- Duplicate request, partial propagation, wrong zone, revoked token, takeover attempt, IDN, and conflicting host tests.
- Dry-run emits an exact proposed change set and makes zero provider mutations.

**Definition of done**

- Two fictional domains can progress through the state machine using mocks or an approved sandbox; production DNS remains untouched.

### G18 — Isolated Caddy routing integration and non-regression plan

**Status:** `complete`  
**Priority:** P1  
**Dependencies:** G13, G14, G17  
**Decision basis / remaining inputs:** D-001 and D-013 are approved, and R-001/R-003/R-004 are complete. The production hostnames are `omnireach.cloud` and `admin.omnireach.cloud`; applying DNS or routes remains separately authorized G31 work.

**Requirements**

- Generate minimal isolated public/admin host routes that cannot replace the shared Caddy project or existing routes.
- Prove configuration validity and rollback before any production reload.

**Prerequisites**

- Separately authorized read-only production inventory is complete and sanitized.
- Exact shared-network and config-import boundaries are known.

**Expected files and components**

- `infrastructure/caddy/` route templates, validation tools, and README
- Routing manifest generator from verified domain records
- Non-regression fixtures representing existing route shapes without secrets
- Production change and rollback checklist, not an executed change

**Implementation tasks**

1. Document current proxy ownership, networks, ports, imports, validation/reload/rollback commands from read-only evidence.
2. Generate host-exact routes to static artifacts and shared customer admin.
3. Reject duplicate, wildcard, unverified, ambiguous, or unsafe upstream mappings.
4. Validate in an isolated Caddy container with public/admin/unknown hosts.
5. Define atomic config staging, pre-reload validation, health checks, and prior-config restore.
6. Add a mandatory human checkpoint for any shared production reload.

**Database impact:** Read verified routing records only; optionally store generated config version/hash, not live activation.  
**Rollback:** Restore the prior validated Caddy config and reload only under the approved runbook.

**Validation tests**

- `caddy validate` in the pinned isolated image.
- Route tests for two public/admin domain pairs, canonical redirects, unknown hosts, TLS-pending state, and collision rejection.
- Regression fixture confirms existing route blocks are byte-preserved or semantically unchanged.

**Definition of done**

- A reviewable route fragment and production runbook exist and pass isolated tests.
- Shared Caddy and Christians Reunite have not been changed by this goal.

### G19 — GitHub Actions/SSH deployment foundation (no production activation)

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** G03, G13  
**Decision basis / remaining inputs:** D-012, D-013, and D-017 are approved. G19 builds the foundation without a production deployment. R-003 is complete. R-010 names `OmniReach-Websites/SEO-Automation`, the human owner as production approver/deploy-key custodian, and `omnireach-deploy` as the restricted non-root account. Host-key/environment evidence, scoped account permissions, emergency-recovery proof, and mutation authorization remain for G31.

**Requirements**

- Implement and test the reusable GitHub Actions/SSH release foundation without connecting it to the production VPS or enabling a production push trigger.
- Build and test verified commits in GitHub Actions, transfer immutable checksummed artifacts, and provide serialized stage/verify/switch/health/rollback scripts for a scoped non-root deploy identity.
- Preserve the rule that only `main` may invoke the eventual production workflow; branches remain CI-only.
- Design the target account without unrestricted sudo or Docker-daemon access.

**Prerequisites**

- G13 artifact manifests are stable.
- Local or isolated SSH/deployment target is available; no production access is required.

**Expected files and components**

- Reusable `.github/workflows/deploy-artifact.yml` and a non-production harness workflow
- `infrastructure/deploy/` scripts with dry-run/local test mode
- Production compose/config templates that are inert until G31 and isolated from development/existing project names
- Deployment schema/API/ORAP history view
- Release/rollback operations documentation

**Implementation tasks**

1. Add a reusable workflow that accepts only an immutable commit/artifact identity and cannot be invoked by untrusted branch code with production credentials.
2. Pin actions, minimize permissions, define GitHub environment/approval boundaries, verify SSH host keys, and document secret setup without values.
3. Build/test the exact commit in Actions, emit a checksummed manifest, and transfer rather than rebuild the artifact on the target.
4. Implement target scripts for release lock, checksum verification, versioned staging, migration compatibility preflight, health checks, atomic switch, and rollback.
5. Test automatic prior-pointer restoration on unhealthy activation and persist a safe deployment event.
6. Ensure no target checkout is edited/pushed and no runtime content can trigger recursive CI.
7. Build an isolated SSH target harness that exercises success, failure, concurrency, and rollback without any production hostname, key, or secret.
8. Document the exact G31 steps that will bind the reusable workflow to protected `main` pushes and production inputs R-003/R-010.
9. Document that root/password SSH hardening occurs only after the non-root deployment
   path and emergency recovery are proven under a separately authorized change.

**Database impact:** Add deployment/release event schema and migration compatibility metadata in local/test; destructive migrations are forbidden.  
**Rollback:** Revert the inert workflow/scripts or restore the isolated target's prior pointer. No production rollback is possible or needed because G19 performs no production activation.

**Validation tests**

- Workflow policy test: a test branch cannot obtain a production environment or production SSH secret, and no workflow is yet wired to a production host.
- Local/isolated SSH release harness: good release, bad checksum, failed migration gate, failed health check, concurrent invocation, rollback, and host-key mismatch.
- Confirm release records exact SHA, actor, artifact hash, timestamps, outcome, and logs without secrets.

**Definition of done**

- The reusable pipeline and deploy scripts are proven against an isolated target and remain inert for production.
- No production environment, host, key, secret, Caddy configuration, or existing service was read or changed.

### G20 — Durable queue, job registry, idempotency, and worker runtime

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** G04, G06  
**Decision basis / remaining inputs:** D-023 supplies the default job retention policy.

**Requirements**

- Provide typed tenant-scoped BullMQ jobs with retries, leases, cancellation, dedupe, traceability, and bounded concurrency.
- Keep credentials and large private payloads out of Redis.

**Prerequisites**

- Worker database roles and queue retention defaults are documented.

**Expected files and components**

- `packages/queue/`
- `workers/runner/`
- Job/job-run migrations and registry
- Queue integration/failure-injection tests

**Implementation tasks**

1. Define versioned schemas for all named job categories using opaque record IDs.
2. Implement enqueue dedupe/idempotency, trace ID, expiry, attempt limit, backoff/jitter, timeout, and error classification.
3. Rehydrate tenant/site/policy server-side and recheck status/authorization at execution.
4. Implement per-type and per-site concurrency, one-publish lock integration, graceful drain, stalled recovery, and dead-letter state.
5. Persist queued/running/succeeded/failed/skipped/cancelled status and safe error summaries.
6. Apply the approved 90-day default to detailed job records while preserving longer-lived audit references and disabling destructive pruning when site/legal holds apply.
7. Add Redis authentication/TLS boundary configuration as environment-dependent options.

**Database impact:** Add jobs, job runs, dedupe keys, policy/version references, timing, state, and error categories with RLS.  
**Rollback:** Stop/drain workers; disable enqueue; preserve job history; requeue only through permissioned tooling.

**Validation tests**

- Duplicate enqueue, crash-after-side-effect, stalled lease, retry, cancellation, expiry, shutdown, and permanent-failure tests.
- Cross-site payload tampering and disabled-site execution tests.
- Job-retention tests at the 90-day boundary, including legal/site hold and retained audit-reference behavior.
- Assert Redis payloads contain no secret or bulk content fields.

**Definition of done**

- Typed synthetic jobs execute once in effect, recover predictably, and expose a complete trace without crossing tenants.

### G21 — AI usage ledger, atomic reservations, and site/platform budget policy

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** G08, G20  
**Decision basis / remaining inputs:** D-005 and D-015 are approved: one budget per subscribed website, UTC calendar month, hard cap, and audited ORAP override. R-012 requires one atomic internal ledger to enforce the $5 site and $50 platform-wide caps together. Local verification now covers both caps and audited owner/admin controls. Paid production calls stay disabled until explicit owner authorization.

**Requirements**

- Enforce a configurable default $5 USD per subscribed website per UTC calendar month, resetting at 00:00 UTC on the first day, before any OpenAI integration.
- Enforce a configurable initial $50 USD platform-wide hard cap over the same period; a
  reservation must fit under both the site and platform caps atomically.
- Reserve estimated cost atomically, reconcile actual known charges, and account for retries/failures.
- Restrict cap edits to authorized platform roles and audit actor, old/new value, reason,
  and effective time. Lowering a cap below current spend blocks new work without erasing
  charges or reservations.

**Prerequisites**

- The UTC calendar-period rule and zero intentional overage are fixed; G21 documents the price-table source/update procedure and conservative reservation margin.

**Expected files and components**

- Budget/ledger module under `packages/ai/`
- Budget, reservation, usage, and price-table migrations
- ORAP budget/ledger controls and API
- Concurrency test suite

**Implementation tasks**

1. Add a versioned model price table and UTC calendar-month site and platform budget periods with deterministic first-day reset.
2. Implement one serializable reservation decision across site and platform capacity, with expiration/release and immutable usage/correction entries.
3. Reconcile provider-reported input/output usage and charge retries when known.
4. Block/requeue noncritical work without affecting public availability or deterministic checks.
5. Separate shared overhead and prevent unallocated platform spending.
6. Audit site/platform budget overrides and alert threshold/cap events.

Runtime workers use the PostgreSQL-backed ledger and security-definer reservation/finalization
functions. The in-memory ledger is limited to unit tests; it is not a production fallback.

**Database impact:** Add site and platform budgets/periods, reservations attributable to both scopes, immutable usage ledger, correction entries, and price versions.  
**Rollback:** Disable AI job admission; never delete ledger rows; correct estimates through compensating entries.

**Validation tests**

- Acceptance scenario F with concurrent reservations near $5.
- Concurrent cross-site reservations near $50 cannot collectively exceed the platform
  cap even when every individual site has remaining capacity.
- UTC month-boundary, stale reservation, retry charge, actual greater/less than estimate, price-version, and audited override tests.
- Authorized/unauthorized platform-cap edits, immediate lower-cap admission blocking,
  and site-versus-platform exhaustion reason tests.
- Confirm budget exhaustion does not affect static serving, login, or non-AI audit jobs.

**Definition of done**

- No new or concurrent AI job can be admitted beyond either hard cap, and every
  reservation, provider charge, reconciliation variance, and site/platform override is
  attributable and explainable.

### G22 — Scheduler, health monitoring, alert lifecycle, and ORAP operations views

**Status:** `complete`  
**Priority:** P1  
**Dependencies:** G20, G21  
**Decision basis / remaining inputs:** D-021 and D-023 are approved. R-008 plans Resend's $0 free tier using `updates.omnireach.cloud`, confirmed sender `alerts@updates.omnireach.cloud`, up to three exponential-backoff retries, deduplication, and ORAP failure history. Sender/domain verification, recipient confirmation, provider setup, credentials, and explicit activation remain before production delivery. Free-tier monthly and daily limits must be reverified at activation; no paid overage is authorized.

**Requirements**

- Schedule deduped work by site timezone and expose operational job/health/alert state in ORAP.
- Implement the ORAP alert center plus an email-delivery adapter for urgent errors; local/test delivery uses a mock until R-008 is supplied.

**Prerequisites**

- Baseline cadences, maintenance windows, alert severities, and retention defaults are approved.

**Expected files and components**

- `workers/scheduler/`
- `workers/monitoring/`
- Alert adapter in `packages/observability/`
- Email alert adapter, templates, delivery-status records, and local/mock sink
- Schedule/alert migrations
- ORAP jobs, schedules, alerts, and overview screens

**Implementation tasks**

1. Add database-backed schedules with next-attempt calculation, jitter, single-active scheduler lease, and dedupe.
2. Recheck site/features/budget/current policy on enqueue and execution.
3. Add lightweight site/API/admin/domain/queue/worker/database/disk/backup/provider health signal interfaces.
4. Implement fingerprinted open/acknowledged/resolved alerts with severity, ownership, scope, and remediation link.
5. Batch/dedupe repeated events and expose permissioned replay/cancel controls.
6. Route only policy-defined urgent alerts to the email adapter, deduplicate them with the ORAP fingerprint, and record send/retry/failure without leaking sensitive data.
7. Keep production email disabled until R-008 is configured and explicitly authorized.
8. Apply the 30-day operational-log and 12-month audit-record defaults through explicit retention jobs; preserve active incidents and legal/site holds.

**Database impact:** Add schedules, scheduler leases, alerts, occurrences, acknowledgment/assignment, and resolution history with RLS.  
**Rollback:** Pause scheduler and monitors; queued work remains visible/cancellable; alert history is retained.

**Validation tests**

- DST/timezone, missed tick, duplicate scheduler, disabled feature/site, stale job, retry storm, alert dedupe, and resolution tests.
- ORAP authorization tests for replay/cancel/acknowledge.
- Simulated failure produces one actionable ORAP alert and one deduplicated mock urgent email, not a flood.
- Email provider timeout/retry, invalid recipient configuration, redaction, and resolved-alert suppression tests.
- Retention tests enforce 30-day operational-log and 12-month audit defaults while preserving active incidents and configured holds.

**Definition of done**

- Bounded synthetic schedules execute once per intended window and operational failures are visible, scoped, and actionable in ORAP; urgent alerts reach the mock email adapter exactly once per escalation policy.

### G23 — SSRF-safe bounded crawler and crawl evidence store

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** G13, G20  
**Decision basis / remaining inputs:** D-013 and the master-plan crawl safeguards apply. G23 may set conservative technical defaults; site-specific budgets remain configurable in ORAP.

**Requirements**

- Crawl manifest routes, sitemaps, and internal links with strict site budgets and network safety.
- Record evidence and limitations without running untrusted scripts by default.

**Prerequisites**

- Crawler egress, robots behavior, user-agent, redirect, payload, timeout, and concurrency policies are documented.

**Expected files and components**

- `workers/crawler/`
- Fetch/network-safety module in `packages/seo-core/`
- Crawl/audit evidence migrations
- Local malicious-network simulation tests

**Implementation tasks**

1. Canonicalize URLs and restrict scheme, hostname, ports, redirects, response size/type, duration, page count, and concurrency.
2. Resolve and reject loopback, private, link-local, metadata, reserved, and rebinding targets before each connection/redirect.
3. Respect robots for external URLs and use an explicit owned-site mode for authorized targets.
4. Discover/dedupe routes while preventing parameter traps and cross-domain escape.
5. Capture status, canonical, robots, metadata, headings, links, images, sitemap membership, structured data, and render evidence.
6. Persist method/version, source, timestamps, scope, truncation, errors, and trace.

**Database impact:** Add crawl runs, fetched-page evidence, link edges, errors, budgets, and method version with RLS/retention markers.  
**Rollback:** Disable crawler queues; retain bounded evidence for debugging per policy.

**Validation tests**

- SSRF suite: IPv4/IPv6 loopback/private/link-local/metadata, decimal/encoded IPs, DNS rebinding simulation, redirect-to-private, userinfo, unsupported schemes.
- Infinite redirect, huge body, slow response, parameter trap, robots, canonical duplicate, and cross-host tests.
- Ten small fixture sites under configured CPU/concurrency limits.

**Definition of done**

- The crawler produces bounded, reproducible evidence for the starter site and cannot reach forbidden network targets in the test harness.

### G24 — Deterministic SEO and AIO audit rules, findings, and safe remediations

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** G10, G22, G23  
**Decision basis / remaining inputs:** D-022 is approved.

**Requirements**

- Convert crawl/build evidence into versioned deterministic findings with severity, proof, limitations, and remediation state.
- Keep AIO proxy measures distinct from observed referral/mention data.

**Prerequisites**

- Rule severity taxonomy, measurement names, provenance, and caveat language are approved.

**Expected files and components**

- `packages/seo-core/` rule registry
- `workers/seo/` and deterministic portions of `workers/aio/`
- Findings migrations and report APIs
- Starter-site defect fixtures

**Implementation tasks**

1. Implement title/description, canonical/redirect, link, sitemap, indexability, structured data, image/alt, HTTPS/mixed-content/header, heading, orphan, and facts-consistency rules.
2. Implement deterministic AIO completeness/structure checks without claiming external ranking.
3. Version rule inputs/outputs, severity, evidence, confidence/limitations, state, and dedupe/fingerprint.
4. Implement only contract-scoped deterministic remediations, each passing normal publication gates.
5. Report unavailable measurements as unavailable, not zero.
6. Schedule after deploy and by plan while respecting crawl/resource budgets.

**Database impact:** Add SEO/AIO audit and finding tables, remediation state, rule/method versions, and links to crawl/deployment/revision.  
**Rollback:** Disable a rule version/remediation; preserve prior findings and revert published change through G16.

**Validation tests**

- Inject each supported defect into fixtures and assert evidence/severity/remediation.
- False-positive/negative regression corpus and rule-version compatibility tests.
- Verify facts-consistency rules never invent replacements.

**Definition of done**

- Deliberate starter-site issues are detected with inspectable evidence and honest limitations; safe fixes use the normal revision/publication path.

### G25 — OpenAI provider adapter and typed bounded proposal generation

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** G11, G21, G24  
**Decision basis / remaining inputs:** D-008, D-015, D-018, and D-023 are approved. Select models through documented cost/quality benchmarks and configuration; do not hardcode a model ID. R-012 selects a dedicated owner-controlled `OmniReach Production` project with $5 per-site and $50 platform-wide UTC calendar-month hard caps enforced through one atomic internal ledger and editable only through authorized audited ORAP controls. Project setup and credentials remain pending; paid production calls require separate explicit authorization.

**Requirements**

- Route every AI call through one server-side adapter with schemas, timeouts, limits, rate control, budget reservation, and usage reconciliation.
- Treat all crawled/customer/provider content as untrusted data.

**Prerequisites**

- Mock provider, benchmark fixtures, configurable model aliases, and prompt retention/redaction rules are defined. R-012/provider key custody is required only for paid smoke tests or production.

**Expected files and components**

- `packages/ai/` provider client, prompt registry, schemas, and redaction
- `workers/aio/` and proposal job handlers
- Mock provider and offline contract/evaluation suite
- `.env.example` variable names only

**Implementation tasks**

1. Implement configurable model selection through the official SDK and Responses API, using Structured Outputs/native schema helpers where the configured model supports them; also handle refusals, incomplete output, unsupported schema features, timeout, retry classification, and max output.
2. Reserve budget before call and reconcile usage/cost after every known result/failure.
3. Use bounded functions such as metadata/heading/FAQ review that return field-scoped proposals only.
4. Isolate untrusted text, minimize context, and forbid model-selected arbitrary tools, URLs, SQL, filesystem, or shell actions.
5. Record model and prompt-template version, evidence, rationale, latency, and safe usage metadata.
6. Add an optional budgeted sampled-mention measurement job that records the exact prompt, provider/model, time, configured geography/context, repetitions, observed result, and sampling limitations without treating it as a ranking.
7. Add deterministic mock/evaluation fixtures including prompt injection and unsupported claims.

**Database impact:** Use proposal/ledger/job records; add prompt/model version metadata and evaluation result references, not raw sensitive prompts by default.  
**Rollback:** Disable the provider feature globally; deterministic audits and public serving continue.

**Validation tests**

- Offline schema, timeout, malformed output, refusal, rate limit, retry, redaction, prompt-injection, and budget-denial tests.
- CI test prevents drift between application proposal types and the Structured Output schema, while deterministic server-side policy/fact validation remains mandatory after parsing.
- Sampled-mention fixtures preserve method metadata and cannot emit an unlabeled aggregate “AI rank.”
- Optional approved provider smoke test uses fictional content and a strict spend ceiling.
- Assert adapter has no generic production mutation/tool interface.

**Definition of done**

- Typed proposals can be generated from fictional evidence within budget, while malformed/hostile output causes no state mutation.

### G26 — Effective AI modes, protected-fact validation, suggestion review, and autonomous publication

**Status:** `complete`  
**Priority:** P0  
**Dependencies:** G16, G25  
**Decision basis / remaining inputs:** D-006, D-008, and D-015 are approved. Start with a conservative documented eligible-marketing-field catalog; real-site field classification is verified during onboarding.

**Requirements**

- Implement AUTO, SUGGEST, and PROTECTED exactly as defined, including the “auto off means suggest” behavior.
- Revalidate policy, facts, revision, output, and publication at generation, acceptance, and publish time.

**Prerequisites**

- Eligible field catalog, mixed-fact strategy, reviewer permissions, and notification behavior are approved.

**Expected files and components**

- AI policy/protection pipeline in `packages/content/` and `packages/ai/`
- Proposal review UI in customer admin and ORAP
- AUTO orchestration handlers and audit/history UI integration
- Security/E2E regression corpus

**Implementation tasks**

1. Evaluate effective mode through the complete precedence hierarchy and record policy version.
2. Reject PROTECTED generation and mutation before any provider call where possible.
3. Compare normalized structured facts/tokens deterministically; reject removal, modification, contradiction, or duplication.
4. For SUGGEST, save deduped proposals with original revision, rationale, expiry, and Accept/Reject/Edit/View Preview actions.
5. At acceptance, detect stale content, reauthorize, revalidate, build/preview, and require a valid publish permission.
6. For AUTO, stage and validate through G16; on failure leave live content unchanged and raise an actionable alert.
7. Record origin, model/template, usage, evidence, validations, reviewer or automatic reason, revision, artifact, and rollback pointer.

**Database impact:** Extend fields/site policy/proposals with effective mode, policy/revision/version references, expiry, review, validation, and publication links.  
**Rollback:** Emergency switch forces eligible AUTO to SUGGEST or disables generation; revert content through a new G16 revision.

**Validation tests**

- Acceptance scenarios C, D, and E.
- Price, phone, address, hours, legal text, embedded token, Unicode formatting, stale proposal, simultaneous edit, policy change, and budget exhaustion tests.
- Prove even platform-owner feature overrides cannot authorize AI protected-fact changes.

**Definition of done**

- Eligible AUTO fields can publish safely; SUGGEST fields never publish without current authorized acceptance; protected facts never change or receive replacement suggestions from AI.

### G27 — Search Console and GA4 connector foundation

**Status:** `complete`  
**Priority:** P1  
**Dependencies:** G06, G22  
**Decision basis / remaining inputs:** D-018, D-019, and D-022 are approved. R-006 supplies Texas as the initial jurisdiction but exact owner-approved policies remain; R-007 selects one owner-controlled OmniReach OAuth project with per-customer authorized property connections, while concrete project/redirect/consent-screen/property access remains before live connection.

**Requirements**

- Connect authorized Google properties with least privilege, verified site mapping, encrypted token custody, provenance, and clear disconnection states.
- Do not implement Google Business Profile in this goal.

**Prerequisites**

- Provider enrollment, OAuth client/redirect hosts, consent/privacy text, scopes, token store, and property ownership rules are approved.

**Expected files and components**

- `packages/integrations/google/`
- OAuth callback and integration-management API routes
- Connection/metric snapshot migrations
- ORAP connection-health UI
- Mock provider fixtures and optional approved sandbox tests

**Implementation tasks**

1. Implement OAuth state/nonce/PKCE as appropriate, strict redirect allowlist, and encrypted refresh-token reference.
2. Verify selected property belongs to the exact site/domain context.
3. Add incremental Search Console and GA4 ingestion with quotas, backoff, cursors, and idempotency.
4. Ingest available referral/source dimensions and classify only documented, observable AI referral sources through a versioned mapping; retain unknown sources without guessing.
5. Store source, property, query/window, ingestion time, freshness, and permissions provenance.
6. Handle revocation, expiry, insufficient scope, quota, deletion, and reconnect without fabricated data.
7. Add consent/disable hooks and audited disconnect.

**Database impact:** Add integration connections, credential references, scopes, status, sync cursors, and metric snapshots with RLS/retention markers.  
**Rollback:** Disable sync and revoke provider access using the approved runbook; retain or delete metrics according to policy.

**Validation tests**

- OAuth replay/state mismatch, open redirect, wrong property/site, revoked token, quota, duplicate window, and cross-tenant metrics tests.
- Mock connected/disconnected/stale/delayed states.
- Optional sandbox ingestion with non-customer test property only.

**Definition of done**

- An approved test property ingests attributable metrics, while a disconnected site exposes an explicit not-connected state.

### G28 — Honest customer and ORAP reporting dashboards

**Status:** `complete`  
**Priority:** P1  
**Dependencies:** G08, G16, G22, G24, G26, G27  
**Decision basis / remaining inputs:** D-006 and D-022 are approved. The visibility matrix must follow the approved role model and deny by default.

**Requirements**

- Present publication, health, SEO/AIO work, proposals, usage, and available analytics with provenance and limitations.
- Separate work performed, measured impact, proxy measures, missing data, and stale data.

**Prerequisites**

- Metric definitions, time windows, visibility permissions, and AIO caveats are approved.

**Expected files and components**

- Dashboard modules in `apps/orap/` and `apps/customer-admin/`
- Reporting query services/read models in API packages
- Shared chart/table components only where useful
- Reporting E2E and accessibility tests

**Implementation tasks**

1. Build site health/publication, audit findings, optimization history, pending proposals, AI budget, and integration status views.
2. Show authorized traffic/search performance, completed improvements, structured-data completeness, observable AI referral traffic, and sampled AI mentions as separate measurements.
3. Add source/window/ingestion/freshness labels and not-connected/unavailable states; sampled mentions must show prompt/method/model/time/context and limitations.
4. Distinguish proposed, approved, published, reverted, and measured outcomes.
5. Restrict staff/customer visibility and redact operational/private details.
6. Add filtering, pagination, timezone-aware dates, accessible tables/charts, and export only if safe and scoped.
7. Prohibit unexplained AIO scores, causal claims, or ranking promises.

**Database impact:** Prefer indexed read queries/materialized read models only if measured necessary; any cache remains tenant-scoped and rebuildable.  
**Rollback:** Disable a report/read model without touching source ledgers/events.

**Validation tests**

- Acceptance scenario L and permissions matrix across Platform Owner, Platform Admin, Staff, Customer Owner, Customer Editor, and Customer Viewer.
- Fixtures for absent, stale, partial, delayed, and contradictory source data.
- Separate fixtures for verifiable referral traffic, structured-data completeness, and sampled mentions; none may be silently combined into a ranking score.
- Accessibility and responsive checks; no fake success/zero states.

**Definition of done**

- Each displayed number/status identifies its source and window or clearly states why it is unavailable.

### G29 — Backups, off-server copy adapter, restore verification, and retention controls

**Status:** `complete`  
**Priority:** P0 before production  
**Dependencies:** G12, G19, G22  
**Decision basis / remaining inputs:** D-011, D-016, D-018, and D-023 are approved. R-005 retains the development-only local profile and proposes Cloudflare R2 as the production off-server target under a proposed $5 monthly budget. The owner is sole encryption-key custodian and manual-deletion approver; encryption keys stay separate from least-privilege R2 credentials. Production still requires authorized provider setup, automated encrypted transfer, verified 7-daily/4-weekly retention within cost/capacity limits, and a successful real restore. Applicable R-006 policies are also required for production deletion.

**Requirements**

- Create daily encrypted backups of PostgreSQL live content/metadata, original media, and artifact manifests; retain 7 daily and 4 weekly recovery points, keep an encrypted off-server copy, and perform a full isolated restoration test monthly.
- Git history must not be treated as runtime-data backup.

**Prerequisites**

- The cadence and retention counts are fixed by D-016. R-005 proposes the destination
  and budget but still requires account/credential authorization and restore evidence;
  R-006 supplies applicable privacy deletion rules.

**Expected files and components**

- `infrastructure/backups/` scripts and manifests
- Backup job handlers and status/alert integration
- Restore runbook and isolated restore harness
- Backup metadata/checksum migrations or observability records

**Implementation tasks**

1. Create consistent compressed logical DB backup and site-isolated asset/manifest inventory with checksums.
2. Encrypt before transfer to Cloudflare R2, keep encryption keys separate from scoped
   storage credentials, and prevent secrets from entering logs/repo.
3. Retain exactly 7 daily and 4 weekly recovery points across the approved local/off-server storage policy; alert before capacity prevents compliance and prune only by explicit backup manifest.
4. Run daily archive/checksum/completeness validation.
5. Once per calendar month, restore into a new isolated database/storage namespace and verify schema, counts, tenant boundaries, media links, and an artifact recovery.
6. Surface last success, size, checksum, off-server copy, restore-test date, and failures in ORAP.

**Database impact:** Backup metadata/status only; backup files live outside Git and application volumes.  
**Rollback:** Disable scheduled backup/prune tasks while preserving existing archives; key changes require a tested re-encryption/retention plan.

**Validation tests**

- Corrupt, truncated, missing asset, wrong key, low disk, failed transfer, and partial backup alerts.
- Full isolated restore of fictional tenants/assets and recovery of a previously published artifact.
- Retention-boundary tests prove 7 daily and 4 weekly recovery points remain and no active/current backup is pruned.
- Confirm backup archives and keys are ignored by Git and inaccessible to customer roles.

**Definition of done**

- Daily encrypted backup/integrity checks, 7-daily/4-weekly retention, and a monthly isolated restore drill are automated and observable.
- An encrypted off-server fictional/test backup path is verified before G31 production activation.
- R-005 becomes production-complete only after the authorized automated R2 path meets the
  24-hour RPO and a real isolated restore succeeds.

### G30 — Security, accessibility, resilience, and ten-site capacity release gate

**Status:** `complete`  
**Priority:** P0 before pilot  
**Dependencies:** G19, G21, G26, G28, G29  
**Decision basis / remaining inputs:** D-013 and the approved 2-core/~8 GiB initial resource envelope apply. The R-003 point-in-time snapshot, a healthy nine-sample existing-service observation, the isolated ten-site load suite, and the full local release registry are recorded. Live OmniReach cannot be measured before G31 stages it, so representative VPS soak and pre/post existing-service non-regression are G31 activation checks rather than a circular G30 prerequisite. R-013 supplies the owner-approved service and recovery objectives against which launch thresholds are judged.

**Requirements**

- Validate the integrated platform against security, tenant, failure, accessibility, resource, and existing-workload requirements.
- Fix release-blocking findings before the pilot; do not waive invariants for a demo.

**Prerequisites**

- Sanitized pre-deployment host baseline plus explicit isolated-test CPU/RAM/disk/queue/latency thresholds. Live-host thresholds are revalidated during G31 before public route activation.

**Expected files and components**

- `tests/security/`, `tests/load/`, `tests/e2e/acceptance/`
- Hardened container/runtime configurations
- Security and accessibility review reports
- Incident, freeze, key-revocation, rollback, and recovery drill records

**Implementation tasks**

1. Run all acceptance scenarios A–L and trace failures to owners.
2. Test XSS, CSRF, SSRF, uploads, OAuth/webhook replay, session, tenant, privilege, secret, dependency, and container boundaries.
3. Run ten-site workload with staggered audits, one/two worker concurrency, builds, dashboards, and static traffic while measuring headroom.
4. Test API/Redis/worker/OpenAI/Google/build failure isolation and restart/recovery.
5. Audit WCAG-oriented keyboard, focus, labels, errors, contrast, and responsive behavior.
6. Run incident freeze, content rollback, code rollback, credential revocation, and restore drills.
7. Record the bounded pre-deployment Christians Reunite/shared-Caddy baseline; execute the representative pre/post non-regression observation in G31 once OmniReach can actually run.

**Database impact:** Test data only in isolated environments; production test records require a separate approved plan.  
**Rollback:** Stop the isolated test load and revert only the candidate release through G19; preserve reports and evidence.

**Validation tests**

- Full root CI, integration, E2E, security, contract, deployment, accessibility, and capacity suites.
- Resource thresholds and static-site availability assertions under dependency failures.
- Secret scan of source, images, logs, artifacts, fixtures, and workflow output.

**Definition of done**

- No open critical/high launch blocker; accepted lower risks have owner, mitigation, and due date.
- Ten fictional sites meet the isolated headroom and availability thresholds, and the existing-service pre-deployment baseline has no unresolved blocker. Live-host non-regression remains a mandatory G31 activation check.

### G31 — Authorized production release activation

**Status:** `in progress`
**Priority:** P0 production gate  
**Dependencies:** G16, G18, G19, G29, G30  
**Decision basis / remaining inputs:** D-001, D-002, D-009, D-012 through D-014, D-016, D-017, and D-021 are approved, and G30's pre-production gate is complete. The owner authorized end-to-end G31 completion on 2026-10-11. R-010 fixes the repository as `OmniReach-Websites/SEO-Automation`, the owner as approver/deploy-key custodian, and the account as `omnireach-deploy`. The SSH host key, GitHub production environment, main-only policy, and encrypted deploy secret are configured. Execution still requires the one-time root bootstrap, live prechecks/rollback evidence, backup readiness, and validation of each DNS/Caddy mutation; paid provider activation and real-customer onboarding remain gated.

**Requirements**

- Convert the inert G19 deployment foundation into the protected, push-triggered `main` production release path.
- Give `omnireach-deploy` only narrowly scoped release permissions, with no unrestricted
  sudo or Docker-daemon access.
- Provision/activate OmniReach production services and routes without replacing shared Caddy, altering Christians Reunite, exposing Postgres/Redis, or onboarding a real customer.
- Require reviewed checkpoints for credentials, migrations, backup readiness, Caddy validation/reload, activation, health checks, and rollback.

**Prerequisites**

- G30 release gate is signed off with no critical/high launch blocker.
- The read-only infrastructure inventory is current, R-series production inputs listed above are supplied through approved secret/config channels, and the owner explicitly authorizes the scheduled activation window.
- A pre-activation backup and tested rollback target exist.

**Expected files and components**

- Protected `.github/workflows/deploy-production.yml` wrapper invoking the G19 reusable workflow only for verified `main`
- Final production compose/config manifests with unique project, volume, port, network, and release names
- GitHub production environment/approval configuration checklist and recorded nonsecret settings
- Final Caddy route fragment/change record and pre/post-health checklist
- Production release, rollback, and incident evidence in the approved operations/audit systems

**Implementation tasks**

1. Re-run and review the sanitized VPS/Caddy/Christians Reunite inventory; abort on unexplained drift or inadequate resource headroom.
2. Create/verify the dedicated non-root deploy account, restricted filesystem ownership,
   SSH host key, and least-privilege GitHub production environment without recording
   secrets in Git. Do not grant unrestricted sudo or Docker-daemon access.
3. Bind the G19 reusable workflow to protected `main` pushes and a separately permissioned manual recovery action; do not permit branch or pull-request deployment.
4. Install isolated OmniReach production service definitions, private networks, persistent volumes, health checks, resource caps, and log limits without reusing existing project ownership.
5. Complete the one-time owner bootstrap through the approved secret channel, require authenticator-app MFA, hand off recovery codes to the designated custodian, and verify session revocation without exposing credentials.
6. Verify encrypted backup/off-server copy readiness before applying forward-compatible production migrations.
7. Stage the exact verified artifact, validate the generated Caddy fragment, activate services/routes atomically, and run API/admin/static/contact-form-disabled health checks.
8. Confirm Christians Reunite and all preexisting Caddy routes before and after activation.
9. On any failed gate, restore the prior Caddy config/release pointer, stop only the explicitly named OmniReach services, preserve evidence, and alert through approved channels.
10. Only after the non-root deployment path and emergency recovery are tested, present a
    separate owner-authorized SSH-hardening change; do not silently disable root/password access.

**Database impact:** Apply the reviewed baseline/forward-compatible production migrations to the isolated OmniReach database with no real customer records. Record exact migration and release versions.  
**Rollback:** Restore the prior route/release pointer and stop only OmniReach's explicitly resolved services. Never roll back a schema destructively; use the approved forward-recovery plan and verified backup.

**Validation tests**

- Production workflow policy proves only protected `main` can use the production environment and SSH credentials.
- Permission tests prove `omnireach-deploy` cannot obtain a root shell, unrestricted sudo,
  arbitrary Docker control, or write outside approved release paths.
- Exact-SHA/checksum, host-key, release-lock, migration-preflight, health, rollback, secret-redaction, and audit-event checks pass.
- The production owner can sign in only after authenticator-app MFA; bootstrap material is one-time, recovery custody is recorded outside Git, and revocation works.
- Public ORAP/static health endpoints work on the supplied domain with correct TLS; unknown/unverified hosts fail closed.
- Postgres/Redis remain private, urgent-alert email and backup status are verified, and no real contact form is enabled without R-009.
- Christians Reunite and every inventoried existing Caddy route remain healthy and semantically unchanged.

**Definition of done**

- A protected push to `main` can deploy an immutable, traceable OmniReach release and a deliberately unhealthy release automatically restores the prior healthy version.
- Production contains no real customer until G32, all required backup/monitoring/rollback evidence exists, and existing services remain untouched except for the reviewed additive Caddy import/route change.

### G32 — Fictional rehearsal and explicitly approved real pilot onboarding

**Status:** `not started`  
**Priority:** P0 launch gate  
**Dependencies:** G31  
**Decision basis / remaining inputs:** All D-series decisions are approved. R-001 through R-013 and explicit authorization for the named pilot and every production mutation are required as applicable.

**Requirements**

- Rehearse the complete onboarding with fictional data, then onboard only one explicitly approved real pilot.
- Use human checkpoints for credentials, DNS, Caddy, deployment, analytics consent, protected facts, and publication.

**Prerequisites**

- Production runbooks, policies, terms/privacy, credentials, backup destination, support ownership, rollback authority, and customer approval are complete.
- G30 launch gate and G31 production activation are signed off.

**Expected files and components**

- Customer/site onboarding checklist and evidence template
- Pilot acceptance record outside public source where it contains customer details
- Training materials for developers, operators, and customer support
- Sanitized launch report in `docs/operations.md` or an approved non-public system

**Implementation tasks**

1. Rehearse tenant/site/user/contract/content/assets/domain/routing/deploy/publish/audit/AI budget/analytics/backup/restore/rollback using a fictional site.
2. Review and verify pilot facts, AI eligibility, permissions, consent, domains, integrations, and support contacts with humans.
3. Apply production changes one reviewed step at a time with prechecks and rollback points.
4. Start with conservative schedules/concurrency and monitor resource, spend, failures, conflicts, metrics quality, and public availability.
5. Perform customer/editor acceptance and operations handoff.
6. Hold expansion to additional sites until pilot findings are remediated and approved.

**Database impact:** First approved production tenant/site/content records; migrations and release activation were already proven by G19/G30/G31.  
**Rollback:** Freeze automation/editing, revert content/code/routing through documented mechanisms, revoke integrations, preserve audit/backup evidence, and follow customer communication policy.

**Validation tests**

- Repeat acceptance scenarios A–L for the fictional rehearsal and applicable pilot scope.
- Verify live TLS/host routing/session isolation, artifact metadata, budget cap, alert paths, backup completion, and rollback readiness.
- Confirm Christians Reunite and shared Caddy health before and after each approved infrastructure step.

**Definition of done**

- The fictional rehearsal passes completely.
- The real pilot is live only after explicit authorization and has verified monitoring, backup, rollback, support, privacy, and acceptance evidence.
- Expansion remains a separate decision based on pilot results.

## 6. Deferred follow-up goals

The following are intentionally outside the V1 critical path and must not be pulled into an earlier goal without a roadmap/ADR change:

- Sanitized content exports to a bot branch or reviewable PR.
- Payment-provider automation.
- SMS/chat alert delivery and non-urgent email notification campaigns beyond the approved urgent-error adapter.
- Google Business Profile integration.
- Customer MFA enforcement beyond the supported foundation.
- S3-compatible media migration after the storage adapter is proven.
- Worker/hosting separation or CDN migration based on measured load.
- Custom transactional site adapters, commerce, reservations, or separate application databases.
- Registrar purchase/renewal automation.
- Multi-region, Kubernetes, distributed crawling, or analytics warehouse.

## 7. Progress ledger

Update this table in the same change that changes a goal status. A goal marked `blocked` must name the unresolved R-ID or other concrete external prerequisite in Notes; approved D-series decisions are constraints, not blockers.

| Goal | Status      | Depends on                   | Notes                                                                                                                                                                  |
| ---- | ----------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G01  | complete    | —                            | Architecture/security/operations/contract baseline and 9 ADRs validated 2026-10-10                                                                                     |
| G02  | complete    | G01                          | Repository/toolchain baseline and validation registry complete; all checks pass                                                                                        |
| G03  | complete    | G02                          | Branch CI and supply-chain policy validated; remote protection remains owner action                                                                                    |
| G04  | complete    | G02                          | Loopback Docker stack, 10 idempotent migrations, seed, health, and API verified                                                                                        |
| G05  | complete    | G04                          | Argon2id auth, staff MFA, recovery, owner bootstrap, sessions, and audit verified                                                                                      |
| G06  | complete    | G04, G05                     | Direct PostgreSQL RLS attacks, context reset, exact-host resolution, and roles pass                                                                                    |
| G07  | complete    | G06                          | Agency-operated site/user/invitation/audit APIs and served ORAP shell verified                                                                                         |
| G08  | complete    | G07                          | Exact plans/grace, seat/page/location locks, schedule admission, AI-cycle quotas, and readiness gates pass                                                             |
| G09  | complete    | G02, G06                     | Contract schema, hashes, compatibility rules, and three fixtures validate                                                                                              |
| G10  | complete    | G09                          | Starter plus distinct restaurant/custom sites build and pass static accessibility                                                                                      |
| G11  | complete    | G06, G09                     | Structured drafts/revisions/facts/proposals, CAS, restore, and protection verified                                                                                     |
| G12  | complete    | G06, G11                     | Site-isolated validated media storage, routes, and hostile fixtures verified                                                                                           |
| G13  | complete    | G10, G11, G12                | Reusable centralized forms, contract fields, Turnstile, views, delivery, holds, retention, and artifacts pass                                                          |
| G14  | complete    | G06, G08, G13                | Exact-host API isolation and real-browser customer/ORAP shell isolation pass                                                                                           |
| G15  | complete    | G12, G14                     | Bounded controls, optimistic drafts, media, preview, permissions, and E2E pass                                                                                         |
| G16  | complete    | G13, G15                     | Live DB publish/restore/failure rehearsal preserves immutable rollback trail                                                                                           |
| G17  | complete    | G08, G14                     | Mock DNS state machine, dry-run/idempotency, takeover/IDN checks, ORAP view pass                                                                                       |
| G18  | complete    | G13, G14, G17                | R-001/R-003 evidence, isolated exact-host fragment, validation, and non-regression plan pass; activation is G31                                                        |
| G19  | complete    | G03, G13                     | Inert reusable workflow and isolated checksum/lock/rollback harness pass                                                                                               |
| G20  | complete    | G04, G06                     | Opaque BullMQ jobs, durable dispatch claims, effect keys, stalled recovery, drain/dead-letter, retention, and RLS pass                                                 |
| G21  | complete    | G08, G20                     | Atomic site/platform caps, cross-site concurrency, UTC reset, and audited owner/admin controls pass                                                                    |
| G22  | complete    | G20, G21                     | Durable timezone scheduler, alert/email history, and audited ORAP acknowledge/resolve/cancel/replay controls pass                                                      |
| G23  | complete    | G13, G20                     | Bounded crawler, robots/query/timeout limits, and redirect/DNS SSRF regressions pass                                                                                   |
| G24  | complete    | G10, G22, G23                | Versioned deterministic SEO/AIO evidence rules and safe remediation classes pass                                                                                       |
| G25  | complete    | G11, G21, G24                | Official Responses SDK adapter, typed schema, mocks, redaction, and budget flow pass                                                                                   |
| G26  | complete    | G16, G25                     | AUTO/SUGGEST/PROTECTED policy, fact corpus, review, and rollback path pass                                                                                             |
| G27  | complete    | G06, G22                     | OAuth/PKCE/replay/property/token/metric mock foundation passes; live access is R-007                                                                                   |
| G28  | complete    | G08, G16, G22, G24, G26, G27 | Source/window/freshness/caveat reporting and browser accessibility pass                                                                                                |
| G29  | complete    | G12, G19, G22                | Encrypted nested-media/off-server copy, retention, corruption, and isolated restore pass                                                                               |
| G30  | complete    | G19, G21, G26, G28, G29      | Full local gate and isolated ten-site load pass; nine healthy pre-deployment samples recorded; representative live soak moves to G31                                   |
| G31  | in progress | G16, G18, G19, G29, G30      | Main-only workflow/environment and pinned restricted SSH identity configured; one-time root bootstrap, live release/rollback, backups, Caddy/DNS, and owner MFA remain |
| G32  | not started | G31                          | Fictional rehearsal and pilot onboarding                                                                                                                               |

## 8. Definition of roadmap completion

This roadmap itself is complete when it:

- accounts for every master-plan implementation phase and acceptance scenario;
- records approved architecture decisions and separates genuine owner-supplied production inputs before development goals;
- keeps production mutations behind explicit authorization gates;
- gives every goal requirements, prerequisites, expected files/components, tasks, database impact, validation, rollback, definition of done, and dependencies;
- orders goals so a Codex agent can execute one goal without silently implementing its dependents; and
- remains maintainable through the progress ledger, approved D-ID constraints, and unresolved R-ID production inputs.
