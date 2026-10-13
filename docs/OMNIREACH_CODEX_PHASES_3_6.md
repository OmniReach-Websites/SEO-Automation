# OmniReach — Codex Execution Goal: Phases 3–6

**Purpose:** Autonomous implementation handoff for the next OmniReach milestones after Phases 1–2: (3) security and disaster recovery, (4) Google integrations and operational reporting, (5) controlled AI/SEO/AIO automation, and (6) commercial readiness and repeatable onboarding.

**Context date:** October 2026. **Companion specification:** `OMNIREACH_CODEX_PHASES_1_2.md`. This document does not override the companion specification or the repository's verified production state. Phase 3–6 work can begin in code before Phases 1–2 finish, but **do not claim operational completion** unless foundational customer editing, controlled publishing, and workers are actually functioning and verified.

## 0. Rules of engagement

1. **Inspect before implementing.** Read `docs/masterplan.md`, `docs/roadmap.md`, `docs/architecture.md`, `docs/integration-contract.md`, `docs/operations.md`, `docs/production-compose.md`, `docs/production-inputs.md`, `docs/security.md`, `docs/release-gate.md` and the actual code in `apps/`, `workers/`, `packages/`, `sites/`, Compose/Caddy and GitHub Actions. Locate renamed files if necessary. Avoid duplicating working subsystems.
2. **Work autonomously on authorized repository work.** Plan, code, document, run local and staging tests, fix issues and update the execution checklist without stopping at each task. If blocked by external input, finish all independent work and explicitly identify the dependency.
3. **No implied production authorization.** Do not rotate real secrets, change live DNS, connect customer Google accounts, enable paid providers, spend money, activate AI, send customer messages, execute destructive migrations, change live subscription states, or deploy to production without appropriate access and explicit owner approval. Build safe scripts, dry runs, runbooks and verification steps instead.
4. **Production claims require production evidence.** Use `Live`, `Implemented`, `Partial`, `Waiting`, `Deferred`. Passing unit tests alone is never grounds to mark a capability Live. Do not fake credentials, account ownership, analytics measurements, backup success or customer enrollment.
5. **Preserve core safety:** static sites remain available independently of API/DB/Redis/workers/providers; public sites are not disabled automatically for nonpayment; tenant identity uses verified hosts/server context; server-side RBAC and PostgreSQL RLS/composite tenant isolation are enforced; secrets never enter logs/git; all content and production changes are auditable, bounded and reversible.
6. **Protected business facts:** approved prices, claims, legal text, phone numbers, service areas, availability, owner-approved narratives and other manifest-protected fields may not be changed by AI or unauthorized users. AI does not execute code, access arbitrary tenants, publish directly or bypass budgets/kill switches.
7. **Don't expand deferred scope** without explicit approval: payment-provider automation, SMS/chat marketing, Google Business Profile, registrar purchasing, e-commerce/reservations, Kubernetes/multi-region, separate worker infrastructure and S3-compatible media migration.
8. Maintain `docs/phase3-6-execution.md` with checklist, blockers, evidence links/commands, test results and explicit `implemented / staging verified / production verified` markers. Update relevant existing roadmaps and runbooks; don't let old 'blocked' notes contradict verified state.

## 1. Prerequisites and target end-state

**Known current state:** Public `omnireach.cloud`, ORAP `admin.omnireach.cloud`, and Coop pilot `coopsmobiledetailingaledo.com` are live. The repository contains authentication, tenancy, content publishing, job, crawler, SEO, AIO, integrations and reporting foundations; many remain only partially surfaced or inactive. Phases 1–2 aim to make Coop fully managed and activate safe production workers. The OpenAI provider defaults to **disabled**; Google OAuth/Search Console/GA4 await real credentials and consent; off-site backups and recovery drills are outstanding; published price tiers are **not approved**.

**Desired end-state:** OmniReach has demonstrated recovery and security controls, validated Google integration paths and truthful reporting, cost-bounded human-reviewed AI recommendations that may be _enabled by an explicit owner decision_, approved commercial policy and a repeatable secure onboarding process for a second tenant. Missing third-party credentials or approvals must appear as `Waiting`, not be concealed by placeholders.

## 2. Phase 3 — Close security, backup and recovery gaps

### 3.1 Customer authentication security UX

- Inventory existing second-factor and passkey functionality for platform vs customer accounts; preserve platform mandatory second-step/owner step-up policy and customer optional-2FA policy unless explicitly changed.
- Complete customer-facing TOTP enrollment, verification, recovery/disabling and account security UI where authorized by existing auth design. Handle replay prevention, rate limits, session invalidation and reauthentication/step-up as appropriate.
- Finish WebAuthn/passkey list, enroll, rename (if supported), revoke and recovery management for eligible users; bind challenges and credentials to verified tenant/session/origin/RP identity. Do not invent cross-domain credential portability.
- Build clear session-list/revoke, email verification, account recovery and security event feedback. Apply server authorization and CSRF/origin protections.
- Keep mandatory customer 2FA a **policy decision**; do not turn it on globally by default.

**Acceptance:** Owner/editor/viewer and tenant-crossing tests pass. Enrollment/revocation/recovery work in a production-equivalent environment with documented fallback when a factor is lost; platform owner step-up remains intact.

### 3.2 Tenant/RLS/auth race hardening

- Review `Auth Contract v2`, tenant resolution, composite keys, RLS policies, transaction/scoped context behavior, login/logout and session revocation races, invitation/reset/verification flows and publication permissions.
- Add or complete repeatable disposable-PostgreSQL integration tests for cross-tenant read/write attempts, stale/revoked sessions, simultaneous requests, host spoofing, concurrent role changes and shared worker processing.
- Ensure DB pool/reused connections cannot leak tenant scope; ensure background jobs propagate verified tenant context securely; audit policies against all relevant tables, including forms, drafts, media, jobs, publications, integrations and reports.
- Fix actual flaws found; do not weaken isolation or disable checks for convenience. Keep safe migration/backout paths.

**Acceptance:** Documented RLS/auth race matrix with passing reproducible tests and any remaining findings clearly tracked as release blockers.

### 3.3 Versioned encryption-key rotation and break-glass

- Inspect existing keyring, data-encryption and secret-management implementation. Add safe key-version support/migration/re-encryption where missing, with rollback compatibility and a non-destructive dry-run validation.
- Document and test two-step rotation (new writes on new key, old ciphertext still readable, staged re-encryption, verification, planned key retirement). Ensure secrets never appear in logs or fixtures.
- Produce a break-glass runbook for lost owner 2FA, compromised keys, credential revocation and emergency freeze, including dual control/manual checks if policy requires them.
- Demonstrate procedures on disposable/staging resources. **Do not rotate production keys or exercise real privileged recovery** without express approval.

**Acceptance:** Automated rotation compatibility tests, staging drill evidence, and actionable production runbooks; real-production drill marked `Waiting` if authorization absent.

### 3.4 Off-site backup, retention and restore

- Audit actual backup scripts, data volumes, Postgres dump/PITR capabilities if present, media/artifact needs, encryption, release manifests and restore prerequisites; define exact recoverable dataset and exclusions.
- Implement an **opt-in** off-site backup pipeline using the existing recommended Cloudflare R2/S3-compatible approach or existing approved destination. Support scoped credentials, secure encryption, versioning, checksums/integrity, durable error reporting, least privilege and safe retry behavior.
- Implement retention policy as configurable values, not destructive defaults. Provide `backup`, `list`, `verify`, `restore-to-disposable` and dry-run/prune tooling, using existing patterns; prevent a restore test from targeting production by mistake.
- Cover PostgreSQL, persistent customer uploads/media, critical site contract/content/publication metadata, artifact/release recovery and required configuration inventories without exporting secrets or inadvertently duplicating credentials.
- Set up failure alerts and freshness checks using Phase 2 monitoring. Validate realistic RPO/RTO against draft targets (**24h RPO, 8h RTO**) without promising achievement without timed drill evidence.
- Estimate backup costs from real volumes/retention assumptions, identify provider/account prerequisites and require owner approval before provisioning/spending.

**Acceptance:** Disposable or staging backup → isolated restore → application/data consistency verification succeeds; corruption and missing backup tests fail safely. Production off-server job and actual recovery drill require verified runtime evidence and approval.

### 3.5 Availability, rollback, incident and release evidence

- Verify existing static site availability during API/Redis/Postgres/worker/provider outages. Add deployment-safe smoke/integration checks where feasible.
- Create operational runbooks and observable checks for publisher rollback, queued job backlog/stuck leases, backup freshness, failed restore, domain/TLS problems, provider outage, over-budget AI and compromised staff credentials.
- Validate draft service goals (99.5% monthly availability, Sunday 02:00–04:00 America/Chicago maintenance, 30-min critical and 24-hour noncritical acknowledgement) as **planning targets**, not contractual guarantees.
- Improve `docs/release-gate.md` with evidence requirements, clean manual steps and exact pass/fail criteria.

**Phase 3 done when:** Security UX and hardening are verified; backup/restore, rotation, break-glass, publication rollback and outage drills are tested in appropriate non-production environments; every real-world production action is either separately verified or explicitly blocked with an owner action.

## 3. Phase 4 — Connect Google providers and make reporting trustworthy

### 4.1 OAuth connection and consent workflow

- Audit current Google connection/callback/list/disconnect endpoints and tenant/provider storage. Repair missing UI/API/error-state wiring, using platform/tenant scopes correctly.
- Implement secure OAuth state/nonce/PKCE where applicable, exact redirect allowlisting, least-privilege scopes, server-side secure token storage and rotation/refresh, verified property ownership/access, revoke/disconnect paths and clear consent text.
- Document required Google Cloud project/OAuth consent configuration, allowed origins, redirect URIs and Search Console/GA4 enablement. Use dummy/fixture credentials only for tests.
- Ensure platform staff cannot silently connect an unrelated customer's private property. Record who consented, scopes, property mapping and disconnect audit events.

**Acceptance:** Mock integration tests cover callback replay/CSRF, revoked/expired tokens, invalid properties and cross-tenant denial. Real accounts can only be connected by authorized users with consent.

### 4.2 Search Console and GA4 ingestion

- Implement or complete property selection, mapping, initial ingestion, incremental refresh, throttling/backoff, pagination, time-zone normalization, retention policy and API quota resilience.
- Ensure scheduler/runner jobs from Phase 2 perform tenant-scoped collection; support idempotency and clear freshness timestamps.
- Respect real-data limitations: GA4 figures, Search Console dimensions and search performance may differ; label sources accurately rather than merging incompatible metrics.
- Make disconnect behavior clear (stop collection, handle previously retained data under approved retention policy).

**Acceptance:** Real-provider sandbox/test property or owner-authorized property yields validated metrics; missing credentials produce meaningful `Waiting`/`Not connected` states rather than synthetic success.

### 4.3 Reporting UI and data accuracy

- Finish ORAP/customer-appropriate reports for traffic, Search Console search performance, publication history, crawl findings, structured data, scheduled jobs and integrations, using actual accessible datasets.
- For every metric show source, date range, last-refresh time, data availability and relevant sampling/caveats. Ensure empty/loading/error/stale/disconnected and permission states work.
- AI referrals and sampled AIO mentions must be explicitly labeled as measured versus estimated/sample observations; never claim definitive AI ranking or guaranteed SEO improvement.
- Add metric transformations/unit tests and cross-tenant access tests; do not expose connected credentials in reports.

**Phase 4 done when:** Connect/disconnect, ingestion, tenant scoping and reports pass tests; live claims require verified connected providers, actual consent and reproducible data checks. If real credentials are absent, deliver everything testable and mark live connections `Waiting`.

## 4. Phase 5 — Controlled AI/SEO/AIO automation (safe opt-in)

### 5.1 Audit and evaluate provider tasks

- Inspect existing `workers/` SEO/AIO components, model provider, prompting, field policies, content proposal/history, budget controls and emergency switches.
- Define representative evaluation fixtures for small-business services (including Coop _using approved facts only_): metadata, page copy, crawl issue summaries, structured-data recommendations, SEO proposal quality, and sampled AI-search observations where technically feasible.
- Implement deterministic checks for schema/contract validity, factual fidelity, restricted facts, prohibited claims, unsafe links/HTML, duplicated content and SEO regressions. Record model/provider/version, evaluation inputs (sanitized), output quality, latency and cost.
- Use mocks/fixtures for automated tests. **Do not make paid provider calls without approval and configured ceilings.** Produce a decision report recommending safe defaults and expected costs before proposing opt-in enablement.

### 5.2 Budget, policy and kill-switch enforcement

- Enforce AI spend limits at tenant and platform levels, quotas, retries and concurrency; handle provider timeouts, errors and budget exhaustion without publishing or excessive charges.
- Distinguish field modes: `auto` can prepare eligible changes under approved policy, `suggestion` requires human approval, `disabled/protected` cannot be modified or suggested. Preserve per-site feature flags and emergency stop toggles.
- Verify a centralized provider-enabled flag defaults **off** and cannot be bypassed via scheduler, API route, worker retry, replay or manual job submission.
- Require verified tenant context, auditable events and redaction of prompts/responses if they contain sensitive customer data.

**Acceptance:** Automated tests prove hard spending ceilings, disabled-provider behavior, cross-tenant isolation, protected-fact invariants and kill-switch behavior during queued/running/retried tasks.

### 5.3 Proposal → review → publishing integration

- Finish proposal generation/storage/status and coherent ORAP/Customer Admin review UI: evidence, original vs suggested change, reason, cost, source, risk and explicit approval/rejection.
- Apply authorized human edits/approvals to **new versioned drafts**, not directly to public site files or executable frontend code. Run existing draft validation, preview and controlled publication pipeline.
- Add stale-source/conflict handling so AI proposals cannot override later human edits. Keep immutable audit history and rollback availability.
- SEO recommendation processes may be scheduled after crawler evidence, but automated modifications must remain constrained by site policy and approval/configuration; no autonomous production publishing.
- Do not activate paid AI or AIO in production as part of autonomous implementation. Prepare owner-reviewed enablement procedure and smoke tests.

### 5.4 Visibility and measurement

- Provide truthful status/usage reporting for AI decisions, failed proposals, approvals, costs and token usage when available; label sampling-based AI search observations distinctly from first-party GA4/Search Console measurements.
- Avoid promising search rankings, Google inclusion, AI citations or revenue performance.

**Phase 5 done when:** Evaluation suite passes, policy and budgets cannot be bypassed, proposal review/draft workflows work under test, and opt-in enablement has a documented controlled procedure. Production paid AI remains `Waiting/Disabled` absent explicit approval; this is compliant completion of preparatory work, not a failure.

## 5. Phase 6 — Commercial readiness and repeatable onboarding

### 6.1 Plans, pricing and guardrails

- Inspect models and existing ORAP controls for plans, assignment, quotas, feature overrides, subscriptions, AI budgets, grace periods and suspension.
- Prepare or finish cohesive operator UI/workflows and tests for these controls, with clear effective settings and an audit trail. Do not invent enforcement that can disable public static-site serving.
- Treat proposed monthly price points **Starter $500 / Growth $1,000 / Pro $1,500 / Elite $2,000** as _draft inputs only_. Do not silently publish, charge, enforce or present them as final pricing.
- Create an owner decision worksheet covering final prices, setup/bespoke fees, seat/page/SEO cadence/AI limits, overage charges, grace period, manual collection, cancellations and feature enforcement; incorporate approved inputs when supplied.
- Payment-provider automation remains **Deferred**. Billing state may be managed internally, but production financial actions require owner approval.

**Acceptance:** Plans/overrides/grace behavior are accurate, tenant-scoped and reversible; tests prove no delinquency state takes an existing public website offline.

### 6.2 Legal and privacy operational readiness

- Inventory actual inquiry/customer forms, cookies/analytics/consent, retention/deletion/export, customer media, Google tokens, AI provider data flows, logs and backup retention.
- Produce versioned drafts/checklists for privacy, terms, service commitments, data deletion, form consent, Google integration permission and AI processing disclosures **for owner/legal review**, not unilateral final legal advice.
- Build technical mechanisms necessary to respect approved consent/deletion/retention policies where policy is known; for unresolved rules, avoid guessing or destructive data deletion and mark `Waiting`.
- Preserve public inquiry form's verified functionality. For generic customer-site forms, verify site-specific recipient, validation, spam protection, consent and delivery when actually enabled; Coop has no form by design.

**Acceptance:** A policy-to-code mapping and approval checklist exists, plus tests of any implemented retention/consent enforcement. No unapproved terms or public commitments are published.

### 6.3 Repeatable second-tenant onboarding

- Turn Phase 1 Coop registration into documented, **idempotent** onboarding with explicit steps: customer identity and consent, approved facts/content, site manifest and protected fields, verified DNS/host, owner invitation, role/plan/feature assignment, optional forms, Google connections, static-site deployment, monitoring, backups, preview/publish/rollback, and launch checks.
- Provide a reusable onboarding CLI/checklist/template and **read-only readiness command** that can report absent credentials, domain verification, customer identities, content mappings, worker services, integrations and backups without exposing secrets.
- Run an entirely disposable **second-tenant fixture** through onboarding and full authorized draft → preview → publish → restore flow. Demonstrate cross-tenant isolation and independence from Coop.
- Do not create or notify a real second customer or deploy a new real customer site without owner/customer authorization.

**Acceptance:** Documented repeatable pilot takes a fixture site from unregistered to safely publishable and back, with no manual DB edits or cross-tenant leakage. Real next customer is a separate owner-approved launch decision.

### 6.4 Sales and operations handoff

- Align marketing claims with actually Live capabilities: do not advertise unapproved AI-powered SEO/AIO, ranking guarantees or unverified uptime promises.
- Produce operator guides for customer intake, support escalation, plan changes, deployment, publishing incidents, restoration, provider setup, AI opt-in, customer offboarding and monthly service review.
- Clean up status matrices/README/roadmap and identify residual `Waiting` vs `Deferred` items; do not mark payment automation or infrastructure scaling incomplete bugs.

**Phase 6 done when:** Technical plan/admin flows and the second-tenant fixture are verified; customer-facing legal/pricing decisions remain explicitly `Waiting` until approved; documentation is usable for a real owner-authorized next launch.

## 6. Execution strategy and dependencies

1. **Audit baseline:** Inventory code vs this document and the Phase 1–2 goal; create `docs/phase3-6-execution.md` with prioritized tasks, concrete files and acceptance commands.
2. **Do security and recoverability first:** security UX/RLS tests, key rotation and off-site backup staging proof before introducing new data sources or automated changes.
3. **Then integrate reporting:** finish Google connection/ingestion with mocks, connect real accounts only with consent and credentials, validate reporting provenance.
4. **Then AI safely:** evaluation, hard budgets, reviews, kill switches, opt-in procedures; never silently enable paid/autonomous features.
5. **Then commercialization:** approve commercial/legal inputs through owner, validate plan management and repeatable onboarding in a second-tenant fixture.
6. **After each coherent increment:** run targeted tests; at finish, run repo-wide lint/typecheck/unit/integration/build checks as available. Record actual command output and known gaps.
7. **If blocked:** Implement safe fixture/test path, write owner action with the exact portal/credential/config/DNS/approval needed, and continue independent tasks. Don't repeatedly ask about one known blocker.

## 7. Mandatory testing matrix

| Category     | Required validation                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolation    | Every new endpoint, job, metric, token, report and tenant resource rejects cross-tenant access.                                                          |
| Auth         | Role, revocation, step-up, TOTP/passkey enrollment and recovery, CSRF/origin, stale sessions and concurrent requests.                                    |
| Recovery     | Integrity-checked off-site-compatible backup, disposable restore, corrupted/missing snapshot behavior, versioned-key compatibility and rollbacks.        |
| Availability | Static customer websites continue serving during DB, Redis, API, worker or provider outages; delinquent plan never disables the site.                    |
| Google       | Callback CSRF/replay, token refresh/revocation, property selection, disconnect, quotas, sparse/missing/stale metrics and invalid credentials.            |
| Reporting    | Reproducible aggregation, source/date/freshness labeling, empty-state honesty and per-role permissions.                                                  |
| AI           | Disabled by default, provider failures, spend ceilings, protected facts, review-only publishing, concurrent edits, idempotent retries and kill switches. |
| Commerce     | Draft prices not public, no automatic charging, auditability of effective plan/limits, grace-period preservation of site availability.                   |
| Onboarding   | First and second tenant fixture idempotency, complete lifecycle, reset/rollback and no cross-tenant leakage.                                             |
| Release      | Typecheck, lint, unit/integration suites, site builds, deployment config validation and documented rollback/smoke tests.                                 |

Use production-equivalent test environments **without modifying live customer data**. Do not fabricate evidence for tests unavailable due to real-provider or production prerequisites.

## 8. Required deliverables

- Code, tests, migration/config updates and coherent UX needed for Phases 3–6, reusing existing architecture.
- `docs/phase3-6-execution.md`: checked-off items with evidence, implementation and runtime status and owners for blockers.
- Security test matrix, customer-factor UX documentation, key rotation and break-glass runbooks.
- Off-site backup configuration template, retention/cost worksheet, isolated restore drill and production enablement/verification instructions.
- Google Cloud/OAuth/Search Console/GA4 setup checklist, consent rules, provider integration tests and source-labeled reports.
- AI evaluation/cost report, default-off enablement procedure, budget/kill-switch tests and proposal review flow.
- Draft commercial decision worksheet, legal-policy review checklist, effective-plan management documentation and disposable second-tenant onboarding proof.
- Updated `docs/roadmap.md`, `docs/operations.md`, `docs/release-gate.md`, and any affected READMEs/production-inputs instructions, with verified statuses only.
- Final handoff summarizing: changes, test commands/results, staging evidence, production evidence (if authorized), waiting owner actions, intentionally deferred work, deployment/rollback commands and residual risks.

## 9. Definition of done / stop conditions

**Do not stop at a plan or a list of recommendations.** Continue through implementation, tests and documentation for all work that can safely be completed with repository access and approved staging resources. Mark each criterion explicitly:

- `[x] Implemented + verified` only when actual code and tests support the claim.
- `[~] Implemented / production waiting` when code passes non-production tests but awaits DNS, credentials, approval, billing/provider account or live drill.
- `[ ] Not complete` with a specific unresolved defect or dependency.
- `Deferred` for out-of-scope capabilities.

**Do not call all of Phases 3–6 Live** merely because implementation is merged. External credentials, actual customer consent, legally approved commercial policies, provider spend approvals and live disaster-recovery verification are owner-controlled gates.

**Final goal:** An agency-operated, secure and recoverable managed-site platform with trustworthy reporting, tightly controlled AI assistance, approved commercial operations, and onboarding that scales beyond the Coop pilot without degrading tenant isolation or static-site availability.
