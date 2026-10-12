# ORAP UI and Staff Authorization Roadmap

**Status:** Approved implementation plan derived from
[`OmniReach_ORAP_Codex_Master_Prompt.md`](OmniReach_ORAP_Codex_Master_Prompt.md)
**Scope:** Repository-only ORAP application work. This document does not authorize a
production deployment, DNS change, shared-Caddy change, provider activation, credential
creation, or production-data mutation.
**Progress values:** `not started`, `in progress`, `blocked`, `complete`

## 1. Current implementation audit

### 1.1 What exists and works locally

- Central authentication, host-only sessions, mandatory platform two-step policy,
  customer-host isolation, CSRF/origin checks, audit infrastructure, and PostgreSQL RLS
  foundations already exist.
- ORAP currently serves Sites, Operations, and the signed-in account's Security page.
- The API already contains real services for customer access, site controls, plans,
  budgets, jobs, alerts, domains, integrations, content, publishing, SEO/AIO, analytics,
  contact forms, and backups.
- Existing pages render live service responses; they are not a client-side mock console.

### 1.2 Functional and architectural gaps

| Area                   | Current evidence                                                                                     | Gap / risk                                                                                      | Required disposition                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Platform authorization | `authorizedActor` accepts every active Owner, Admin, or Staff account for almost every ORAP endpoint | Any Staff account can reach broad platform mutations; no capability or scope intersection       | O01-O02 before new mutation UI                 |
| Platform membership    | `platform_memberships` stores one coarse role and an unused JSON `permissions` field                 | No normalized role templates, assignments, scopes, versions, or permission catalog              | Forward-only O01 migration                     |
| Owner-only invariant   | No internal-staff lifecycle routes exist                                                             | Adding staff without a dedicated owner-identity guard would be unsafe                           | O03; never express as a grantable permission   |
| Resource scoping       | Site and operations list queries are global in platform transactions                                 | Limited staff would learn or mutate unassigned customer/site data                               | O02 filtered query and mutation guards         |
| Session invalidation   | Customer role changes revoke customer sessions; platform role/scope changes do not exist             | Future staff changes could remain effective in old sessions                                     | O02-O04 auth-state bump and session revocation |
| Audit model            | Generic `audit_events` exists                                                                        | No staff-access event model, permission decision context, role version, or impact record        | O01-O04 append-only staff audit evidence       |
| UI coverage            | Three primary pages, one shallow site-detail screen                                                  | Approved sitemap is largely absent; users encounter unavailable controls or raw errors          | O05-O09 incremental real pages                 |
| Navigation             | Sites, Operations, Security only                                                                     | No permission-filtered information architecture, breadcrumbs, global search, or grouped modules | O05                                            |
| Error handling         | Several UI routes catch errors only after form submission; API errors are mostly raw JSON            | No consistent 400/403/404/409/5xx experience or retry guidance                                  | O02 and O05                                    |
| Browser tests          | One broad shell test with in-memory service doubles                                                  | It verifies markup, not real database authorization or full workflows                           | O02-O10 database-backed browser matrix         |
| Future capabilities    | Feature definitions exist for subscriptions, not staff authorization                                 | A newly added route can accidentally become broadly reachable                                   | O01 catalog registration plus default deny     |

### 1.3 Reconciled decisions and contradictions

1. D-006's six identity role kinds remain valid. The new specification refines internal
   authorization: `platform_owner` is the non-grantable owner identity,
   `platform_admin` is a staff-grade built-in template, and `staff` receives one or more
   configurable role assignments and resource scopes. It does not introduce a seventh
   global identity role.
2. The existing code grants Platform Admin and Staff nearly identical fixed actions.
   That behavior is superseded for ORAP by the effective capability intersection in
   ADR 0010. Existing customer roles and publication rules remain unchanged.
3. “Owner unrestricted access” means unrestricted functional access after required
   authentication, step-up, confirmation, and audit safeguards. It does not bypass
   protected facts, tenant isolation, budgets, retention, or infrastructure gates.
4. Customer-user invitations are not internal-staff invitations. Authorized scoped
   staff may manage customer access; only a current Platform Owner may manage internal
   ORAP staff identity or authority.
5. The appendix proposes many pages for capabilities that may be unconfigured or not
   production-active. Pages must report real readiness and unavailable/not-connected
   states; they must not imply activation, fabricate data, or add deferred products.
6. The existing `/security` route is the signed-in account's security settings. Staff
   administration uses `/security/staff`, roles use `/security/roles`, and audit/session
   administration uses their explicit child routes.

### 1.4 Genuine owner-input gates

No new owner decision blocks repository-only work. The following inputs block only the
named live or commercial actions and must not be guessed:

- Owner-level staff lifecycle changes use the current mandatory ORAP two-step session;
  the owner-approved 2026-10-12 policy does not require an additional TOTP/passkey
  step-up. Future SMS verification remains a separate change.
- Staff invitations use a hashed, single-use seven-day token, the configured
  authentication email sender, mandatory email-code verification on acceptance, and a
  non-owner role selected by the Platform Owner. Local/CI continue to use a sink adapter.
- Legal text, deletion/incident policy, final commercial prices, provider permissions,
  and production credentials remain the existing R-series gates. ORAP displays their
  readiness honestly and does not manufacture them.
- Adding a second production owner, changing a real owner's authority, or provisioning
  a real employee remains an explicit human action even after the feature is coded.

## 2. Non-negotiable implementation rules

1. Staff provisioning, staff status, credential reset, owner assignment, role editing,
   permission editing, role assignment, and staff resource-scope assignment require a
   current authenticated `platform_owner` identity in server code. No permission key,
   role name, API payload, database row, or UI confirmation can substitute for it.
2. Effective staff access is the intersection of current session/account state,
   mandatory platform MFA, identity role kind, active role versions, registered
   capabilities, resource scope, site policy, entitlements, emergency controls, and
   nonoverrideable safeguards.
3. Unknown and newly registered capabilities are denied to non-owners until an Owner
   deliberately assigns them. Owner-only capabilities are never assignable.
4. Lists, counts, search, exports, caches, activity streams, and background actions use
   the same scope filter as detail and mutation routes.
5. Every authority or scope mutation increments account authorization state, revokes
   active platform sessions, invalidates caches, and writes immutable non-secret audit
   evidence in the same transaction.
6. The last active Platform Owner cannot be disabled, demoted, archived, or removed.
7. High-risk actions require recent strong step-up where the authentication ADR says so,
   a bounded reason, and resource-specific confirmation. Confirmation is not
   authorization.
8. No mock-only page counts as complete. Every page must use a real repository service
   and have denial, empty, error, loading/degraded, and success coverage appropriate to
   its interaction model.

## 3. Dependency order

```text
O00
 └─ O01 capability/data foundation
     └─ O02 effective authorization and scoped queries
         ├─ O03 owner-only staff lifecycle
         │   └─ O04 role/scope administration and impact preview
         └─ O05 design system, shell, overview, navigation
             └─ O06 customers and websites workflows
                 ├─ O07 SEO/AIO, automation, analytics
                 ├─ O08 subscriptions, spending, alerts
                 └─ O09 security, audit, sessions, settings
O04 + O06 + O07 + O08 + O09 ── O10 integrated hardening and browser acceptance
O10 ── O11 documentation and release-readiness handoff
```

## 4. Goals

### O00 — Audit, approved plan, and authorization ADR

**Status:** `complete`
**Dependencies:** Existing architecture, security, roadmap, and ORAP implementation.

**Requirements**

- Record the implementation gap matrix, decision reconciliation, and dependency order.
- Define the non-grantable Owner invariant and future-capability default-deny rule.

**Prerequisites**

- Read the approved ORAP master prompt, master plan, roadmap, architecture, security,
  operations baseline, and current ADRs in full.

**Expected files and components**

- `docs/orap-ui-roadmap.md`
- `docs/adr/0010-orap-staff-authorization.md`
- ADR index, architecture, security, and operations cross-references

**Implementation tasks**

1. Inventory routes, pages, services, schema, guards, and tests.
2. Identify functional gaps, contradictions, migrations, and owner-input gates.
3. Define small goals with exact dependencies and acceptance criteria.

**Validation tests**

- Documentation link and required-section checks.
- Confirm every approved staff invariant maps to O01-O10.
- Confirm no production file, service, DNS record, or provider was changed.

**Definition of done**

- The plan and ADR are reviewable, consistent, and contain no invented production input.

### O01 — Versioned capability catalog and normalized staff-authorization schema

**Status:** `complete`
**Dependencies:** O00.

**Requirements**

- Add the normalized models `OrapStaffMembership`, `StaffRole`,
  `PermissionDefinition`, `StaffRolePermission`, `StaffRoleAssignment`,
  `StaffResourceScope`, `StaffInvitation`, `StaffAccessAudit`, and
  `StaffRoleVersion` without losing current identities, MFA state, or sessions.
- Seed the approved editable templates and a source-defined, versioned capability
  catalog with stable keys and owner-only metadata.

**Prerequisites**

- ADR 0010 accepted; capability naming/risk/scope metadata documented.

**Expected files and components**

- Forward-only Prisma schema/migration under `packages/database/`
- `packages/auth/src/orap-capabilities.ts`
- Catalog synchronization and integrity command
- Database/schema/catalog tests and goal-verifier registration

**Implementation tasks**

1. Define resource scope kinds (`platform`, `tenant`, `site`) and lifecycle states.
2. Seed Operations Manager, Website Developer, Content Editor, SEO Specialist, AIO
   Specialist, Account Manager, Support Representative, Billing Manager, and
   Analyst/Read-only Auditor templates.
3. Store immutable capability keys plus label, description, module, risk, scope,
   owner-only, step-up, reason, version, deprecation, and replacement metadata.
4. Backfill current platform memberships conservatively: Owners retain owner identity;
   Admin/Staff receive no inferred custom scope beyond an explicit compatibility role
   used only until O02 cutover.
5. Force RLS and least-privilege grants for the new tables.

**Validation tests**

- Migration applies twice in a disposable PostgreSQL database and preserves users,
  platform memberships, authentication policy, factors, and sessions.
- Duplicate/unknown/deprecated keys and assignable owner-only keys fail.
- A newly added catalog capability is denied to every existing non-owner role.
- Template reseeding is idempotent and never overwrites owner customizations.

**Definition of done**

- The normalized schema and catalog exist, are versioned/RLS-protected, preserve auth
  data, and provide no broad authorization by themselves.

### O02 — Effective authorization engine, guards, scoping, and invalidation

**Status:** `complete`
**Dependencies:** O01.

**Requirements**

- Replace coarse role-only ORAP guards with one server-side policy evaluator.
- Enforce the same scope on reads, counts, search, exports, mutations, cached results,
  and execution-time job actions.

**Prerequisites**

- Capability catalog and normalized assignments available.

**Expected files and components**

- Policy evaluator in `packages/auth/` or `packages/tenant/`
- Enriched platform principal/request context
- Route capability registry and typed guard helpers in `apps/api/`
- Scoped repository query helpers and authorization decision tests

**Implementation tasks**

1. Evaluate session/MFA/account/membership/capability/scope/site policy/entitlement/
   emergency/safeguard intersections and return non-secret decision evidence.
2. Require every ORAP route to register a capability key and scope resolver; fail build
   or startup for unregistered routes.
3. Filter site, tenant, job, alert, audit, report, and integration queries by effective
   scope before pagination or aggregation.
4. Recheck authorization inside every transaction and worker-side effect.
5. Invalidate auth state, sessions, and caches transactionally after authority changes.
6. Return consistent non-enumerating 401/403/404/409 errors and accessible HTML states.

**Validation tests**

- Cross-role and cross-site API/database matrices for every existing ORAP endpoint.
- Staff with no scope sees zero rows/counts and cannot infer resource existence.
- Permission removal and scope narrowing revoke existing sessions immediately.
- Unregistered routes/capabilities fail closed; spoofed role names/payloads do nothing.

**Definition of done**

- No current ORAP route relies on membership role alone, and all data/action paths are
  proven to use effective capability plus resource scope.

### O03 — Owner-only internal staff lifecycle

**Status:** `in progress`
**Dependencies:** O02 and the mandatory ORAP two-step authentication contract.

**Requirements**

- Implement invite, accept, list, view, activate, disable, archive, credential-reset
  initiation, invitation revoke/resend, session revoke, and owner assignment for
  internal staff.
- Keep customer invitations and staff invitations fully separate.

**Prerequisites**

- Owner-identity guard, invitation email adapter, and session invalidation exist.

**Expected files and components**

- Staff lifecycle services/routes in `apps/api/` and `packages/auth/`
- Hash-only invitation migration/services
- `/security/staff`, `/security/staff/invite`, `/security/staff/:userId`
- Integration and browser tests

**Implementation tasks**

1. Require a current `platform_owner` identity for every staff-authority operation;
   reject Platform Admin/Staff regardless of grants. The owner's completed mandatory
   ORAP two-step login is sufficient until a separately approved SMS policy exists.
2. Use expiring hash-only single-use invitations with resend/attempt limits and audited
   pending/accepted/expired/revoked states.
3. Preserve mandatory platform two-step verification and prevent full session issuance
   before it succeeds.
4. Enforce last-owner protection and transactional session/auth-state invalidation.
5. Use local sink delivery until R-008 is separately activated.

**Validation tests**

- Owner success plus Admin/Staff/customer/direct-API denial for every lifecycle action.
- Replay, expiry, resend, token disclosure, last-owner, concurrent disable/login, and
  invitation/customer-host confusion tests.
- Browser flow from Owner invitation through verified platform login.

**Definition of done**

- A currently authenticated Owner can manage fictional internal staff end to end; no
  other identity can provision or change staff authority.

### O04 — Role templates, custom roles, scopes, versions, and impact preview

**Status:** `not started`
**Dependencies:** O03.

**Requirements**

- Owners can clone/edit/archive staff roles, assign roles, manage resource scopes, view
  effective access, and preview impact before saving.
- Owner-only capabilities remain visibly locked and unassignable.

**Prerequisites**

- Staff lifecycle and policy evaluator are operational.

**Expected files and components**

- Role/scope administration services and APIs
- `/security/roles`, `/security/roles/new`, `/security/roles/:roleId`
- Permission matrix, scope selector, effective-access preview, role version history

**Implementation tasks**

1. Implement immutable role versions and archive semantics.
2. Produce server-side dry-run impact: affected staff, gained/lost capabilities, lost
   site/tenant visibility, sessions to revoke, and queued work affected.
3. Apply confirmed changes transactionally with reason, before/after, and trace evidence.
4. Prevent deletion of referenced history and prevent self-lockout/last-owner changes.

**Validation tests**

- Template clone/edit/archive, concurrent edit conflict, scope union/intersection,
  effective-access explanations, and immediate revocation tests.
- New catalog capability remains denied until an Owner edits a role.

**Definition of done**

- Owners can safely express real limited employee roles with explainable effective
  access, while non-owners cannot reach the administration surface or APIs.

### O05 — Accessible ORAP design system, shell, overview, and permission navigation

**Status:** `in progress`
**Dependencies:** O02.

**Requirements**

- Replace the thin three-link shell with the approved responsive information
  architecture and reusable interaction states.
- Render only modules the current principal can access.

**Prerequisites**

- Effective capability evaluation and scoped overview queries.

**Expected files and components**

- `apps/orap/` page modules and `packages/ui/` primitives
- `/` overview, grouped desktop/mobile navigation, breadcrumbs, account menu
- Page header, status, metrics, tables, dialogs/drawers, toasts, empty/error/loading
  states, permission gate, and copyable identifier primitives

**Implementation tasks**

1. Implement the specified sidebar/header/responsive behavior without exposing hidden
   route names through client data.
2. Build the overview from real independently degradable scoped read models.
3. Add accessible form/error/focus/confirmation/concurrency patterns.
4. Provide consistent friendly HTML errors instead of raw JSON for browser routes.

**Validation tests**

- Desktop/tablet/mobile browser snapshots, keyboard flow, reduced-motion, focus,
  semantics, contrast, and permission-filtered navigation.
- Widget-level unavailable states do not blank the page or fabricate zeroes.

**Definition of done**

- ORAP has a coherent, responsive, accessible shell and useful real overview for each
  permission set.

### O06 — Customers and websites workflows

**Status:** `not started`
**Dependencies:** O04, O05.

**Requirements**

- Implement `/customers*` and `/websites*` pages from the approved sitemap using real
  tenant, site, content, domain, deployment, form, customer-access, and history services.

**Prerequisites**

- Scoped query/mutation guards and shared UI patterns.

**Expected files and components**

- Customer directory/create/detail/people/history pages
- Website directory/create/overview/settings/content/domains/deployments/SEO/AIO/
  analytics/automation/forms pages
- Paginated filter/search read models and real form actions

**Implementation tasks**

1. Preserve agency-only site creation and contract validation.
2. Separate customer people from internal staff in URL, copy, and permissions.
3. Wire existing controls with policy/version concurrency, audit reasons, and readiness.
4. Hide conditional forms when unavailable and show honest provider/activation gates.

**Validation tests**

- Scoped list/detail/action matrix; pagination/search cannot leak counts.
- End-to-end fictional customer/site onboarding, access, content, domain, deployment,
  form-disabled, and history workflows.

**Definition of done**

- Authorized staff can operate the complete existing customer/website lifecycle without
  dead buttons, while limited staff see only their assigned resources and capabilities.

### O07 — SEO/AIO, automation, and analytics portfolio workflows

**Status:** `not started`
**Dependencies:** O06.

**Requirements**

- Implement the approved portfolio and detail routes for audits/findings/proposals,
  jobs/schedules/workers, and analytics/integrations.

**Prerequisites**

- Existing G20-G28 services and scoped read models.

**Expected files and components**

- `/seo*`, `/automation*`, `/analytics*` pages and APIs
- Evidence/detail drawers, job timelines, scoped replay/cancel, readiness states

**Implementation tasks**

1. Preserve deterministic evidence, AIO caveats, and proposal state distinctions.
2. Reauthorize replay/cancel/integration actions at execution time.
3. Show missing/stale/partial/provider-disabled states without invented metrics.

**Validation tests**

- Assigned-site-only aggregation, job action, proposal, metric provenance, stale state,
  and disconnected-provider browser/API tests.

**Definition of done**

- Portfolio operational workflows are functional, scoped, evidence-based, and honest.

### O08 — Subscriptions, AI spending, and alert workflows

**Status:** `not started`
**Dependencies:** O06.

**Requirements**

- Implement `/subscriptions*`, `/spending*`, and `/alerts*` from existing real services.

**Prerequisites**

- Plan/budget/alert services are capability- and scope-guarded.

**Expected files and components**

- Plan list/editor/version/assignment pages
- Site/platform budget, usage, and ledger pages
- Alert inbox/detail/acknowledge/resolve/assignment pages

**Implementation tasks**

1. Keep proposed pricing labels and capability readiness explicit.
2. Preserve atomic site/platform budget and immutable ledger semantics.
3. Implement alert filters, deduplication history, remediation, and delivery state.

**Validation tests**

- Billing/support/analyst permission separation, concurrent plan/budget conflict, ledger
  scope, alert lifecycle, and provider failure tests.

**Definition of done**

- Commercial and incident controls operate through audited real services with no false
  activation or financial claims.

### O09 — Security, audit, sessions, and platform settings

**Status:** `not started`
**Dependencies:** O04, O05, and applicable existing provider services.

**Requirements**

- Complete `/security*` and `/settings*` with strict capability and Owner invariants.

**Prerequisites**

- Staff/role workflows and signed-in account security are available.

**Expected files and components**

- Security overview, staff, roles, audit, sessions
- Platform/email/Google/Cloudflare/OpenAI/backups/deployment/access/data settings pages

**Implementation tasks**

1. Provide scoped searchable audit and session revocation without secret payloads.
2. Show configuration readiness and credential references, never credential values.
3. Require strong step-up and explicit owner identity for the specified high-risk
   security/access controls.
4. Keep external mutation buttons disabled until their existing authorization gates.

**Validation tests**

- Secret/redaction, audit scope, session revoke, owner-only settings, step-up, stale
  authorization, and provider-not-configured tests.

**Definition of done**

- Security and settings pages expose safe real state and authorized actions only.

### O10 — Integrated adversarial, browser, accessibility, and resilience gate

**Status:** `not started`
**Dependencies:** O04, O06, O07, O08, O09.

**Requirements**

- Execute all mandatory adversarial scenarios in the approved prompt and the complete
  frontend test matrix against disposable PostgreSQL/Redis and real repository services.

**Prerequisites**

- All planned local ORAP routes and actions implemented.

**Expected files and components**

- Database-backed Playwright suites
- Authorization/property tests, axe or equivalent checks, responsive snapshots
- Failure-injection and release evidence

**Implementation tasks**

1. Test Owner/Admin/each template/custom role/customer/direct-API combinations.
2. Test scope removal, permission changes, owner-only spoofing, disabled users, session
   replay, new-capability default deny, and concurrent role edits.
3. Test no-JavaScript fallbacks where server forms are offered and bounded progressive
   enhancement elsewhere.
4. Verify dependency/provider failures degrade widgets rather than public sites.

**Validation tests**

- `npm run verify:goal -- ORAP`
- `npm run verify:all`
- Disposable PostgreSQL migration/rollback-compatibility dry run
- Full browser matrix at narrow, tablet, and desktop widths

**Definition of done**

- No critical/high authorization, tenant, secret, accessibility, or functional blocker
  remains; every visible action is live, intentionally disabled with an explanation, or
  omitted by permission/readiness.

### O11 — Documentation and release-readiness handoff

**Status:** `not started`
**Dependencies:** O10.

**Requirements**

- Document operations, role/capability extension, staff recovery, migrations, rollback,
  support, and production gates without performing production changes.

**Prerequisites**

- Integrated local evidence complete.

**Expected files and components**

- Architecture/security/operations/ADR updates
- Staff/role operator guide and developer capability-registration guide
- Sanitized completion matrix and production prerequisite list

**Implementation tasks**

1. Document how each future feature registers capabilities and remains default denied.
2. Document staff onboarding/offboarding, incident revocation, last-owner recovery, and
   role impact review.
3. Record all remaining R-series and G05/G06/G31 production blockers accurately.

**Validation tests**

- Documentation/link/secret checks and a fresh-clone local setup rehearsal.

**Definition of done**

- Another Codex run or human operator can extend and test ORAP safely without inventing
  authority or production facts.

## 5. Progress ledger

| Goal | Status      | Depends on   | Notes                                                           |
| ---- | ----------- | ------------ | --------------------------------------------------------------- |
| O00  | complete    | —            | Audit, roadmap, ADR, and cross-references complete              |
| O01  | complete    | O00          | Capability catalog and normalized data foundation complete      |
| O02  | complete    | O01          | Effective authorization, scope cutover, and route registry      |
| O03  | in progress | O02          | Owner-only directory complete; mutation lifecycle remains       |
| O04  | not started | O03          | Configurable roles/scopes and impact preview                    |
| O05  | in progress | O02          | Shell, overview, responsive layout, and current navigation work |
| O06  | not started | O04, O05     | Customer and website workflows                                  |
| O07  | not started | O06          | SEO/AIO, automation, analytics                                  |
| O08  | not started | O06          | Subscriptions, spending, alerts                                 |
| O09  | not started | O04, O05     | Security, audit, sessions, settings                             |
| O10  | not started | O04, O06-O09 | Integrated security/browser/a11y gate                           |
| O11  | not started | O10          | Documentation and production-gate handoff                       |
