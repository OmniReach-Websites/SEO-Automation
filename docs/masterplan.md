# OmniReach — Master Architecture and Implementation Specification

**Document:** `docs/masterplan.md`  
**Version:** 1.0 — Architecture baseline  
**Date:** 2026-10-10  
**Status:** Design specification; implementation not yet authorized by this document alone  
**Primary repository:** `OmniReach-Websites/SEO-Automation`  
**Target environment:** Ubuntu 24.04 LTS, Docker Compose, existing Caddy reverse proxy  
**Audience:** OmniReach owners, developers, Codex implementation agents, operations team

> **Directive to implementation agents:** This is the product and architecture source of truth. First inspect the repository and current infrastructure, produce a dependency-ordered implementation plan, identify unresolved decisions, and implement in small, testable, reversible milestones. Do not interpret illustrative interfaces or proposed implementation details as proof that they already exist. Never modify the existing Christians Reunite deployment or shared Caddy configuration without an explicit, reviewed migration plan. Never commit credentials or customer secrets.

---

## 1. Executive summary

OmniReach is an **agency-first, fully managed, multi-tenant website hosting and automated SEO/AIO platform** for restaurants and other local businesses. It is **not** a self-service website builder or a general-purpose SaaS. OmniReach employees build customer sites and manage operations; customers receive dashboards and controlled editing access as a service benefit.

The primary differentiator is a centrally operated, largely autonomous optimization system. It audits customer websites, collects available search and analytics signals, proposes and implements technical SEO and AI-search-oriented improvements, validates them, measures results, and reports status. It uses the **OpenAI API** for language and reasoning tasks, and deterministic application code for crawling, parsing, authorization, scheduling, publishing, validation, costs, and data integrity.

Each customer website runs under its own domain, administered through `admin.<customer-domain>`. OmniReach employees operate the central **OmniReach Admin Panel (ORAP)**. ORAP governs tenant subscriptions, site configuration, domain status, editing permissions, SEO/AIO features, automation switches, AI budgets, integrations, staff roles, audits, alerts, and deployments.

All application code, infrastructure definitions, and customer website source live in **one GitHub monorepo**. GitHub `main` is production source for code; feature/testing branches never auto-deploy to production. Pushes to `main` trigger a GitHub Actions workflow that connects to the VPS over SSH and performs a controlled deployment. PostgreSQL, rather than Git working-tree files, is authoritative for live editable content. Versioned content exports to GitHub may be implemented safely as a separate, non-redeploying archival workflow.

**Initial scale:** approximately 10 customer websites on the existing VPS (2 vCPU, ~8 GiB RAM, ~85 GiB free at planning time); designed for horizontal growth and future worker/hosting separation. Start small: concurrency-capped, modest crawls, externally hosted OpenAI inference, static or prerendered public pages wherever appropriate.

### 1.1 Confirmed product decisions

| Topic | Decision |
|---|---|
| Customers | Restaurants and local businesses |
| Business | Monthly subscriptions with multiple tiers |
| Strategy | Agency-operated forever; not a self-service site creation product |
| Website creation | OmniReach developer/team builds and commits website code |
| Repository | One monorepo for central platform and customer site source |
| Customers' editing | Per-site login at `admin.<domain>`; dashboard plus editor |
| Editable surface | Text, images, supported sections, basic layout; larger changes handled by team |
| Customer metrics | SEO, AIO, traffic, optimization activity, website health |
| Administration | ORAP for owner and authorized employees |
| Fine-grained feature flags | ORAP can turn features on/off per website regardless of tier defaults |
| AI | OpenAI API |
| AI budgets | Default $5 USD per site per billing month; editable in ORAP |
| SEO/AIO autonomy | Autonomous where allowed, with verification, alerts, revisioning, and rollback |
| Content rewrite default | Auto-optimize for eligible marketing text fields |
| Content rewrite off | Generate suggestions and notify customer; no publication until approved |
| Protected information | AI must **never** change prices or important business facts |
| Domains | Purchased and managed by OmniReach via Cloudflare |
| Git deployment | SSH-triggered from GitHub Actions on pushes to `main` only |
| Scale | Build initially for ~10 sites; split services later as needed |
| Backups | Lightweight, reliable backup plan, eventually off-server |
| Customer export | Not a V1 product feature |

### 1.2 Guiding principles

1. **Tenant security and content safety outrank autonomy.** AI never gets unrestricted production file, database, or shell access.
2. **The control plane is distinct from the serving plane.** A downed worker/dashboard must not take healthy customer sites offline.
3. **Site-specific visual freedom, common management contract.** Employees may build unique sites; every managed-editable site implements standard content/SEO interfaces.
4. **Explicit sources of truth.** Git for code; PostgreSQL for metadata and structured content; object storage for original media; immutable deployment artifacts for published site versions.
5. **Every change is traceable and reversible.** Store actor, reason, policy, revisions, validation, deployment, and outcome.
6. **Guardrails are enforced in code.** Prompts supplement, never replace, permission checks, cost budgets, protected-fact validation, and publishing gates.
7. **No unsupported performance promises.** Search rankings and AI citations cannot be guaranteed; represent metrics with attribution and uncertainty.
8. **All jobs are idempotent, bounded, observable, and tenant-scoped.**

---

## 2. Scope and boundaries

### 2.1 V1 in scope

- ORAP login, owner/staff roles, customer and site management.
- Customer login at `admin.<site-domain>` with site-specific dashboard and content editor.
- Permissioned creation/disabling/reset of customer user accounts by ORAP staff.
- One-to-many tenants-to-sites model; domain and subdomain verification.
- Basic subscription tiers and entitlements with per-site override controls; billing data can initially be tracked manually.
- PostgreSQL-backed structured content, asset management, section editing, draft/live versions, change history.
- A starter Astro site template and a documented integration contract for custom-built sites.
- Caddy-based custom domain HTTPS and deployment routing.
- Automated `main` deployment of code, with safe, reviewable release procedure.
- SEO crawler and deterministic technical audits; Search Console / analytics connectors when properly authorized.
- Safe autonomous SEO/AIO suggestions, automatic fixes for eligible fields, explicit review for suggestions-only fields.
- Immutable protected factual data and verified constraint enforcement.
- OpenAI API usage metering, per-site limits, periodic schedules, and centralized queue workers.
- Alerts inside ORAP for failed jobs, deployment issues, auth/integration expiry, budgets, and site health.
- Customer dashboards for available traffic/search data, history, and suggestions.
- Small-server backups and restoration tests.

### 2.2 Out of scope for the initial release

- A drag-and-drop arbitrary HTML/CSS builder that edits any developer-written layout.
- Customer-initiated creation of new websites.
- Full payment processor automation unless separately approved; preserve a billing adapter boundary.
- Autonomous financial, legal, menu-price, location, hours, inventory, contact, or policy changes.
- Guaranteeing Google ranking positions, AI answer inclusion, or citations.
- Secret scraping, captchas, circumvention of robots directives, or unauthorized third-party content copying.
- Browser-control agents directly editing production sites.
- Hosting arbitrary untrusted customer executable code in a shared runtime.
- Multi-region, Kubernetes, distributed crawling, and enterprise-grade analytics warehouse.

### 2.3 Types of customer sites

Support an agency-built public website with content managed through the OmniReach contract. Marketing sites and restaurant sites are first-class. Employee-written custom sites may incorporate forms, reservations, e-commerce, or database-backed applications, **but** those dynamic capabilities require separately scoped adapters, data stores, security review, backups, and deployment configuration. They are not assumed to work automatically merely by placing arbitrary source in `sites/`.

---

## 3. Actors, permissions, and responsibility

### 3.1 Actor classes

- **Platform owner:** Full ORAP access to customers, plans, settings, staff, costs, automations, credentials metadata, alerts, and publishing controls.
- **Platform administrator:** Delegated ORAP administration; sensitive settings constrained as assigned.
- **Platform developer:** Site source changes, staging deploys, templates, deployment logs; not automatically given customer passwords, API secrets, or billing privileges.
- **Platform operator/SEO specialist:** SEO settings, proposal review, alerts, run history, customer support as delegated.
- **Customer owner:** Customer dashboard, authorized site fields/media, proposals, user management only if granted by ORAP.
- **Customer editor:** Edit permitted content, view permitted metrics, manage their own account.
- **Customer viewer:** Read-only dashboard access.
- **Worker/service identity:** Minimum scoped credentials for a single queue action; not a superadmin user.

### 3.2 Access model

- Central identities with memberships (`platform` and `tenant/site`) and roles; do **not** treat a domain string or client-supplied `tenant_id` as authorization.
- Require secure password hashing (Argon2id or documented equivalent), unique identity constraints, secure password reset, session revocation, rate limiting, and CSRF protection when cookie-authenticated.
- Platform staff use MFA, required for owner/admin accounts; customer MFA should be supported or scheduled for an early follow-up.
- ORAP manages creation, disabling, reset, per-site membership and role changes; never display stored passwords (they are hashes).
- Tenant isolation enforced in API/service queries and ideally PostgreSQL row-level security (RLS), tested against cross-tenant read/write and background job access.
- Site-by-site access: a user may belong to multiple customer sites, but receives no implicit access to sister sites without membership.
- Owner-level emergency disable of all customer editing and all autonomous changes for a specific site.
- Audit log privileged changes, sign-ins, account resets, changes to protected data, and publishing.

### 3.3 Domain and session safety

- Resolve `admin.<domain>` to the registered verified site; no arbitrary host header trust.
- Validate domains using an allowlisted database mapping and verified DNS/Cloudflare ownership; handle IDN/punycode and canonical hostnames.
- Host-only Secure, HttpOnly, SameSite cookies; avoid sharing session cookies across unrelated customer domains.
- Cross-domain ORAP and customer sessions use a deliberate SSO design or separate site-scoped sessions; no token leakage in URLs.
- Prevent open redirects and unsafe OAuth callbacks; apply content-security policies and restrict upload types.

---

## 4. Architecture overview

```text
                    ┌────────────────────────────────┐
                    │ GitHub monorepo (main + staging)│
                    └───────────────┬────────────────┘
                                    │ GitHub Actions: main push
                                    ▼
                             SSH deploy agent
                                    │
                    build/test/stage/switch/health/rollback
                                    ▼
Internet → Cloudflare DNS / optional proxy → Caddy (existing)
                                    │
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
             ▼                      ▼                      ▼
    Customer public sites       admin.<domain>            ORAP hostname
   versioned artifacts/CDN    Customer admin app        Platform dashboard
             │                      │                      │
             └──────────────────────┴──────────┬───────────┘
                                               ▼
                                     Fastify control API
                                      tenant/auth checks
                                               │
                       ┌───────────────────────┼───────────────────────┐
                       ▼                       ▼                       ▼
                  PostgreSQL              Redis/BullMQ           Asset storage
                tenants, content         queued work, locks     original media
                       │                       │
                       │                       ▼
                       │            scheduler + bounded workers
                       │          crawler / SEO / AIO / publisher
                       │                       │
                       └───────────────┬───────┘
                                       ▼
                                OpenAI API and
                          authorized Google APIs
```

### 4.1 Control plane

The central backend owns identity, tenants, sites, policies, job orchestration, content versions, deployment state, billing/limits, domains, and logs. ORAP and customer admin are interfaces to this control plane. No website-specific database credentials need to be exposed to a customer browser.

### 4.2 Serving plane

Prefer **static/prerendered Astro builds** served by inexpensive web containers or a shared immutable artifact server through Caddy. Public site HTML is built from approved content versions and source revisions. When a customer needs live server-side functionality, use separately reviewed services/routes and appropriate isolation.

For ~10 sites, favor shared services and bounded resource limits over a Node SSR process per site. Never couple public page serving to availability of Redis/OpenAI.

### 4.3 Worker plane

An API-triggered and scheduler-triggered job system uses BullMQ/Redis. Workers can share one initial worker image/process with queue-specific concurrency controls, while keeping code in separate packages/modules. Workers call controlled publishing/content services instead of writing directly to customer source trees or production domains.

### 4.4 External integrations

- **OpenAI API:** prompts, output schemas, content evaluation/generation; budgeted, logged without unnecessary personal data.
- **Cloudflare:** DNS for purchased/managed domains; scoped API token, auditable mutations, optional caching/proxy only after testing.
- **Google Search Console:** authenticated per-property data; user consent and verified ownership.
- **Google Analytics (GA4):** optional event/traffic metrics subject to consent and proper permissions.
- **Google Business Profile:** optional future connector; respect official API permissions, editorial controls, and provider policy.
- **Google PageSpeed Insights / Lighthouse:** measured performance, bounded scan frequency.
- **Search engine robots/sitemaps:** standards-based behavior; do not bypass access restrictions.

---

## 5. Technology and implementation defaults

| Layer | Default | Notes |
|---|---|---|
| Monorepo | npm workspaces, TypeScript, shared lint/test config | Avoid unnecessary build tooling overhead |
| API | Node.js LTS + Fastify | Schema validation on requests and responses |
| ORAP | Next.js | Authenticated dashboard, server-side API proxy as needed |
| Customer admin | Shared Next.js application | Host/domain selects verified site; common editor and reporting UI |
| Public websites | Astro | Static-first, allow custom code behind contract |
| Data | PostgreSQL 16 + Prisma | Migrations, indexed scoped queries, transaction-aware writes |
| Job orchestration | Redis + BullMQ | Durable jobs, retries, deduplication, explicit budgets |
| AI | Official OpenAI SDK, typed response schemas | Models configurable; never hardcode a model that might change |
| Media | Persistent object-storage abstraction | V1 can use a dedicated mounted directory; protect with backups |
| Deployment | GitHub Actions + SSH, Docker Compose | Only `main` auto-production; serialized controlled releases |
| Proxy | Existing Caddy | New routes added intentionally; existing sites unaffected |
| Testing | Vitest or equivalent, Playwright for UI/E2E | Integration tests using disposable Postgres/Redis |
| Observability | JSON logs, metrics/health endpoints, ORAP alerts | Do not leak secrets or private content |

Frameworks and libraries are implementation defaults, not user-directed commitments. Agents may propose alternatives only with a brief decision record explaining why they better satisfy the requirements. Record architectural decisions under `docs/adr/`.

---

## 6. Monorepo structure

```text
SEO-Automation/
├── apps/
│   ├── api/                         # Fastify API
│   ├── orap/                        # Staff platform dashboard
│   └── customer-admin/              # Shared admin.<domain> application
├── sites/
│   ├── _starter/                    # Example/reference Astro website
│   ├── restaurant-example/          # Test fixture, not a real customer
│   └── <site-slug>/                 # Agency developer-written sites
├── workers/
│   ├── runner/                      # Worker bootstrap and job registry
│   ├── crawler/
│   ├── seo/
│   ├── aio/
│   ├── publisher/
│   ├── scheduler/
│   └── monitoring/
├── packages/
│   ├── database/                    # Prisma schema/migrations
│   ├── auth/                        # Identities, sessions, RBAC/ABAC
│   ├── tenant/                      # Tenant context/isolation helpers
│   ├── contracts/                   # Site integration/editability schemas
│   ├── content/                     # Revisions, facts, content workflows
│   ├── queue/                       # Job definitions and utilities
│   ├── ai/                          # OpenAI adapter and cost metering
│   ├── seo-core/                    # Deterministic SEO validation
│   ├── integrations/                # Cloudflare/Google adapters
│   ├── observability/               # Logs, events, alerts
│   ├── shared/                      # Types, utilities and validators
│   └── ui/                          # Shared components, where useful
├── infrastructure/
│   ├── compose/                     # Dev and production definitions
│   ├── caddy/                       # Isolated Caddy route snippets/docs
│   ├── deploy/                      # Release + rollback scripts
│   └── backups/                     # Backup and restore scripts
├── .github/workflows/              # CI + production deploy
├── docs/
│   ├── masterplan.md
│   ├── architecture.md
│   ├── integration-contract.md
│   ├── operations.md
│   ├── security.md
│   ├── roadmap.md
│   └── adr/
├── tests/
├── .env.example                    # Placeholders only
├── package.json
└── README.md
```

Repository-wide conventions:

- File and package naming conventions; TypeScript strict mode.
- All exposed inputs validated with shared schemas.
- Codeowners/review requirements for platform auth, infrastructure, deployments, and AI policy.
- Credentials in secret stores and VPS-only env files, never committed.
- Test customers/sites use fabricated data only.
- No customer site may circumvent the content/protection contract by exposing arbitrary production write endpoints.

---

## 7. Tenants, sites, and database design

### 7.1 Entities and relationships

- `users`: global accounts with ID, email, password hash / auth provider, status, MFA state, timestamps.
- `platform_memberships`: user, staff role, privileges, status.
- `tenants`: customer companies; name, status, contact metadata, created/updated timestamps.
- `tenant_memberships`: user, tenant, role; optionally restricted to specific sites.
- `sites`: tenant ID, slug, source package path, status, template/integration version, published artifact, locale/timezone, website settings.
- `site_memberships`: grants to specific sites, role; unique and indexed.
- `domains`: hostname, site, purpose (`public`/`admin`), status, DNS verification, TLS readiness, redirects/canonical flag.
- `plans`: subscription tier definitions and default feature entitlements.
- `subscriptions`: tenant/site linkage, status, cycle, manual/payment-system reference.
- `feature_definitions`, `site_feature_overrides`: durable feature flags with override precedence and auditing.
- `site_ai_budgets`: per-site USD cap, billing period, overrides, effective status.
- `ai_usage_ledger`: site, job, model/provider, token usage, priced estimates/actuals, timestamp, allocation.
- `pages`: site, route, page type, locale, canonical metadata, editable schema.
- `sections`: page, component type, order, editable field values, schema version.
- `fields`: stable field IDs, type, current value/ref, AI mode, protected classification, provenance, update timestamps; actual relational vs JSON implementation may vary.
- `business_facts`: structured verified factual values, e.g. phone, opening hours, prices, address, legal/offer terms; protection and verification metadata.
- `assets`: site, storage key, content type, byte size, hash, alt text, attribution, dimensions, uploader, integrity checks.
- `content_revisions`: immutable before/after snapshot/diff, actor, origin, reason, validation results, source/deployment references.
- `change_proposals`: site, target field IDs, original revision, proposed value, explanation, confidence, review status, expiry/dedupe key, reviewer.
- `seo_audits`, `seo_findings`: site/page, severity, evidence, status, measured dates.
- `aio_audits`, `aio_findings`: site/page, criteria/method, evidence and limitations.
- `jobs`, `job_runs`: type, site, payload refs, status, dedupe key, attempts, timings, error category, budget allocation.
- `scheduled_policies`: site, job type, cadence, timezone, enabled, constraints, last/next attempt.
- `deployments`: git SHA, artifact version, sites affected, started/completed status, health checks, rollback target.
- `integration_connections`: site/tenant, integration type, scopes, status, credential reference (not secret), expiry, sync cursor.
- `metrics_snapshots`: source, site, reporting window, ingestion timestamp, metric type, provenance.
- `alerts`: site/tenant/global, level, fingerprint, opened/resolved state, dedupe, links to jobs/deployments.
- `audit_events`: identity/service, action, scope, target, before/after metadata, timestamp, trace ID.

### 7.2 Database constraints and isolation

- All site-scoped rows must contain `site_id` and/or an unambiguous path to `tenant_id`; use composite foreign keys where applicable.
- Enforce referential integrity to prevent a site referencing another tenant's page, asset, proposal, or job.
- Use scoped queries and RLS as defense-in-depth; never trust caller-supplied tenant IDs without membership checks.
- Unique normalized domain hostname across all sites. Unique site slug for source mapping. Unique membership per user/site/role where appropriate.
- Index common queries on `(site_id, created_at)`, `(site_id, status)`, `(tenant_id, site_id)`, `(job_type, next_run_at)` as needed.
- Immutable ledgers, content revisions, deployment history, and audit records where possible; record corrections as new events rather than silently mutating history.
- Sensitive data encrypted where appropriate and redacted from ordinary logs.
- All migrations reviewed and backward-compatible with current live workers/services; backup prior to destructive changes.

### 7.3 Example effective policy precedence

```text
SYSTEM_NON_OVERRIDEABLE_RULES
    > PLATFORM_EMERGENCY_KILL_SWITCHES
    > ORAP_PER_SITE_OVERRIDES
    > PLAN_ENTITLEMENTS
    > CUSTOMER_FIELD_PREFERENCES
    > SAFE_DEFAULTS
```

For content editing, a customer's per-field selection applies only when system protections and ORAP permissions allow it. ORAP can prevent automatic rewriting of a site entirely. No role, including platform owner through the normal AI pipeline, can enable AI modification of immutable protected facts; manual staff/customer editing follows explicit separate business-data workflows and audit trails.

---

## 8. Site integration contract and starter template

### 8.1 Requirement

Every site built by a team developer must register its pages, editable fields, content schema, protected facts, rendering/build entrypoint, SEO metadata hooks, and build/preview health checks in a standard manifest. A unique visual design is permitted, but editor integration is explicit—not inferred by AI parsing arbitrary DOM markup.

### 8.2 Illustrative manifest (contract, not final syntax)

```ts
export const omniSite = {
  contractVersion: 1,
  siteSlug: 'restaurant-example',
  framework: 'astro',
  routes: [
    {
      path: '/',
      component: 'HomePage',
      sections: [
        { id: 'home.hero', type: 'hero', fields: [
          { id: 'home.hero.title', kind: 'text', ai: 'auto', customerEditable: true },
          { id: 'home.hero.description', kind: 'richtext', ai: 'auto', customerEditable: true },
          { id: 'home.hero.image', kind: 'image', customerEditable: true },
        ] },
        { id: 'home.hours', type: 'business-hours', factsRef: 'business.hours', ai: 'protected' },
      ],
    },
  ],
  build: { command: 'npm run build', outputDirectory: 'dist' },
  preview: { enabled: true },
};
```

No true secrets, tenant identifiers, or business facts are hardcoded in the manifest. Site-specific content and facts are loaded from approved snapshot data. The contract is type-checked and validated in CI before a new site is deployable.

### 8.3 Field types and editing constraints

Support initially: plain text, limited rich text, image, button label/link, cards/list of items, SEO description, selected colors/theme values, visibility, and reorderable known sections. Rich text must be sanitized with a strict allowlist; links validated against allowed schemes. Images are scanned/validated for type, size, dimensions and dangerous payloads. Support accessible alt text.

Customers may edit fields exposed in their site contract; they cannot directly change arbitrary HTML, JavaScript, security headers, form destinations, tracking IDs, or business backend logic. Structural changes are limited to developer-defined safe operations. For a fully custom site not yet integrated, editing is disabled until the developer supplies and tests the contract.

### 8.4 Starter site

The starter reference project should be a fictional restaurant with homepage, about, menu, contact, privacy page, sitemap, robots rules, structured business data, reusable sections, responsive layouts, accessibility semantics, and sample metadata. All content must be fake and conspicuously marked as example. The starter demonstrates the editor schema, preview, build artifact, safe content rendering, and SEO/AIO audit compatibility.

### 8.5 Source, runtime data, and media

- Git tracks components, templates, site manifest, tested migrations, and other source artifacts.
- PostgreSQL tracks approved live content and revision history; content is not edited in the production Git checkout.
- An object storage abstraction stores images and media under site-isolated paths; browser-accessible URLs are derived through validated services.
- A site build records its **code SHA + content revision ID + asset manifest hash** so every deployed version is reproducible.
- Optional Git content snapshots use a bot-authored dedicated export branch/path or manual PR, with no production deployment trigger; never silently commit into `main` from the VPS.

---

## 9. Customer admin: `admin.<domain>`

### 9.1 Routing and DNS

For a domain like `example-restaurant.com`, Caddy routes `example-restaurant.com` and optionally `www.example-restaurant.com` to public site artifacts, and `admin.example-restaurant.com` to the shared customer-admin application. The app resolves the canonical verified host to exactly one site. DNS/Cloudflare and TLS setup must be verified before activating a domain; catch unavailable certificates and invalid records in ORAP.

For domains already involving `admin` or unusual structures, support an explicit admin-hostname mapping rather than naive string concatenation. Avoid wildcard session-cookie sharing and dynamic domain registration from untrusted input.

### 9.2 Default customer dashboard

- Site health and current publication status.
- Performance summary: Search Console clicks/impressions/CTR/average position when connected; GA4 traffic when connected; explain missing data and time ranges.
- SEO issues and resolved findings, prioritization and recent changes.
- AIO improvement activity and any supported visibility indicators; clearly disclose what is estimated or unmeasured.
- Pending change suggestions, decision history, notifications.
- AI text-autonomy status and customer-allowed toggles, constrained by ORAP.
- Link to content editor and revision history.
- Optional team/user area if enabled by ORAP.

### 9.3 Editor workflow

1. Customer opens a page/section and sees form fields alongside a preview.
2. Customer edits allowed text/images/links/section ordering; save draft with conflict protection (`revision` or `ETag`).
3. Validate inputs, references, known business facts, and output HTML; show warnings and preview.
4. Customer publishes (if role allows) or requests review (if configured).
5. Publisher builds/refreshes the appropriate artifact, checks health, atomically switches, and records revision/deployment.
6. Errors preserve previously working live version; show a friendly status and raise ORAP alert.

Provide autosave drafts only with clear draft vs published states. Customer admin should have no raw code editor in V1. Define media ownership and removal policies; deleting an image from editor should not immediately remove an image used by current published artifacts.

### 9.4 Suggested AI changes UX

If eligible text has **Auto-Optimize disabled**, the effective mode becomes **Suggest Changes**. Show a dashboard notification and a review panel/pop-up with original text, proposed text, concise rationale, associated page, timestamps, and actions: `Accept`, `Reject`, `Edit proposal`, `View preview`. Do not force modal pop-ups on every login; deduplicate and batch notifications. A suggestion is never published until authorized acceptance, and must revalidate against the latest field revision before publishing. Stale suggestions require regeneration/review.

### 9.5 Historical revisions

Customers and staff can review and restore prior published text/media revisions within permissions. Restoration must re-run validations, preserve protected facts, and create a new revision event rather than erasing history. Include who/what changed it (`customer`, `staff`, `seo-worker`, `aio-worker`) and whether it was automatic, approved suggestion, or manual.

---

## 10. ORAP: OmniReach Admin Panel

### 10.1 Navigation and major modules

- **Overview:** sites online, incidents, failed automation, AI spend, deployment health.
- **Customers & sites:** tenants, sites, domains, credentials/status, site staff, subscriptions.
- **Site controls:** feature flags, site policy, AI field editing overrides, site disable/maintenance, crawl budgets.
- **SEO/AIO:** audits, findings, optimization history, proposals, enable/suspend individual modules.
- **Usage & plans:** plan entitlements, active site budget, spend ledger, estimated monthly usage.
- **Domains & integrations:** Cloudflare DNS state, HTTPS, Search Console, Analytics, connection health.
- **Jobs & schedules:** queued/running/retried/failed/cancelled, throttling, schedules, replay under permission.
- **Deployments:** Git SHA, affected sites, build status, previews, rollbacks, logs.
- **Alerts:** severity, ownership, acknowledged/resolved, site scope, fingerprints, remediation links.
- **Users & roles:** platform employees, customer logins, creation, disable/reset, scoped rights.
- **Audit trail & settings:** sensitive actions, retention, backup state, platform policy.

### 10.2 Plan and per-site feature model

Plans define defaults for SEO/AIO module access, schedule frequency, content edit permissions, customer seats, reporting, and AI budgets. Site-specific ORAP overrides take precedence over tier defaults within absolute platform safety limits. Override changes must explain reason, actor, effective time, and whether existing scheduled jobs should be cancelled.

V1 may track billing status manually. Future subscription processor integration should not require changing the policy model. Nonpayment behavior must be explicitly configured; avoid silently deleting content or domains.

### 10.3 AI budgeting

Default monthly cap: **$5 USD per site**, editable in ORAP, in billing timezone/period. Cost accounting is site-scoped and append-only. Use provider-reported usage when available and a configurable current price table for estimates. Reserve a conservative estimated cost before running a job; reconcile actual cost after. Gate expensive work if reservation exceeds remaining budget. Stop/requeue noncritical AI work on cap, alert staff, and preserve uptime/non-AI checks. Retries and failed calls may incur cost and must be charged when known. Enforce queue-side caps to avoid simultaneous jobs spending the same remaining balance.

Do not silently spend platform-wide unallocated money. Track shared overhead separately. Pricing tables and model selectors should be configurable because API costs change.

---

## 11. SEO automation

### 11.1 Deterministic crawler

Use site-specific rate limits and a bounded crawl budget. Discover pages from site manifest, sitemaps, and internal links. Respect robots directives for external URLs and use authorized fetches for owned sites. For external resources, disallow private, loopback, link-local, metadata-service addresses and redirects to them (SSRF protection); strictly limit redirects, protocol, payload size, timeouts, and concurrency.

Capture response status, canonical, robots directives, titles, meta descriptions, headings, link graph, image alt attributes, sitemap membership, structured data, render status, and selected performance signals. Deduplicate canonical URLs and avoid infinite parameter spaces. Record crawl source, timestamps, and scope.

### 11.2 Technical checks

- Missing/duplicate page titles and descriptions; length heuristics not hard ranking guarantees.
- Invalid/unexpected canonical URLs and redirect chains.
- Broken internal links, 4xx/5xx pages, sitemap inconsistencies.
- Indexability and robots/meta robots conflicts.
- Incorrect or missing structured data types and required properties.
- Missing image alt text where applicable; oversized media / accessibility warnings.
- Missing HTTPS, mixed content, bad security headers where relevant.
- Mobile usability and performance opportunities based on measured tools.
- Internal link orphaning/weak discoverability.
- Local business facts consistency across site and verified source records.

### 11.3 Safe automatic fixes

Deterministic changes that are within registered site fields/configurations can be automated after validation: canonical tags, sitemap and robots generation, broken internal links to known replacements, metadata for eligible fields, alt text suggestions for unprotected media, valid structured data from verified facts. Never fabricate a missing address/hours/prices or alter URLs affecting commerce without confirmed mappings. Changes must pass pipeline gates.

### 11.4 Content SEO

Analyze existing copy, title/heading semantics, search terms from authorized Search Console, page intent, repetition, and information completeness. Prioritize helpfulness to the visitor over keyword stuffing. Produce scoped field-level proposed changes and measure impact over time where feasible. Do not claim that any automated change ensures a ranking gain.

### 11.5 Reporting

Every audit reports: collected evidence, issue severity, method/version, proposed action, change status, validation, date, and confidence or limitations. When Google integrations are absent, explicitly label metrics `not connected` rather than fabricating values.

---

## 12. AIO / AI-search optimization

Here **AIO** refers to improving the likelihood that accurate customer business information can be understood and used by AI-assisted search/discovery systems. It is not guaranteed placement in ChatGPT or other models.

### 12.1 Core techniques

- Well-structured, accurate, discoverable content answering common customer questions.
- Semantic headings and clear page purpose.
- Valid structured data appropriate for local business/restaurant context, always sourced from verified facts.
- Consistent name, address, telephone and hours where supplied.
- Meaningful FAQs where accurate and useful, not mass-generated filler.
- Authorship, business identity, contact, location and service descriptions when verified.
- Crawlability and indexability compatible with business preferences and platform policies.
- Source links/citations only where actual reliable sources justify them; avoid invented testimonials or claims.
- Transparent reporting of AIO activities; limited confidence around external attribution.

### 12.2 Measurement

Record measurable proxies (structured data validity, crawlability, content completeness, qualified citation/surfacing tests when supported and lawful) separately from observed AI referral traffic. If measuring AI mention results by sampled prompts, record prompts, model/provider, geography/time, repeatability and sampling limitations. Do not show proprietary black-box 'AI ranking' values as established facts.

### 12.3 Content integrity

OpenAI-generated changes must be grounded in existing approved content and verified business facts. For unverified claims, request human verification instead of guessing. Respect protected spans and field-level AI policy. Never invent prices, guarantees, awards, hours, reviews, affiliations or other material claims.

---

## 13. Field-level AI autonomy and protected facts

### 13.1 Three effective modes

1. **AUTO** (default only for eligible marketing fields): AI may propose, validate, publish, and roll back a field change autonomously.
2. **SUGGEST** (when customer switches auto-edit off): AI can generate a reviewable proposal; cannot publish without authorized acceptance.
3. **PROTECTED** (nonoverrideable for facts): AI may neither rewrite nor suggest replacement of the factual value. Human edits use a dedicated controlled workflow.

Each field has stable ID, editor type, policy mode, `customer_editable` permission, data classification, validators, provenance, and revision. Site-level ORAP kill switches can globally force eligible AUTO fields into SUGGEST or disable generation. Only site policies permitted by ORAP are exposed to customers.

### 13.2 Protected categories (minimum)

- Prices, fees, deposits, discounts, taxes, shipping amounts, menu item prices.
- Opening hours, dates, event times, address, phone, email, map coordinates.
- Legal disclaimers, privacy policies, contracts, warranties and terms.
- Product/service availability, inventory, booking and ordering conditions.
- Licenses, certifications, awards, guarantees, medical/safety claims, regulated claims.
- Verified business identity and factual attribution, customer testimonials/reviews.
- Any owner-designated critical text or fact, or schema derived from these facts.

**Protection applies inside paragraphs too.** A marketing paragraph containing `$19.99`, a phone number or factual claim must not be blindly regenerated as an unconstrained blob. Either protect the entire field or use verified immutable fact tokens/structured placeholders in an otherwise editable template. Automated validation must reject changes that remove, modify, contradict, or duplicate protected facts. Use deterministic comparisons and structured contracts; LLM self-check alone is insufficient.

### 13.3 Safe field-change pipeline

```text
Selected site + field + current revision
 → Effective policy evaluation
 → Protected facts context from verified structured records
 → OpenAI structured proposal (never direct DB mutation)
 → Schema, scope, fact, link, tone, legal, accessibility validation
 → Compare against current revision / detect conflict
 → If AUTO: staging render → test → publication transaction
 → If SUGGEST: save proposal + customer notification
 → If PROTECTED: reject with audit event
 → Record usage, outcome, and rollback pointer
```

Revalidate at **acceptance time** and **publish time**, even if already validated during generation. Never publish stale drafts over newer customer changes. Use atomic compare-and-swap/version predicates and idempotent publishing requests.

### 13.4 Customer interaction

Default toggle is ON for each eligible marketing text field. Turning it OFF means **suggest only**, not “do nothing.” The editor clearly shows field mode. Auto changes appear in change history with instant preview and rollback when safely possible. Suggestions can be accepted, edited or rejected. Important information remains manually editable by authorized humans where appropriate but AI cannot change it.

---

## 14. OpenAI integration and AI agent design

### 14.1 Provider client

All AI calls pass through a single `packages/ai` abstraction with model configuration, timeout, max output, retry policy, tool allowlist, JSON schema validation, logging, rate limiting, and cost ledger. Use OpenAI API through official SDK; credentials live only on trusted server side. Do not put API keys in public sites, customer-admin client bundles, GitHub files, or build logs.

### 14.2 Agent responsibilities

Agents should work on **bounded tasks**, e.g. `reviewMetadata(pageId)`, `suggestHeading(fieldId)`, `proposeFAQ(pageId)`, `classifyFinding(findingId)` and return typed proposals. The orchestration layer, not the model, owns authorization, context retrieval, validation, side effects, and deployment.

Keep deterministic code responsible for price/fact protection, URL validation, schema correctness, domain operations, billing checks, tenant isolation, data persistence, and rollback. No autonomous shell access and no generic production SQL tool for agents.

### 14.3 Prompt-injection and hostile input

Treat crawled webpages, customer-entered text, third-party documents and tool outputs as untrusted data. Text such as “ignore prior instructions” has no authority. Strip or isolate untrusted instructions, pass minimal scoped context, enforce output schemas and server-side validation. Workers must not follow user-provided links into internal networks and must not execute page scripts outside sandboxed, time-limited browser environments.

### 14.4 Cost and quality gates

- Per-site monthly allocation, queue reservations, concurrency-limited OpenAI calls.
- Prefer cheaper models for constrained classification and reserve more expensive models for complex analysis when budget permits; ORAP can configure policies.
- Cache repeated deterministic analyses where safe; do not cache across tenants with sensitive data.
- Require nonempty evidence and rationale on proposals.
- Run regression and fact preservation checks before publication.
- Record model identifier and prompt/template version for reproducibility, without unnecessarily retaining sensitive full prompts.

---

## 15. Queueing, schedules, and workflows

### 15.1 Queue categories

- `crawl-site`, `audit-seo`, `audit-aio`, `fetch-search-data`, `fetch-analytics`.
- `generate-proposal`, `validate-change`, `publish-content`, `build-site`, `deploy-site`.
- `sync-domain`, `check-cert`, `check-site-health`, `clean-artifacts`, `backup`, `alert-delivery`.

Each job payload contains opaque identifiers and a safe schema; fetch authorized data server-side. Never put API credentials or large private content in Redis queue arguments. Jobs identify site and policy version, dedupe key, trace ID, max cost, attempt count, and expiry.

### 15.2 Execution rules

- Recurring schedules stored in PostgreSQL; scheduler puts deduped work into BullMQ.
- Concurrency caps per worker type and per site; one publish operation per site at a time.
- Retries with exponential backoff and jitter for transient failures; classify permanent failures without endless retries.
- Timeouts, cancellation, job leases, stalled job recovery and dead-letter/failure states.
- Recheck feature enablement, site status, budget and current content revision when a queued job begins.
- Safe idempotency keys for repeated webhooks, schedule ticks and deploy triggers.
- Shutdown drains or safely retries work; avoid duplicate publication after crash.
- Job observability: queued/running/succeeded/failed/skipped/cancelled; failure reason and trace.

### 15.3 Baseline frequencies (editable policy defaults)

- Uptime: lightweight checks regularly, e.g. every 5–15 minutes without AI.
- Technical SEO: weekly or after deployment, within crawl budget.
- SEO/AIO content review: weekly/monthly depending on plan, site size, budget.
- Google data: daily if connected and quotas permit.
- Robots/sitemap/cert domain checks: upon deployment and periodic verification.
- Full backups: daily, with daily restore validation / periodic manual restore drills.

Avoid defaulting every customer to a high-cost daily OpenAI audit if it conflicts with the $5 cap.

---

## 16. Publishing and runtime deployment

### 16.1 Separate code deployments from content deployments

**Code deployment:** GitHub `main` push builds and tests code/site components, then deploys versioned artifacts to production. **Content publication:** Customer/staff/AI approved edits create versioned content snapshots and rebuild only the affected site (or update a validated content endpoint where the site contract explicitly supports it). Content publishing must not create uncontrolled Git writes or trigger recursive CI runs.

### 16.2 GitHub Actions workflow

- Trigger production only on `push` to `main` and optionally a separately permissioned manual recovery action.
- On feature/test branches: run lint/typecheck/test/build preview; no VPS production deploy.
- Use pinned workflow actions, least-privilege `GITHUB_TOKEN`, restricted repository secrets and protected `main` branch (reviews, required checks).
- Action SSHs to VPS with a **dedicated non-root deploy account** and tightly scoped key; verify SSH host key; private key resides in GitHub Actions secret store.
- On VPS, use a controlled deploy script, not `curl | bash` or arbitrary remote repo hook.
- Fetch an exact verified commit SHA; verify branch ancestry and optionally signed artifacts. Do not `git pull` into an actively edited production checkout, and never force-push.
- Serialize deployments with lock; handle repeated pushes by queuing/latest-SHA choice, not concurrent overlapping builds.
- Resolve affected workspaces/sites where practical; build/test before switching live version.
- Take migration/backup precautions; ensure backward-compatible schema changes.
- Stage release under versioned path; perform checks; atomically switch release/symlink or reverse proxy target; confirm HTTP health/headers/content.
- On failure, automatically revert pointer to previous healthy version and alert ORAP; schema migrations that cannot roll back require explicit safe migration plan.
- Preserve deployment event with exact commit, actor, timestamps, release ID and logs.

### 16.3 Caddy and Cloudflare

Existing Caddy serves other workloads; avoid replacing its compose project, networks or ports. Inspect existing config before any edits and apply minimal additions. Stage/test Caddyfile and reload only after validation. Customer domain onboarding requires Cloudflare API token with narrow scopes, records/verification, certificate readiness, correct redirect policy, and an admin subdomain. DNS TTL and propagation are asynchronous; show meaningful status rather than claiming immediate readiness.

### 16.4 Git export requirement

The owner requested that changes made on the VPS be committed to GitHub so the repo remains current. Implement this intent **without** making production the source-code authoring environment:

- Developers change site **code** in branches, merge to `main`, and GitHub Actions deploys it.
- Customer/AI changes to **content** are recorded immediately in PostgreSQL with revisions and backed-up assets.
- A future export job can write **sanitized, nonsecret content snapshots** to a dedicated bot branch or artifact/PR; it must not trigger `main` deployment or overwrite developer changes.
- If production operators need to change code, the workflow is branch/PR and review, not automatic `git add . && git push main` from VPS.

This is an intentional architecture correction to avoid infinite CI loops, secrets leakage, lost customer edits and unreviewed source mutation. Any stronger requirement to persist every content change directly to Git must be explicitly revisited with a conflict/merge design.

---

## 17. Infrastructure sizing and service layout

### 17.1 Current VPS context

At planning time: Ubuntu 24.04.4 LTS, Docker 29, Compose v5, 2 CPU cores, 7.8 GiB RAM, 4 GiB swap, ~85 GiB free disk. The remaining existing services are Christians Reunite API, website and PostgreSQL, plus shared Caddy. These services must remain available.

### 17.2 Initial containers (logical)

- `omnireach-postgres` (private backend network, named persistent volume).
- `omnireach-redis` (private backend network, persistent if job resilience warrants; enforce authentication).
- `omnireach-api` (internal network; routed only as needed).
- `omnireach-orap` (behind Caddy).
- `omnireach-customer-admin` (host-based routing behind Caddy).
- `omnireach-worker` (shared worker runner with capped concurrency).
- `omnireach-scheduler` (single active scheduler with lease/lock).
- `omnireach-sites` (static web/artifact serving; site-specific host mapping).

A simplified deployment may colocate compatible processes at first, but keep code boundaries clean. Do not expose database/Redis ports to the internet. Apply Docker health checks, restart policy, CPU/memory limits, non-root processes where feasible, and read-only filesystems for static apps.

### 17.3 Resource control

- Start with one worker and very low crawl/browser concurrency; never run many Playwright instances simultaneously on 2 cores.
- Avoid unnecessary always-on SSR processes per customer site.
- Rate-limit Google/OpenAI calls and large builds; stagger schedules across tenants.
- Leave headroom for Christians Reunite and system overhead.
- Monitor RAM, disk, swap, CPU, queue wait, container restarts, and backup size.
- Alerts for disk approaching limits and runaway logs/asset uploads.

### 17.4 Migration path

Keep Postgres connection settings, object storage, queues, workers and artifact publisher behind stable adapters. Later move workers to a separate machine or hosted compute, media to S3-compatible storage, and optionally site artifacts to CDN/static hosting. Preserve tenant IDs, revision references and deployment protocols.

---

## 18. Security and privacy baseline

### 18.1 Threat model

Assume malicious customer content, compromised customer passwords, misconfigured domains, agent prompt injection, webhook replay, credential leaks, cross-tenant access attempts, malicious uploads, SSRF in crawlers, supply-chain dependency compromise, and deployment errors. Assume AI output may be confidently wrong.

### 18.2 Required controls

- HTTPS everywhere; secure session management; MFA for ORAP admins.
- Least-privilege roles, non-root deploy account, scoped Cloudflare/Google tokens, strict database grants.
- Tenant scoping, relational integrity and RLS tests; never solely trust API paths.
- Server-only OpenAI key and platform secrets; audited rotation process.
- Signed/verified webhooks and state/nonce checks on OAuth flows.
- Upload controls: MIME/file-signature validation, byte/dimension limits, isolate/scan risky files, safe filenames, SVG restrictions.
- Prevent XSS in richtext, previews, site templates and admin dashboards; enforce CSRF where needed.
- Prevent SSRF, open redirects and DNS rebinding in crawling and user-supplied URL fetches.
- Production CSP and security headers tailored to actual website dependencies.
- Dependency scanning, container patching, basic vulnerability remediation cadence.
- Error reporting redacts passwords, tokens, API keys, session cookies, personally identifying content.
- Audit admin user changes, feature switches, content publications, AI proposals, domain operations, access overrides and deploys.
- Baseline privacy practices: data minimization, retention periods, consent for analytics, applicable privacy disclosures and deletion workflows determined before live onboarding.

### 18.3 Public GitHub repository safeguard

Repository may be public. **Do not commit real customer records, private site secrets, `.env` files, private credentials, exports containing sensitive content, database backups, or real customer asset originals when not intended public.** CI should scan for secrets and block obvious leaks. Public source code is not a security boundary; every API must enforce authorization.

### 18.4 Employee access and operations

Enforce separate personal accounts, no shared platform credentials; two-person review for sensitive infrastructure changes if team size allows. Provide an emergency incident runbook: disable automation, freeze publishing, roll back release, revoke keys, restore content/database and notify affected parties.

---

## 19. Backups, recovery, and retention

### 19.1 Minimum initial plan

- Nightly compressed PostgreSQL logical backup, tested for completeness; keep seven daily versions locally subject to disk headroom.
- Backup original customer uploads and site asset manifests (incremental/versioned if possible).
- GitHub provides code history, **not** customer runtime data recovery.
- Record backup times, checksums, sizes and alert on failure or missing backups.
- At least periodically test restoring into an isolated temporary environment, including schema compatibility and asset references.
- Maintain a simple off-server encrypted copy as an early production prerequisite (e.g., inexpensive object storage). On-server-only backups do not protect against disk/VPS loss.

### 19.2 Retention and restore

Define document retention by data type and customer agreements before launch. Restore procedures must preserve tenant boundaries, secrets handling, media links, domain mappings and version tracking. ORAP should show latest successful backup and restore-test date. Do not prune active volumes or backups using indiscriminate Docker cleanup commands.

---

## 20. Monitoring, alerts, and reporting

### 20.1 Health signals

- Public site uptime/status and sampled page content checks.
- API/ORAP/customer-admin liveness and readiness.
- Domain DNS + certificate expiration/readiness.
- Queue depth, job age, failure rates, stalled workers.
- OpenAI/provider error rates, cost and budget exhaustion.
- Crawl coverage and audit errors.
- Deployment build/test failures and rollback events.
- Database connectivity, available disk space, backup outcome.
- Expired/revoked Google authorization and stale data.

### 20.2 Alert lifecycle

Each alert has fingerprint, severity (`info`, `warning`, `critical`), affected scope, first/last observed, acknowledgment/assignee, remediation link, resolved time and deduplication. ORAP owns the full incident view. Customer dashboards receive only appropriate customer-facing site incidents. Prevent repeated alerts from flooding dashboards. Later notification channels (email/SMS/chat) can be added behind an alert adapter.

### 20.3 Reporting integrity

Distinguish “work performed” from “measured impact.” Store metric source, measurement date/window, and attribution caveats. Show missing integrations and data delays, not zero values presented as facts. Never label suggested but unpublished changes as completed optimizations.

---

## 21. Suggested API surface (subject to schema review)

Version all external endpoints, e.g., `/v1/`; use validated typed requests and stable error codes. Illustrative paths:

| Method | Path | Scope |
|---|---|---|
| `POST` | `/v1/auth/login` | User sign-in / session |
| `POST` | `/v1/auth/logout` | Revoke session |
| `POST` | `/v1/auth/password-reset/request` | Safe recovery |
| `GET` | `/v1/me` | Identity and memberships |
| `GET/POST` | `/v1/orap/tenants` | Platform authorized |
| `GET/POST` | `/v1/orap/sites` | Platform authorized |
| `PATCH` | `/v1/orap/sites/:siteId/features` | Feature override + audit |
| `PATCH` | `/v1/orap/sites/:siteId/ai-budget` | Budget controls |
| `GET/POST` | `/v1/orap/sites/:siteId/users` | Site memberships |
| `POST` | `/v1/orap/sites/:siteId/automation/stop` | Emergency stop |
| `GET` | `/v1/customer/dashboard` | Host-resolved site + member |
| `GET` | `/v1/customer/pages` | Site content editor |
| `PATCH` | `/v1/customer/fields/:fieldId` | Expected revision required |
| `POST` | `/v1/customer/drafts/:draftId/publish` | Publish authorization |
| `GET` | `/v1/customer/proposals` | Pending suggestions |
| `POST` | `/v1/customer/proposals/:id/accept` | Revalidate + publish |
| `POST` | `/v1/customer/proposals/:id/reject` | Record decision |
| `GET` | `/v1/customer/history` | Site revisions |
| `GET` | `/v1/orap/jobs` | Worker states |
| `GET` | `/v1/orap/alerts` | Incidents |
| `POST` | `/v1/orap/deployments/:id/rollback` | Privileged restore |

Enforce `site_id` and domain context from authenticated server-side resolution; customer endpoints must not permit choosing an arbitrary site in query arguments. Add pagination, idempotency tokens, conditional updates and rate limits. Error messages must not disclose another tenant's existence or data.

---

## 22. UI/UX and accessibility requirements

- Separate visually recognizable ORAP and customer admin experiences, shared base design system where appropriate.
- Responsive layouts for desktop/tablet/mobile; keyboard-accessible controls and clear focus states.
- Dashboard first on customer admin login, editor as distinct navigation section.
- Live preview in editor with draft/published distinction; mobile and desktop preview modes as resources permit.
- Clear feature status: enabled by tier, ORAP override, disabled, suggestion-only, protected.
- Search/filter for sites, alerts, jobs and audit findings.
- Accessible form labels/errors, contrast, alt text, logical headings and confirmation flows for destructive actions.
- Never show a fake success state before API transaction/deployment has completed.
- Avoid unnecessary modal interruptions; actionable suggested change cards and notification badges are preferred.
- Site and customer content should preserve Unicode, safe formatting and timezone-aware hours.

---

## 23. Test strategy and non-negotiable acceptance gates

### 23.1 Automated test layers

1. Unit: schema validators, policy precedence, protected fact checker, cost budget logic, URL canonicalization, queue dedupe.
2. Integration: PostgreSQL migrations, site isolation, RLS, authorization, save/publish transaction, queue replay, API error contract.
3. Contract: starter site schema, manifest validity, editable field IDs, protected data references, static render.
4. E2E: ORAP onboarding, customer login at mapped admin host, content edit preview/publish, suggestion acceptance, rollback.
5. Security: cross-tenant access, SSRF, XSS, CSRF, upload payloads, replay, missing permissions, leaked secrets.
6. Deployment: main-only trigger, staged release, unhealthy build rollback, unchanged Christians Reunite.
7. Load/smoke: ten small sites, regular audits, one or two worker jobs, published pages stay responsive.

### 23.2 Acceptance scenarios

**A. Multi-tenant isolation** — A customer for Site A cannot read or modify Site B through API paths, admin hostname tricks, asset references, or worker job payloads.

**B. Customer editor** — Authorized users can edit a supported homepage heading/image and publish. Public page updates and prior revision stays recoverable. Unsupported layout code cannot be modified.

**C. Protected facts** — In a field containing a menu price and text, AI may never change the price, even when phrased as an optimization request, regardless of model output, manual ORAP feature switch or customer editing policy.

**D. Suggestions** — Turning auto-edit OFF for a heading generates an approval-needed proposal but never automatically publishes. Acceptance revalidates content and handles revision conflicts.

**E. Autonomous mode** — Default eligible field can safely auto-optimize after passing schema, fact, staging and publishing checks; otherwise no change publishes and an actionable alert exists.

**F. AI budget** — A $5/site monthly cap prevents queued concurrent AI jobs from overspending beyond configured tolerance, records provider charges, and does not block site availability.

**G. Main deploy only** — Push to test branch does not deploy. Push to `main` produces a traceable SSH deployment. Broken release rolls back; current public pages remain functional.

**H. Existing workloads** — None of onboarding, builds, or failover interrupts existing Christians Reunite services or shared Caddy without a reviewed change.

**I. Domain onboarding** — Verified public and `admin.` hostnames route to correct site/admin contexts, with correct TLS and no cross-site session leakage.

**J. Observability** — Failed job, expired integration, unhealthy deployment, exceeded budget and backup failure produce appropriately scoped ORAP alerts.

**K. Recovery** — Restore a Postgres backup and media assets in isolation and recover a previously published site version with documented instructions.

**L. Analytics honesty** — No Search Console/Analytics connection shows a transparent “not connected” state rather than invented numbers.

---

## 24. Implementation roadmap for Codex decomposition

Codex should convert the phases below into smaller goals with explicit dependencies, touched components, definition of done, commands/tests, manual verification, and rollback. Do **not** implement all phases in one giant unreviewed PR. Prefer vertical slices that demonstrate working behavior end to end.

### Phase 0 — Repository discovery and decision log

- Inspect current cloned repo, services and docs, verify directory is correct.
- Produce `docs/roadmap.md`, `docs/architecture.md`, prioritized ADRs, and issues/goal list.
- Inventory existing VPS deployment boundaries using read-only commands; no surprise changes.
- Agree on release/environment naming, hostname for ORAP, secret handling and initial staff login bootstrap.
- Add formatter, lint, tests, CI safety baseline and `.env.example` placeholders.

**Done when:** repository check commands pass, decisions/gaps documented, no production resources altered.

### Phase 1 — Foundational monorepo and dev infrastructure

- Scaffold API, ORAP, customer-admin, starter site and shared packages.
- Dev-only Compose for Postgres/Redis; secure config validation, health endpoints, structured logging.
- Prisma schema baseline/migrations and seeded **fictional** test records.
- Docker builds and local setup scripts; isolate production Compose from dev.

**Done when:** clean local environment boots, migrations run, tests pass, no ports collide with current VPS.

### Phase 2 — Security, tenants and RBAC

- Auth, sessions, password reset, platform/customer roles.
- Site/domain mapping, tenant membership checks, RLS or equivalent defense in depth.
- ORAP admin user creation and customer membership controls.
- Cross-tenant tests and session safety tests.

**Done when:** authenticated Site A user cannot access any Site B resource; staff roles scoped and audited.

### Phase 3 — Site contract and first managed website

- Define/validate integration manifest, content field schema, protected facts storage.
- Build Astro starter restaurant site and site creation registration flow.
- Build content snapshot renderer, persistent asset storage and static artifact server.
- Preview and publish one test site end to end.

**Done when:** a unique test domain/path displays correct content artifact and reproducible code/content version metadata.

### Phase 4 — Customer admin and content editor

- Shared `admin.<domain>` host routing and secure site-resolved sessions.
- Customer dashboard shell, site editor fields/forms, live preview, media upload, safe sections.
- Draft/publish/revision history, optimistic concurrency and basic rollback.
- ORAP editing-access switches and customer accounts.

**Done when:** authorized test customer changes text/image and publishes; forbidden fields remain unavailable.

### Phase 5 — Domains, Cloudflare and stable public routing

- Verified DNS flow, Cloudflare token permissions, public/admin hostname provisioning.
- Caddy route mapping, TLS, redirect and site health; safe config reload.
- Error states for DNS propagation and certificate issuance.

**Done when:** two test sites with separate admin hostnames route securely and without cross-tenant data exposure.

### Phase 6 — GitHub Actions + SSH release pipeline

- Separate `main` production deployment and branch-only CI.
- Dedicated deploy account/key, pinned host key, secret setup documentation, required checks.
- Immutable release staging, health checks, rollback, deploy lock, ORAP deployment history.
- Test trigger behavior and failed-release recovery.

**Done when:** a main merge safely deploys and feature branches do not. Never disrupt Christians Reunite.

### Phase 7 — Queue, scheduler, AI cost ledger

- BullMQ queues and job schemas, idempotency/retries, per-site locks.
- Per-site configurable $5 monthly OpenAI cap with ledger and reservations.
- ORAP job/activity and budget views; scheduler policies.
- Non-AI failure/uptime alerts.

**Done when:** multiple queued test site jobs execute safely within configured budgets and report failures.

### Phase 8 — Deterministic SEO engine

- Safe crawler, sitemap, canonical, headings, broken links, schema, indexing, link graph and media audits.
- Findings model, severity, remediation rules, audit scheduling and ORAP/customer reporting.
- Test no SSRF, no unsupported requests, bounded crawl costs.

**Done when:** deliberate issues on starter site are detected with documented evidence and safe fixes.

### Phase 9 — OpenAI SEO/AIO proposal engine

- Official OpenAI SDK adapter with typed outputs, budget enforcement and logging.
- Field-level modes, protections for prices/facts (including embedded spans), effective policy hierarchy.
- AUTO pipeline with validation and SUGGEST review workflows.
- SEO content improvement and first AIO recommendations with measurable criteria.

**Done when:** protected facts never change, eligible AUTO fields can publish verified revisions and SUGGEST fields cannot publish without approval.

### Phase 10 — Google data and analytics dashboards

- Search Console authentication/property linking and ingestion, GA4 integration where enabled.
- Permissioned dashboards, metric provenance and stale/absent data states.
- Optional Google Business Profile planning only after provider authorization/security design.

**Done when:** authorized connected property populates correct site data and disconnected site shows no fabricated metrics.

### Phase 11 — Operations, backups and production hardening

- Daily compressed backups, off-server encrypted copies, restore runbook/tests.
- Health/alerts, upload and log quotas, metrics, deploy regression tests.
- Ten-site capacity test, resource controls, security review, accessibility checks.

**Done when:** incident, restore and rollback drills pass; services remain responsive at initial scale.

### Phase 12 — Initial customer onboarding

- Train team on integration contract, developer site checklist, content safety and customer permission controls.
- Onboard fictional site then an explicitly approved real pilot.
- Monitor AI spend, job failures, edit conflicts, metrics quality and deployment impact.
- Address findings before expanding to ten sites.

**Done when:** end-to-end pilot passes agreed acceptance checklist and customer communications/policies are ready.

---

## 25. Definition of done for each Codex goal

Each implementation goal should include all of the following:

- Clear scope, files/components, and dependency on previous goals.
- Security considerations including tenant boundaries and protected facts.
- Migration and environment-variable changes where relevant; `.env.example` updated without secrets.
- Automated tests and a precise command list to execute.
- Human-review points for destructive steps, production credentials and live domain changes.
- Documentation and examples for new public contracts/APIs.
- Observability/error behavior and rollback plan.
- Demonstration with fictional test data.
- No regression in existing services.
- Brief completion report: what shipped, tests run, known risks, next dependent goal.

Agents must never report a goal complete solely because scaffolding files exist. Require working tests and at least one end-to-end verification relevant to that goal.

---

## 26. Open decisions and explicit defaults

The owner has made the product decisions in Section 1. The following are **implementation defaults that still require early confirmation or an ADR**, not invented owner commitments:

1. **ORAP hostname:** choose a platform-owned domain/subdomain after the owner supplies the exact domain and DNS location.
2. **Initial admin onboarding:** owner credential bootstrap, MFA rollout and recovery method.
3. **Git publishing:** source deploys from `main`; content history remains in DB. Whether to export sanitized snapshots to a Git branch/PR is optional, and must not imply customer content will always exist on `main`.
4. **Payment collection:** manual bookkeeping initially; a future payment provider is not selected.
5. **Asset storage:** V1 mounted storage is acceptable if backed up and protected; off-server object storage later.
6. **Customer editor:** structured forms plus live preview; not arbitrary DOM editing.
7. **Site publishing:** build only affected site when safe; efficient site artifact serving, not always-on SSR per website.
8. **AI model choice:** configurable OpenAI model IDs and budget reservations; select after cost/quality benchmark.
9. **Metrics:** GA4/Search Console require customer/business permissions and provider enrollment; unavailable integrations show missing data.
10. **Alert delivery:** ORAP first; email/SMS can be added later with explicit provider/consent.
11. **Backup destinations/retention:** daily seven locally plus an off-server encrypted copy before production; tune retention based on actual storage and agreements.
12. **Exact tier definitions:** not decided. Represent as editable config and entitlements; do not hardcode tier pricing or invent benefits.
13. **Customer-subdomain authentication:** separate host-only session cookies and verified host routing; choose exact implementation with threat review.
14. **Dynamic web apps:** custom transactional sites require separate scoped architecture; V1 reference site is static Astro.
15. **Business fact classification:** start conservatively; require explicit staff verification for uncertain field types or mixed marketing/factual text.
16. **Public site domain ownership:** managed with Cloudflare; avoid assuming the full registrar automation API is supported until verified.
17. **Consent/legal requirements:** privacy notices, analytics consent and service terms must be reviewed for operating jurisdictions before live launch.

When encountering a gap, Codex should prefer conservative safety defaults, record the decision, and request approval before irreversible infrastructure changes or adding new paid services.

---

## 27. Codex execution contract and planning instructions

When tasked with planning from this document, Codex must:

1. Read `docs/masterplan.md` in full and inspect current repo state rather than assume it is empty.
2. Write a detailed goal breakdown to `docs/roadmap.md`, grouping work into **small dependency-ordered, independently testable milestones**. Each goal includes objective, prerequisites, deliverables, database impact, validation, rollback, and definition of done.
3. Mark each goal `not started`, `in progress`, `blocked`, or `complete` in a maintainable progress document.
4. Explicitly distinguish product commitments from provisional implementation defaults and raise blocking questions before hard-to-reverse choices.
5. Avoid modifying the production VPS, Cloudflare accounts or GitHub deployment keys while only planning. Such tasks require separate user authorization and relevant credentials.
6. Implement and test one goal at a time, save code to the appropriate branch, and produce a concise completion report and next goal recommendation.
7. Keep code compatible with a public repo. Do not commit real secrets/customer data/backups; add secret scanning.
8. Do not bypass tests, tenant policies, protected-field restrictions or cost gates just to demonstrate autonomous operation.
9. Preserve the existing Christians Reunite services and Caddy. First verify and document any required shared network/proxy change.
10. Design so that 10 initial sites can run on the current resource envelope and more sites can be supported through scaling workers and storage later.

### 27.1 Planning artifacts expected from Codex

- `docs/roadmap.md`: numbered implementable goals, dependencies, acceptance tests and priorities.
- `docs/architecture.md`: system context, data/control flows, key interfaces and deployment topology.
- `docs/adr/`: decisions covering source-of-truth, site contract, tenant isolation, auth/session domains, static publication, deployment method, AI policy and media storage.
- `docs/security.md`: tenant/auth/content/agent threat model and protection checklist.
- `docs/operations.md`: setup, deploy, rollback, restore, monitoring and runbook procedures.
- `docs/integration-contract.md`: developer instructions for adding any custom site to OmniReach.
- `.env.example`: names and documentation for required variables, with no real values.

---

## 28. Final product invariants

These rules are non-negotiable unless the owner deliberately revises this master plan:

1. OmniReach remains **agency-operated**. Customers edit existing managed sites; they do not self-provision sites.
2. All central platform and customer site **code** lives in one GitHub repository.
3. Only verified `main` builds automatically deploy to production via an SSH-based deployment workflow.
4. **Live content is versioned and managed safely**, without a production-server Git push loop.
5. Every website belongs to an identified tenant, and cross-tenant access is prevented at multiple layers.
6. Each customer site gets a site-resolved `admin.<domain>` login, dashboard and supported content editor.
7. ORAP has granular feature, user, budget and emergency controls for each site.
8. AI is **AUTO by default only for eligible marketing text**; toggling auto off creates **suggestions requiring approval**.
9. **AI never changes prices or other protected business facts**, even when those facts appear inside editable marketing paragraphs.
10. Customer manual edits to important information can use a separate authorized and audited workflow.
11. AI acts through validated structured proposals; no unrestricted production editing.
12. Every automatic change is attributed, validated, revisioned, monitored and reversible where technically possible.
13. OpenAI API usage is separately metered and capped per site, initially $5/month/site.
14. SEO/AIO features remain honest about measurable results, data limitations and outcomes.
15. Customer websites remain online if background workers or OpenAI are unavailable.
16. No deployment or cleanup work may casually disturb the preexisting Christians Reunite or Caddy services.
17. Protect secrets and customer information, especially because the GitHub repository may be public.
18. Ship incrementally with testable milestones, not one unchecked autonomous rewrite.

**End of master specification.**
