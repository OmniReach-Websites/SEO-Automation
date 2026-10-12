# CODEX MASTER IMPLEMENTATION PROMPT — OMNIREACH ADMIN PANEL (ORAP)

**Purpose:** Upgrade the existing ORAP application to the complete operational admin console, with a first-class, extensible authorization and staff-management system. This is an IMPLEMENTATION INSTRUCTION, not authorization to operate on production infrastructure. The attached UI specification is incorporated below verbatim as the binding user-interface design baseline, with the new RBAC requirements in this prompt taking precedence where they add specificity.

## A. Priorities, context and constraints

- OmniReach is an agency-operated, multi-tenant, fully managed hosting and SEO/AIO system. It is NOT a self-service website-builder SaaS. Internal ORAP is separate from the customers' `admin.customer-domain.com` dashboards.
- Repo: `OmniReach-Websites/SEO-Automation`, a TypeScript monorepo; inspect *actual* current code and repository docs before making architectural assumptions. Existing completed work MUST be preserved.
- Read `docs/masterplan.md`, `docs/roadmap.md`, `docs/ORAP_UI_UX_SPEC.md` (if present), `docs/security.md`, architecture ADRs, API contracts, migrations, tests, and the current UI. Where documents conflict, record a discrepancy and ask for owner input on security/business-policy changes; never silently weaken a security invariant.
- First create a route/component/API/permission GAP MATRIX labeled Implemented, Partial, Missing, Blocked; list evidence from files and tests. Do not claim a feature implemented merely because docs mention it.
- All pages use real data and existing backend services; no fake metrics or working-looking inert buttons. Unsupported external integrations have explicit `Not connected`/`Unavailable` states.
- Only use local/test environments and synthetic customers. DO NOT change VPS, DNS, Caddy, Cloudflare, GitHub secrets, deployment credentials, real accounts, live data, or paid-provider resources. No new production permissions are granted by this prompt.
- Preserve tenant isolation, owner bootstrap, privileged MFA, mandatory protected-fact restrictions, data contracts, versioned publications, audit trails, budgets, and backup safeguards.
- Treat the full appended 520-line ORAP UI/UX specification as a **required acceptance contract** for shell, routes, actions, forms, tables, responsive layouts, accessibility, security, and tests.

## B. Critical new feature: configurable internal ORAP staff authorization

**Business intent:** The founder(s)/owners have unrestricted *functional* platform-admin access within audited security safeguards. Employees are staff accounts with explicit granular permissions and optional customer/site assignments. Only verified ORAP Owners can create, invite, activate, or authorize new ORAP staff identities and manage internal role grants. Customer administrators are a separate identity/permission surface; a customer Owner is never an ORAP Owner.

### B1. Role kinds and precedence

Use three non-confusable organizational role kinds, not subscription package tiers:
1. `PLATFORM_OWNER` — built-in, non-deletable role template. Full ORAP functional access (business, customer, sites, billing configuration, security, operational controls, other staff management), subject to nonbypassable platform safety controls. Can invite/add other ORAP staff, appoint or remove owners subject to step-up verification and dual-control policy if one is later adopted. Must never let the final active Owner be removed, disabled, or demoted. Owner control is orthogonal to company legal equity ownership.
2. `PLATFORM_ADMIN` (if retained from current code) — treat as an assignable staff-grade permission template but **not** equivalent to Owner and **not able to create ORAP staff, grant staff permissions, manage Owner credentials, or escalate privilege**. Alternatively migrate to `STAFF` + `role_id` if backward-compatible; use an ADR and migration plan. The label `Admin` must not imply unlimited authority.
3. `STAFF` with exactly one primary configurable internal staff role per assignment, with optional additive roles only after carefully defined semantics. Staff permissions can be scoped to one or more sites/customers or the whole portfolio, where authorized by an Owner. Default deny.

**Absolute rule:** ORAP staff account provisioning is OWNER-ONLY. Not merely a `staff.create` permission that a custom role can be granted. Server-side authorization must require a current authenticated `PLATFORM_OWNER` identity for ORAP staff invitations, creation, activation, account-status control, credential reset initiation, owner role assignment, and staff role/permission edits and assignments. Non-owner employees cannot invite or create other employees even if a custom role is called 'Administrator' or API payload claims owner role. Existing customer-user invitations are different and can use separately approved staff permissions.

### B2. Seed default job positions (editable templates)

Create these reasonable initial *templates* with descriptions, display order, seed permission proposals (least privilege), and the ability for Owners to edit/clone/rename/archive/reorder and change all non-owner permissions:
- **Operations Manager**: portfolio-wide website status, operational alerts, job monitoring, approved non-security operational actions; no staff administration, Owner management, secret access or irreversible system changes.
- **Website Developer**: assigned sites, technical site manifests/build status, approved content/asset changes, publish to authorized sites if granted; cannot change subscriptions, staff, finance, or security.
- **Content Editor**: assigned sites, edit eligible marketing content, image/alt text, drafts, proposals, preview; publishing permission separately toggleable; cannot change protected facts unless separately authorized for a fact-specific workflow.
- **SEO Specialist**: read audits and findings for scoped sites, run approved audits, prepare remediations, inspect analytics; may not publish without permission.
- **AIO Specialist**: inspect AI proposals, validate/review eligible changes, manage site-level safe policy settings only when explicitly allowed; cannot bypass protected business facts or edit platform spend limits.
- **Account Manager**: scoped customer profiles, contact records and business onboarding, view subscription statuses, account notes if added; cannot edit invoices/prices, create staff, or grant own access.
- **Support Representative**: scoped read-only customer/site health and tickets/alerts, trigger approved password reset *for customer accounts* if enabled, no security changes, staff creation, or secret viewing.
- **Billing Manager**: view/edit subscriptions/plans and approved manual status changes as granted; no staff management and no access to payment secrets; high-risk plan changes require audit/confirmation.
- **Analyst / Read-Only Auditor**: scoped viewing of reports, audit trails, metrics, and status; no mutations.

Templates are not hardcoded permission behavior. Owners can create entirely new named roles later; unlimited extension should not require application code changes for standard capabilities. Roles can be scoped to site or tenant. Role names are never trusted for access; stable permission keys and server-side policy checks determine abilities. Built-in Owner and nonoverridable safety constraints are excluded from custom role editing.

### B3. Granular permission catalog and future-proof extension

Implement a versioned, database-backed permission catalog, defined/seeded in source with stable machine keys and visible categories. Examples (expand based on *existing* modules and their exact endpoints):
- `dashboard.view`, `dashboard.view_financials`
- `customers.list`, `customers.view`, `customers.create`, `customers.edit`, `customers.disable`, `customers.users.view`, `customers.users.manage`
- `websites.list`, `websites.view`, `websites.create`, `websites.edit`, `websites.disable`, `websites.content.view`, `websites.content.edit`, `websites.content.publish`, `websites.content.restore`, `websites.facts.view`, `websites.facts.edit`, `websites.assets.manage`
- `domains.view`, `domains.plan_changes`, `domains.apply_changes` (last one high-risk and additionally requires policy/approval)
- `deployments.view`, `deployments.request`, `deployments.rollback` (subject to production approval controls)
- `seo.view`, `seo.audit.run`, `seo.remediation.propose`, `seo.remediation.publish`
- `aio.view`, `aio.proposals.review`, `aio.policies.edit`, `aio.autopublish.pause`
- `automation.jobs.view`, `automation.jobs.cancel`, `automation.jobs.replay`, `automation.schedules.view`, `automation.schedules.edit`, `automation.workers.view`
- `analytics.view`, `integrations.google.view`, `integrations.google.manage`
- `plans.view`, `plans.edit`, `subscriptions.view`, `subscriptions.edit`, `entitlements.view`, `entitlements.override`
- `ai_usage.view`, `ai_budget.site.view`, `ai_budget.site.edit`, `ai_budget.platform.view`, `ai_budget.platform.edit`
- `alerts.view`, `alerts.acknowledge`, `alerts.resolve`, `alerts.configure_delivery`
- `security.audit.view`, `security.sessions.view`, `security.sessions.revoke`, `security.customer_access.manage`
- `backups.status.view`, `backups.restore.request`, `backups.delete.request` (manual deletion remains Owner-only by invariant)
- `settings.view`, `settings.general.edit`, `settings.integrations.view`, `settings.integrations.manage`, `settings.auth_policy.view`, `settings.auth_policy.edit`
- reserved **Owner-only actions**, e.g. `staff.invite`, `staff.create`, `staff.activate`, `staff.disable`, `staff.credentials.reset`, `staff.roles.manage`, `staff.permissions.manage`, `staff.assign_roles`, `owners.manage`, `break_glass.approve`, `security.platform_policy.change`, `backups.delete.approve`. These keys must be *system-reserved* and ineligible for non-owner roles, even if stored in the catalog.

Permission entries have `key`, `module`, `label`, `description`, `risk_level`, `scope_type`, `is_owner_only`, `requires_step_up`, `requires_reason`, `created_at`, `deprecated_at`, `replacement_key`, and version/compatibility metadata. Validate role grants using supported permissions and scope. Unknown permissions always deny; adding a future ORAP page defaults to invisible and inaccessible for Staff until an Owner grants its keys. New features should register capabilities and their route/API policies in tests.

### B4. Policy evaluation

Effective authorization is the intersection of:
1. authenticated account is active and session valid;
2. privileged MFA completed (per accepted current auth ADR) for ORAP;
3. user is member of ORAP staff organization and has appropriate kind;
4. action permission held by Owner or by explicitly granted staff role;
5. resource scope includes target customer/site;
6. site policy, subscription entitlements, lifecycle state, and emergency controls permit action;
7. immutable business/AI/security safeguards and step-up requirements permit action.

Reject denied cases with safe errors; never rely on navbar hiding alone. Scope checks must use server-verified tenant/site context, not a client-supplied ID alone. RLS is defense-in-depth. Staff assigned to only two websites sees only those two in lists, searches, analytics, exports, job details, notifications, autocomplete, and count totals. Prevent inferential leakage via global dashboard summary counts, caching, CSV export, and background jobs. Use transaction-safe policies and explicit cache invalidation when roles/scopes change.

### B5. Data model, migration and lifecycle

Implement suitable normalized models (names may match existing schema): `Or apStaffMembership` (use normal identifier `OrapStaffMembership`), `StaffRole`, `PermissionDefinition`, `StaffRolePermission`, `StaffRoleAssignment`, `StaffResourceScope`, `StaffInvitation`, `StaffAccessAudit`, `StaffRoleVersion`; include explicit organization/tenant IDs as appropriate. Keep immutable actor/target records and assignment histories. Uniqueness, composite foreign keys, PostgreSQL row policies, expiration dates, and indexes are required. Never mix customer roles with ORAP staff roles. Preserve current account IDs, password hashes, TOTP/passkeys/recovery, existing sessions and invitations via forward-only migration. Do not re-bootstrap owners or reset MFA during migration.

Invitation states: pending → accepted/expired/revoked; disabled or suspended employees cannot log in or continue existing sessions. Invitation links: unpredictable single-use tokens hashed at rest, short TTL, neutral enumeration behavior, abuse throttling, exact origin, no token logging. Owners may resend/revoke. Prefer owners inviting via approved email sending infrastructure; if unavailable, show pending/not configured instead of emailing via fake provider. Customer accounts cannot use the staff invite endpoint.

A role change, assignment removal, scope reduction, or employee disable should invalidate/re-evaluate active sessions, tokens and pending elevated actions immediately, fail closed on cached permissions, and record an immutable audit event. Define a safe recovery path for the final Owner. Distinguish account suspension from role archival; archived roles cannot be newly assigned, and existing assignments must be resolved safely. Allow dry-run impact preview before changing a role shared by many staff.

### B6. ORAP staff-management interface — pages and exact controls

Create a **Staff & Roles** subsection within Security (or its own main navigation group if verified staff scale justifies that). Required routes, with actual framework convention chosen after repository inspection:
- `/security/staff` Staff directory: total/active/pending/disabled counters scoped to authorized owner view; table columns Name, Email, Job Title/Role, Scope, MFA status, Account status, Last login, Created by, Created at, Actions. Search/filter by status/role/scope; sort; pagination; bulk operations restricted and confirmed. Button `Invite staff` visible ONLY to Owner.
- `/security/staff/invite` Owner-only new invitation wizard: work email, display name, choose editable job-position template, preview effective permission matrix, assign all-portfolio or explicit customers/sites, invitation expiry, review and send. Show a strong warning for portfolio access. Never invite someone to a role with Owner-only powers via staff path.
- `/security/staff/:staffId` Staff detail with tabs Overview, Role & Permissions, Assigned Customers/Sites, Sessions & Security, Activity. Owner-only actions Edit assignment, Disable/re-enable, Revoke sessions, Resend invitation, Reset credentials through approved workflow. Deny staff from viewing other staff security records by default.
- `/security/roles` Roles list: Name, summary, assigned users, permission count, scope constraints, last edited by/time, Built-in/Custom, Active/Archived. Buttons `New Role`, `Clone`, `Edit`, `Archive`, `View usage` visible to Owner. Built-in Owner is visible but has a lock icon and no Edit/Delete action.
- `/security/roles/new` and `/security/roles/:roleId/edit`: role name/slug/description, grouped granular checkboxes/switches with View/Create/Edit/Delete/Publish/Approve terminology where applicable, category collapsibles, Select all *within safe category only*, high-risk indicators and inline explanations, sample task preview, assigned scope capability, preview changes, impacted staff count, justification, confirm and save as versioned atomic mutation.
- `/security/permissions` Owner-visible, read-only catalog of supported capabilities, module origin, scope, description, high-risk/step-up badges, status, version; no arbitrary permission-key creation from the UI because keys must match implemented server guards. Provide `Not available in this build` for future keys.
- `/security/audit` filtered log including role assignments, permission edits, staff invites, owner changes, denied privileged access, session revocations and all site operations; no secrets.

**UX:** Assign a role to a staff member via searchable selector, but display effective abilities before confirmation. Show `Allowed`, `Denied`, `Limited to assigned sites`, `Requires owner approval`, `Not available` for clarity. Mark owner-only privileges with a permanent lock. Staff who lack `security.*` capability must never see Staff & Roles in the sidebar or reach routes directly. Distinguish customer-user management from internal staff management in breadcrumbs, URLs, copy and confirmation dialogs.

### B7. Owner-only capabilities and safeguards

- Only an existing verified Owner may invite/add ORAP staff, grant ORAP roles, assign portfolio access, change a staff employee's status/role, or create another Owner (through separately audited owner-to-owner process). No one gains Owner by registration, API payload, SQL seed fixture in production, or customer-site admin access. The original Owner bootstrap is a one-time separately authenticated procedure with no public signup.
- Owners can manage all customer sites and staff functions within platform security rules, but cannot rewrite AI-protected prices, bypass immutable permissions, reveal hashed secrets, disable required ORAP MFA, or authorize forbidden operations by role editing.
- High-risk privilege escalation changes require fresh second factor/step-up, typed confirmation, reason and audit. Prefer owner notification for creation of a new Owner, role policy revisions, portfolio-wide grants, production rollback permissions and emergency recovery. Record who performed the change and affected scope.
- Never lock out all Owners. At least one active Owner with usable MFA/recovery must remain. Test conflicting changes and account deletion attempts. Multi-owner concurrency must be transaction-safe.
- No ability to view plaintext passwords, MFA secrets, raw API keys, recovery codes, or service-account credentials.

### B8. Future extensibility

Every future ORAP module must specify: navigation grouping, route list, permission keys and scope, error/empty/loading states, audit events, test fixtures, default-deny grants, customer-visible implications, policies and integration contracts. Do not automatically grant new permissions to existing custom roles. A safe owner-controlled `role template migration` may propose grants after review. Deprecation and renaming of keys must be migrated explicitly and audited, never silently broaden permission access.

## C. Complete required page layouts and UI behavior

Use the **entire appended page specification**, not merely the staff pages above. Build all navigational sections: Authentication, Overview, Customers, Websites (including content/SEO/AIO/domains/deployments/analytics/automation/settings and forms if backend available), portfolio SEO/AIO, Automation jobs/schedules/workers, Analytics, Subscriptions, AI Spending, Alerts, Security & Audit, and Settings. For each route:
- PageHeader with title, breadcrumb, contextual help/description, primary permitted action, optional secondary actions, appropriate status badge (only for meaningful status).
- Loading, skeleton, empty, no-search-results, unauthorized, unavailable, degraded, offline, failed, stale, partial and success states. Distinguish permission denied from unconfigured integration.
- Reusable responsive accessible tables with column definition, sorting, pagination, filters, timestamp and amount formatting, bulk actions where safe, server-enforced scope.
- Field-level labels, helper text, constraints, server-side validation, error summaries, dirty-state warnings, accessible dialogs/toasts, keyboard navigation, focus return, confirmation for destructive/high-risk action.
- Content pages show original/proposed/current diffs and safeguarded publication state; protected facts are visually locked for AI but editable by explicitly permitted humans via an audited workflow.
- All system metrics show source, exact time range/time zone, freshness, and whether measured or inferred. Do not invent rankings, conversion attribution, or paid integrations.
- Design tokens, typography, contrast, spacing, screen widths, nav collapse, sticky top bar, keyboard shortcuts (if supported), mobile menus and 360/768/1024/1440 viewport tests per appended specification.

## D. Execution process and acceptance

1. **Inventory:** Inspect actual code/docs, update gap matrix and map every UI route to endpoint, permission key, tenant/site scope, relevant database model and test. Confirm existing user roles and migrations before making RBAC modifications.
2. **Plan:** Create `docs/orap-ui-roadmap.md` with small dependency-ordered milestones. Create a security ADR for Owner-only staff provisioning, role-scoped authorization, Owner retention, and permission-catalog versioning. If user explicitly wants planning only, stop after review; otherwise proceed in tested local milestones.
3. **Implement:** Build actual code + migrations + seed templates, server guards and query scopes BEFORE interactive UI, then layout/navigation and real API views. Reuse existing design system, tests and backend. Never ship UI-only fake permissions.
4. **Verify per milestone:** `npm run verify:all` and relevant goal tests; DB migration dry run, cross-role/cross-site security integration tests, browser E2E, accessibility and responsive checks. A failed or skipped critical suite blocks completion.
5. **Report:** For each milestone list delivered screens/endpoints/models, exact changed files, validation results, security findings, missing provider connections, unimplemented features, unresolved owner decisions, and next milestone. Mark completion only after acceptance tests pass. No production changes.

### Mandatory adversarial acceptance scenarios

- Non-owner role attempts `POST /staff/invitations`, create staff, assign roles, grant self Owner, use forged `role=owner`, replay invitation, or request restricted site; all fail server-side and are audited.
- A staff member with `websites.content.edit` but not publish can draft/preview only; cannot publish via hidden API or job enqueue.
- A role granting site A access cannot see site B in search, global counts, history, exports, notifications, or direct ID routes; database RLS independently blocks leakage.
- Owner invites employee scoped to sites A/B; employee sees only A/B; owner changes role; session privilege refresh or revocation takes effect immediately.
- Two Owners editing the same role concurrently cannot silently overwrite; optimistic version conflict shown clearly.
- Non-owner attempts to edit role template, grant new permissions, archive their own role, invite a new employee, or disable Owner; denied.
- The last Owner cannot be disabled or demoted even in concurrent requests; recovery pathway remains documented and testable.
- A new future permission key becomes available after a code release; no existing staff role gains it automatically. Owners can explicitly assign it.
- ORAP owner login requires accepted privileged MFA; customer admin login remains optional MFA, independent per customer policy. Neither customer role nor domain cookie accesses ORAP.
- Owner cannot enable AI edit for prices/important facts; permission override never bypasses validator.
- Missing providers show honest setup states; failed jobs and deployment rollback do not make healthy websites go offline.
- All dangerous staff modifications generate complete audit events: actor, target, old/new permission set/version, scope, reason, timestamp and correlation ID, without secrets.

### Explicitly out of scope unless already implemented

Do not build billing payment processing, CRM, SEO competitor monitors, AI search mention tracking, social publishing, Google Business Profile controls, registrar purchasing, transactional commerce or secret reveal UI simply to fill a menu. Keep UI for deferred features unavailable or omit them. Real external access and production activation require separate owner approvals.

---

# APPENDIX — BINDING ORIGINAL ORAP UI/UX PAGE SPECIFICATION

The following is the full prior page-layout specification and must be reconciled route-by-route against implementation. Where it has an older generic Staff permission concept, the owner-only RBAC contract above wins.

# OmniReach Admin Panel (ORAP) — Complete Page, Layout and Interaction Specification

**Version:** 1.0 design proposal · **Scope:** Internal OmniReach administration panel at `admin.omnireach.cloud` · **Audience:** Platform Owner, Platform Admin, authorized Staff, developers, QA and Codex.

## 0. Status and non-negotiable boundaries

This document is a **proposed UI/UX contract** based on OmniReach's agreed product architecture and development roadmap. It is **not** a verified inventory of what has been coded. Codex must audit existing routes and components before implementation; preserve working behavior and update documentation whenever design differs from implementation. Customer dashboards at `admin.customer-domain.com` are a separate application, although ORAP may link to their pages or act on their settings. No production changes are authorized by this document.

- Agency-first, fully managed websites; ORAP is for staff, not self-service purchase.
- One business/tenant can contain multiple sites; site-specific subscriptions, policies, domains, deployments, analytics, content, and AI budgets.
- Protected business facts (prices, hours, addresses, phone numbers, contact details, legal terms and designated important facts) are **never AI-editable or AI-suggestible**. Authorized humans edit facts through separate audited workflows.
- AI per eligible field: **AUTO** (publish after validation) or **SUGGEST** (customer approval required); PROTECTED is system-enforced and cannot be bypassed by a plan or staff override.
- Privileged ORAP accounts require MFA. Customer accounts do not require MFA by default and may opt in; exact MFA methods follow the accepted authentication ADR, rather than assuming the newest proposal is implemented.
- Git `main` is the code release source of truth; PostgreSQL is the live structured-content source of truth; object storage owns originals; immutable artifacts are published atomically.
- A denied, missing, expired or not-yet-connected integration is **not** shown as healthy or as zero traffic. Never fabricate SEO ranks, AI referrals, or operational results.
- Design all operations for multi-tenant scoping, idempotency, auditability, least privilege, full keyboard use, responsive layout, and accessible feedback.

## 1. Global information architecture

### 1.1 Sitemap and routes

Routes below are suggested, stable UI routes; they are not assertions about existing API endpoints. Use actual resource IDs in paths and server-check ownership on every request. All pages use `/orap` as a notional base, which may be omitted if ORAP is hosted at its own hostname.

```
/login                         Staff sign-in
/mfa                           Staff second-factor challenge
/recover                       Account recovery entry
/owner-setup                   One-time guarded owner bootstrap
/                             Overview
/customers                    Tenant/customer directory
/customers/new                Create business
/customers/:tenantId          Customer overview
/customers/:tenantId/people   Customer users and site memberships
/customers/:tenantId/history  Customer activity
/websites                     Website directory
/websites/new                 Register website
/websites/:siteId             Website overview
/websites/:siteId/settings    Website settings/features/entitlements
/websites/:siteId/content     Pages, fields, revisions and protected facts
/websites/:siteId/domains     Hostnames/DNS/TLS
/websites/:siteId/deployments Website code releases and publications
/websites/:siteId/seo         Website SEO audits/findings
/websites/:siteId/aio         Website AIO work, proposals and modes
/websites/:siteId/analytics   Website GA4/Search Console dashboards
/websites/:siteId/automation  Site-specific jobs, schedules and budgets
/websites/:siteId/forms       Contact forms (only when implementation is verified)
/seo                          Cross-site SEO/AIO operations
/seo/audits                   Audit runs
/seo/findings                 Issues and remediation queue
/seo/proposals                Content optimization suggestions
/automation                   Automation overview
/automation/jobs              Global job queue
/automation/jobs/:jobId       Job detail
/automation/schedules         Schedules and concurrency
/automation/workers           Worker status
/analytics                    Portfolio analytics
/analytics/integrations       Provider-connection portfolio
/subscriptions                Subscription overview
/subscriptions/plans          Plan definitions
/subscriptions/plans/:planId  Edit plan entitlements
/subscriptions/assignments    Site subscriptions/statuses
/spending                     AI cost overview
/spending/sites               Per-site costs and budgets
/spending/ledger              Usage and reservation ledger
/alerts                       Alert inbox
/alerts/:alertId              Alert detail
/security                     Security overview
/security/staff               Team directory
/security/staff/:userId       Staff profile/roles/sessions
/security/audit               Audit log
/security/sessions            Session management (authorized scope)
/settings                     Settings index
/settings/platform            Platform preferences and safety switches
/settings/email               Resend sender/health configuration (no secret display)
/settings/google              Google Search Console / GA4 integration policy
/settings/cloudflare          Domain/DNS integration policy
/settings/openai              Model catalog, guardrails and cost rules
/settings/backups             Backup health/retention/restore checks
/settings/deployment          GitHub deployment policy and releases
/settings/access              Authentication/MFA policy
/settings/data                Retention and consent policy references
/profile                      Personal profile, sign-in methods and sessions
```

### 1.2 Desktop shell: exact structural rules

- Full viewport app shell; persistent sidebar **256 px** default width, collapsible to **72 px** icon rail; top bar **64 px** high; scrolling occurs in main content, not whole page except where necessary.
- Main content max width **1440 px**, centered; horizontal padding **32 px** large desktop, **24 px** regular desktop, **16 px** tablet/mobile; vertical section rhythm **24 px**.
- Sidebar top: 32–40 px mark, OmniReach wordmark, muted `ORAP` label, and collapse button. Clicking logo goes to Overview. Never confuse ORAP with a customer dashboard.
- Sidebar primary order: Overview; Customers; Websites; SEO & AIO; Automation; Analytics; Subscriptions; AI Spending; Alerts; Security & Audit; Platform Settings. Groups separated by thin separators rather than decorative heading badges. Staff permissions determine visibility; links also require server authorization.
- Active nav item: subtle contrasting rounded background, 3 px leading accent bar or equivalent, bold 14 px text, accessible `aria-current="page"`. Hover/focus visible. On collapse keep tooltip and accessible label.
- Sidebar bottom: system status indicator; signed-in staff avatar/initials, name, role, contextual menu (Profile, Help/Operations, Sign out). Do not show secrets or login tokens.
- Top bar: breadcrumbs at left (e.g. Websites / Restaurant A / SEO); global site/customer search button (Ctrl/Cmd+K), environment indicator **only if not production or ambiguous**, live-alert bell with unread count, user profile actions at right.
- Global search overlay: first input focus, Escape closes, up/down arrows navigate; grouped results Customers, Websites, Domains, Jobs; each result includes type, name, secondary ID/domain; filter by permission; do not expose unauthorized search hits.
- Breadcrumb segments link to stable parent pages. Main title 24–28 px/semibold, subtitle 13–14 px explaining scope. Top-right primary action max one, with secondary actions grouped into an overflow menu.
- Standard header stack: breadcrumbs -> title/action line -> concise description/status metadata -> local tabs -> filters/toolbar -> content. Avoid stacked oversized cards.
- Global toast region upper right on desktop and beneath header on mobile; messages include success/error text, optional Undo only when reversible; failures preserve input state and explain next actions.
- Theme: clean enterprise interface with light/dark support, accessible contrast. Use a neutral base, one primary accent, subdued semantic success/warning/error; no gradients or decorative status badges for every section. Fonts: system/Inter-like sans, numerical data tabular. 4/8 px spacing grid; cards radius 10–12 px; inputs min 40 px high; touch targets >=44 px.

### 1.3 Responsive layout

- >=1280 px: persistent sidebar; main grids commonly 4 KPI cards, charts 2-column 2:1, detail pages content + 320 px right panel.
- 1024–1279 px: collapsible sidebar; 2–4 KPI columns; right rail converts to inline card.
- 768–1023 px: sidebar hidden behind labeled menu; 2 KPI columns; dense tables horizontally scroll within their own region, never clip action buttons.
- <768 px: top navigation with menu, compact title, primary action in overflow; single-column cards; filters as bottom sheet or full-height overlay; tables switch to responsive field cards when meaningful. Do not hide high-impact statuses on mobile.
- Safe-area padding on mobile; keyboard and screen-reader navigation remain coherent; modal content scrolls independently.

### 1.4 Universal UI inventory and behavior

**Elements:** PageHeader; Breadcrumb; LocalTabs; StatusLabel; MetricCard; TimeSeriesChart; FilterToolbar; SearchField; DateRangePicker; DataTable; RowActions; PageSizePagination; EmptyState; LoadingSkeleton; InlineError; CalloutMessage (neutral); Toast; ConfirmDialog; FormDialog; SideDrawer; RevisionDiff; Code/VersionBadge; EventTimeline; AuditTrail; PermissionGate; ConnectionStatus; BudgetBar; ProgressIndicator; UserAvatar; CopyableID; HealthIndicator.

**Data tables:** clickable row where navigation is expected, but checkboxes/action buttons never inadvertently navigate; sortable headers labeled direction; sticky header for long tables; persisted page filters in URL; optional column selector for complex lists; server pagination default 25/page with 25/50/100; real empty vs filtered-empty states; optional CSV export only where permitted and privacy-reviewed. Tables show last refresh and zone-aware time; IDs are truncatable but copyable. Avoid fixed-height table areas with unreachable scroll.

**Forms:** label above input, helper text below, inline validation after interaction/submit, constrained max lengths, disabled save when unchanged, unsaved-changes protection, progress feedback, keyboard labels and focus to first error; handle concurrent update (409) via diff/reload option rather than silently overwrite. Sensitive changes require current authorization/recent reauthentication when appropriate and an audit reason.

**Danger actions:** menu -> contextual modal with specific resource, consequence, prerequisite and typed confirmation for highly destructive operations; separate “disable,” “archive,” “delete.” Data deletion is not a reversible UI trick. Domain removal, security bypasses, backup deletion, credential revocation and live release switching always have elevated safeguards.

**Async statuses:** initial loading skeleton; no records; filtered no-match; disabled by policy; not connected; scheduled; running; rate-limited; partial result; stale data; error; permission denied; archived; pending owner approval; read-only maintenance. Show evidence, timestamps, and action where possible. Poll job progress at a bounded interval or use safe server events; no unbounded refresh loops.

**A11y:** WCAG 2.2 AA target, full keyboard operation, labeled icons, focus rings, dialog focus trap/return, form descriptions, `aria-live` status messages, no color-only meaning, charts paired with tabular summaries, reduced motion support. Dates show preferred local timezone with hoverable UTC where appropriate. Formats: ISO in exports, localized UI dates, explicit currency USD.

**Security UX:** no tokens, password hashes, credentials, recovery codes, raw provider OAuth responses, private form contents or sensitive payloads in search, client logs, URL query strings, or support screenshots. Filtered server authorization on every page and action. Confirmation is NOT authorization; backend decides.

## 2. Authentication and account setup

### 2.1 `/login` — staff sign-in

- Centered 420 px card on restrained branded backdrop; logo at top; heading `Sign in to ORAP`; subtitle `OmniReach staff access only`.
- Email field with autocomplete=username and required validation; password field with visibility toggle and autocomplete=current-password. Large `Continue` button; `Forgot password?` below.
- Generic authentication error text avoids user enumeration; rate-limit shows neutral retry guidance; no credential detail logs.
- Authentication success requiring MFA routes to `/mfa` without issuing final privileged session; authenticated account redirected to intended safe internal destination only.
- Footer links to terms/privacy/support contact; no customer-site login link implying shared login.

### 2.2 `/mfa` — ORAP verification

- Heading `Verify it's you`; briefly identify factor (email one-time code, TOTP or passkey **only after implementation/owner security approval**).
- Email OTP: six single-character boxes with paste support and one logical input accessible; expiration timer; `Resend code` delayed by cooldown; attempt limit and generic errors; no code exposed to JS logs. TOTP: standard six-digit entry. WebAuthn: labeled `Verify with Windows Hello or security key` button and fallback to verified alternative/recovery.
- Methods displayed only if enrolled/permitted; platform policy mandatory even if customer policy optional. `Use a recovery code` opens distinct secured input with clear one-use warning.
- Pending verification state invalidates on expiry; after success return to safe internal location. A password reset alone must never bypass required MFA.

### 2.3 `/recover`, `/owner-setup`, `/profile`

- Recovery: email entry, nonenumerating result, reset token validation, new password, existing MFA remains required; no token in query logging.
- Owner setup: invite/bootstrap token entered through POST body, validated once, password setup, factor enrollment and saved-recovery-code confirmation, one atomic owner creation; explicitly unavailable once completed. This flow must match actual approved auth ADR.
- Profile: name, email (verification required), password change, enrolled factors, session/device list, revoke other sessions, recovery-code status (never show old codes), preferred timezone and notification choices; sensitive changes require reauth and audit.

## 3. Overview `/`

**Header:** `Overview`, subtitle `Your entire OmniReach operation at a glance`; top action `Add website` plus period picker (Today/7d/30d) and optional refresh timestamp.

**Row 1 — KPI cards (4 desktop / 2 tablet / 1 mobile):** Active websites; Active customers; Open critical alerts; AI spend this month. Each card shows value, definition tooltip, comparison period if meaningful, and clickthrough. Do not show invented values.

**Row 2:** Left 2/3 wide `Platform health`: public site checks, API, worker queue, DB, Redis, backup last verified, integrations; concise status and `View operations`. Right 1/3 `Requires attention`: prioritized actionable alerts, failed publication, missing integration, budget threshold; each item links directly to issue.

**Row 3:** `SEO & AIO activity` summary: audits run, findings open/resolved, auto changes published, suggestions pending; mini trend chart with legend. `Automation jobs` compact state chart queued/running/failed and next planned run.

**Row 4:** `Websites needing attention` table: Site, Tenant, Domain, Public health, Last publish, SEO issues, AI budget state, Action. Show top 10, link to directory.

**Row 5:** Activity timeline with filter All / Admin / Jobs / Deployments / Content / Security, each item action, actor/system, site, timestamp, outcome. No private payloads.

**Empty state:** `No customer websites yet` with `Add first website`. **Degraded state:** each widget independently shows `Unavailable` instead of blanking entire dashboard.

## 4. Customers

### 4.1 `/customers` directory

- Page header `Customers` with `Add customer` primary CTA.
- Toolbar: text search by name/approved identifier; filters Status (Active, Disabled, Pending), Sites count, Subscription tier, Date added; sortable name/date/site count columns.
- Table columns: Business name, Account status, Number of sites, Primary contact **only if authorized**, Plan mix/status, Last activity, Created, row menu (Open, Manage people, Disable, Audit history). Avoid directly exposing contact emails in broadly accessible exports.
- Each row click opens customer detail; `Add customer` opens full-page creation if multiple fields, not dense modal.
- Loading/empty/filtered-empty; archived records excluded by default and accessible through filter.

### 4.2 `/customers/new` create business

- Four groups: Business identity (display/legal names as separately verified, industry restaurants/local services, notes), Contact (primary contact name/email, optional phone), Ownership (select initial Customer Owner or defer invitation), Initial website (optional `Create site next` checkbox). Field validation and normalizing whitespace.
- Primary `Create customer`, secondary `Cancel`; preview summary of recorded data; successful create routes to detail with non-sensitive toast. Creation should not accidentally create DNS, bill, send marketing emails or deploy.

### 4.3 `/customers/:tenantId` customer overview

- Header business name, customer ID copy, Active/Disabled status, created date; actions `Add website`, `Manage users`, high-risk `Disable customer` in overflow.
- Tabs: Overview / Websites / People / Activity. Overview: business contact metadata, subscriptions across sites, linked websites (card/table), open customer alerts, recent activity, unverified business facts. Each site row domain, plan, health, admin availability, enabled editing, last publish.
- Right contextual panel: owner/contact (access-controlled), account status, key milestones, quick links. Disabling customer never silently deletes live sites; show explicit impacted access/automation policies.

### 4.4 `/customers/:tenantId/people`

- Directory columns: User name, email, customer role, assigned sites, status, last login, MFA state (optional/required), actions.
- `Invite person` drawer: email, name, role, site memberships, send-invite toggle, review; role changes and revocations require reason and confirmation. Existing users can be linked without merging permissions unexpectedly.
- `Reset access` creates secure reset invitation; ORAP never views password or recovery codes. Revoke sessions per site or globally only with proper authorization.

### 4.5 `/customers/:tenantId/history`

- Read-only audit timeline, filter actor/action/site/time, event detail drawer with safe before/after redacted values, request trace ID. No deletion controls.

## 5. Websites (primary workflow)

### 5.1 `/websites` directory

- Header `Websites`, primary `Register website`.
- KPI strip Active / Draft / Unhealthy / Pending domain, optional count by tier.
- Filters: tenant, domain, plan, publication state, health, editing enabled, automation paused; search by site/business/domain; saved views optional later.
- Table: Website name + tenant, Primary domain, Plan, Public health, Last successful publish, SEO findings, AI monthly spend/limit, Customer editing, Status, action menu. Never equate missing monitoring data with Healthy.
- Bulk operations limited to safe non-destructive actions and restricted permissions; no bulk domain deletes.

### 5.2 `/websites/new` register website

- Multi-section wizard: 1) select tenant; 2) site display name, internal slug, industry; 3) validated Git monorepo site path / contract manifest; 4) assign plan and editable override preview; 5) draft domain(s) optional; 6) review. Draft saved explicitly; user may exit and resume.
- Verify manifest path within allowed site directory and contract compatibility; invalid path shows actionable error. Creation registers a site; it does not automatically expose domains or modify Caddy.

### 5.3 `/websites/:siteId` overview

- Header site name, tenant breadcrumb, domain link external icon, status chips for site/publication/health; primary `Open public site` and dropdown `Actions` (Edit settings, Freeze publishing, Open customer dashboard if authorized).
- Horizontal local tabs: Overview, Content, SEO, AIO, Analytics, Automation, Domains, Deployments, Settings, Forms (only if supported).
- 4 KPI cards: Public health, Last successful publication, Open SEO findings, AI spend current period; all show last observed time.
- Main left: activity timeline, latest deployment, recent audits, pending AI suggestions, recent customer edits. Right: subscription and feature status, connected integrations, current assigned domains, current artifact hash/commit, queued jobs.
- `Emergency controls` are visually separate with rationale prompts: Freeze editing, Stop AI publication, Pause automation. Show current effects and whether public site remains online.

### 5.4 `/websites/:siteId/settings`

- Tabs within page: General, Feature access, Customer permissions, Site policy, Limits, Danger zone.
- General: display name, verified owner tenant (not casually editable), locale/timezone, code path/contract version read-only, site status.
- Feature matrix: name, plan default, site override, effective value, reason, affected user/site UI, last changed by/time. Switch to Inherit / Enabled / Disabled; global security invariants never expose an override toggle.
- Customer settings: allow editing on/off; supported publish permissions; customer can toggle AUTO per eligible field; customer-visible analytics. If editing off, customer dashboard still works, with editor replaced by explanation.
- Automation policy: safety mode, validation requirement, per-site emergency stop, crawl cadence within plan caps, concurrency/priority when supported. AI PROTECTED is always locked.
- Danger zone: archive site (not destroy artifact), revoke domain mapping (separate confirmation), suspend site/customer editor access, freeze publishing; avoid global delete until retention/recovery policy implemented.

### 5.5 `/websites/:siteId/content`

- Data grid for site pages: Page path, title, template/section count, draft revision, published revision, last edited by, status, actions `Inspect` / `View revisions` / `Preview` / `Restore` if authorized.
- Page drawer: hierarchical section list; visible field IDs, display label, field type, customer editability, effective AI mode, protected-fact link, source revision. ORAP may link to customer editor or use a permissioned staff editor only if that editor actually exists—do not invent arbitrary markup editing.
- `Business facts` separate tab: prices, hours, phone, addresses, legal facts etc. with source, verified timestamp, permitted human edit and audit; never offer `AI optimize` here.
- Revisions tab: timestamp, actor (customer/staff/AI), rationale, diff preview, artifact/build, restore action requiring permission and creating new revision. Publication status Pending/Building/Published/Failed/Reverted.

### 5.6 `/websites/:siteId/domains`

- Domain table: hostname, kind (public/admin/redirect), primary flag, ownership verification, DNS state, TLS state, last checked, Cloudflare zone reference, actions.
- `Add hostname` wizard: enter fully qualified domain, verify tenant ownership, choose public/admin, inspect exact proposed DNS change, require review/authorization, then monitor states Requested/Verification pending/DNS pending/TLS pending/Active/Failed.
- DNS plan viewer shows record name/type/value and before/after without exposing API token. `Apply` not visible until provider connection, approvals and backend permission meet requirements.
- Warnings for existing Caddy route collisions, wildcard dangers, unknown hostname, expired certificate. Domain purchase/renewal is a manual checklist, not automatic.

### 5.7 `/websites/:siteId/deployments`

- Two separated sections: **Code releases** (Git SHA, branch verified main, CI run, staged/active/failed, timestamp, actor) and **Content publications** (content revision, artifact version, validation state, actor, timestamp).
- Deployment detail: exact version/manifest checksums, health checks, step timeline, sanitized failure details, compatibility gates, rollback availability and impact.
- `Restore previous verified release` guarded and available only if runbook/permissions support it; content restores are different and cannot be represented as code rollbacks.
- Failed update does not deactivate healthy public artifact; show explicit `Serving previous healthy version`.

### 5.8 `/websites/:siteId/seo`

- Summary: Latest crawl, unresolved findings by severity, fixed past 30d, pages inspected vs budget, indexed/search data connection state.
- Findings table: Rule, affected URL/field, severity, evidence, first/last seen, remediation status, last checked, detail.
- Detail drawer: evidence/snapshot, versioned rule, why issue matters, automated fix eligibility, linked proposed publication, owner/exception notes, validation result. `Run audit` guarded by budgets and scheduling policy.
- Never imply actual search ranking from a technical rule check.

### 5.9 `/websites/:siteId/aio`

- Header explanation `AI-assisted content and machine-readability work, not guaranteed AI search rankings`.
- KPI cards: Eligible fields in AUTO, Fields in SUGGEST, Pending customer suggestions, Auto changes this period, AI costs.
- Tabs: Proposals, Published changes, Field permissions, AIO audits. Proposals table: page/field, original revision, proposed change, reason/evidence, mode, approval status, expiry, created; diff drawer split view, protected fact validation, link to customer approval flow. ORAP intervention audited.
- Field policy view: stable field ID, label/section, customer override, ORAP policy, effective mode, Protected lock indicator. A role with permission can disable AUTO on site; cannot authorize protected editing.
- `Pause AI publishing` emergency control is prominent but not decorative; actionable failure states and rollback links.

### 5.10 `/websites/:siteId/analytics`

- Top status row: GA4 connected/not connected, Search Console connected/not connected, last sync, selected property and date window.
- Charts: traffic trend from GA4 (users/sessions where available), top pages, acquisition categories; search impressions/clicks/CTR, queries/pages and comparison periods. Every chart labels **source, metric definition, date window, timezone, freshness**.
- `No data` distinct from `Not connected`, `No permission`, `Temporarily unavailable`, `Pending sync`. Do not imply SEO caused traffic changes merely because time series align.
- AIO referral evidence may be shown when attributable and reliably sourced; proxies separately labeled.

### 5.11 `/websites/:siteId/automation`

- Site job summary count by status, next scheduled run, current feature controls, crawl/AI budget, recent failures.
- Tabs Jobs / Schedules / Budget / Activity. Job table and details identical to global view filtered to site. Schedule editor uses permitted cadence choices with projected work/cost estimate and effective plan caps.
- Site budget shows current month, spent, reserved, remaining, hard-limit indicator, next reset date. `Pause site automation` asks for reason and explains public site remains online.

### 5.12 `/websites/:siteId/forms` (conditional)

- **Do not show until centralized contact form module exists and is released.** Then tabs: Forms / Submissions / Delivery / Spam.
- Form builder uses supported field schema only (name, email, phone, dropdown, message, required, validation, consent) and no arbitrary server code. ORAP toggles form enabled, recipient verified, Turnstile status, delivery behavior.
- Submissions: site-scoped table date, form, sender display (masked as appropriate), status, delivery; permissioned message drawer, 30-day retention with legal hold override and approved deletion process. No unrestricted export.
- Operational indicators include email delivery errors, spam challenged/rejected counts, missing consent policy. Customer editing permissions separately govern whether customers may edit forms.

## 6. Portfolio SEO & AIO

### 6.1 `/seo` portfolio overview

- KPI cards: Sites audited, Open critical issues, Automated changes published, Pending suggestions; month/time selector.
- Severity histogram and site comparison table with latest audit, open issues, audit age, site health; sorting prioritize risk not raw issue count alone.
- Recent changes/events on right. CTA to Audits / Findings / Proposals.

### 6.2 `/seo/audits`

- Filters: tenant/site/date/rule version/status; table Run ID, site, type, start/end, inspected URLs, issues detected, outcomes; detail displays crawl scope, budgets, errors, data freshness, bounded evidence.
- `Run selected audit` only for authorized sites and capacity; confirm quota impact. Failed audits show partial/failed rather than zero issues.

### 6.3 `/seo/findings`

- Work queue across customers; table Site / Affected page / Rule / Severity / Evidence age / Remediation eligibility / Status / Last change. Bulk filtering not bulk arbitrary fixes.
- Detail includes impact explanation, source evidence, history, safe fix preview, related publication and false-positive dismissal with audited reason. Visibility by role.

### 6.4 `/seo/proposals`

- Cross-site review; tabs Pending/Suggested/Published/Rejected/Expired/Failed; diff preview, protected validation, stakeholder review state, affected sites; batch actions only for compatible, authorized operations. Never silently accept customer SUGGEST proposals on their behalf.

## 7. Automation

### 7.1 `/automation` overview

- KPI cards queued, running, failed past 24h, dead-letter, worker availability. Site and job type filters.
- Charts queue depth and completion/failure over time with labeled timestamps; recent errors right rail; `Pause automation` requires scoped permission and reason.

### 7.2 `/automation/jobs`

- Search by safe job ID; filters site, type, status, queued period, error family, attempts; columns ID/type/site/status/queued/start/duration/attempt/trace/action.
- Context actions for eligible job: View, Cancel, Replay; ensure replay asks for justification, explicitly shows idempotency effects and policy revalidation.

### 7.3 `/automation/jobs/:jobId`

- Header state, job type, site, creation time; timeline Enqueued -> Claimed -> Running -> Completed/Failed/Cancelled; duration, attempts, worker ID (sanitized), policy version, cost reservation, related artifact/SEO finding, sanitized error and remediation.
- Buttons replay/cancel only when state permits; preserve previous failure history. No raw Redis payload or secrets visible.

### 7.4 `/automation/schedules`

- Table Site, Job type, Enabled, Local timezone, Cadence, Last run, Next run, last result, override source; editor drawer for policy-valid frequency, time window, jitter, maintenance exclusions and estimated workload; save produces audited policy event.
- `Pause all` only via emergency mechanism with confirmation. Daylight-saving behavior displayed when relevant.

### 7.5 `/automation/workers`

- Worker cards type, status, concurrency cap, active jobs, last heartbeat, last error; resource chart CPU/memory only from real telemetry. Drilldown to sanitized recent jobs. No Docker shell or arbitrary command execution in ORAP.

## 8. Analytics

### 8.1 `/analytics` portfolio

- All-site rollup of available GA4 and Search Console data with explicit connected-sites numerator/denominator, site/date filters, and no cross-site ambiguous aggregation. Show no aggregate when sources use incompatible metrics/time windows.
- Trends: GA4 sessions/users and GSC clicks/impressions as separate source-labeled charts; top properties/pages; site performance table. AIO proxy metrics never combined into unexplained single scores.

### 8.2 `/analytics/integrations`

- Table Site / GA4 state / GSC state / Last sync / Permissions / Error / Action. Row detail with property ID masked as needed, authorized connector account, permitted scopes, sync window, revocation/reconnect workflow, provider quota state.
- `Connect` flow must happen through vetted OAuth, never requesting account passwords. Never let staff choose unrelated tenant Google properties without verification.

## 9. Subscriptions

### 9.1 `/subscriptions`

- KPI active site subscriptions, pending grace-period expiry, suspended automation, plan distribution. Summary table and links to plans/assignments.
- Revenue metrics labeled **contracted/monthly amount**, not collected revenue, because automated payments are outside V1.

### 9.2 `/subscriptions/plans`

- Four default plan rows/cards Starter $500, Growth $1,000, Pro $1,500, Elite $2,000 monthly **subject to business approval**; columns price, site count, seat limit, audit cadence, content-review cycles, enabled-feature count, active site count, last edited.
- Creating/updating a plan requires versioning and displays impact on existing sites. Add explicit effect now/next billing period as policy allows. No direct Stripe/payment controls unless implemented.

### 9.3 `/subscriptions/plans/:planId`

- Header plan name, proposed/publication status, effective version, price; tabs General / Entitlements / Limits / Affected sites / History.
- General: name, description, monthly price, seat count, page allowance (commercial only if enforced), service promises, grace policy (14 days). Entitlements table effective checkboxes with backend availability state; don't expose features as sellable until deployable. Audit cadence and AI cycles via integers with bounds.
- Preview changes: sites impacted, current override exceptions, scheduled effects; require reason and confirm; show version history.

### 9.4 `/subscriptions/assignments`

- Site / tenant / plan / effective from / status / grace end / override count / actions; wizard change assignment with future/effective-date summary, plan mismatch warning, manual payment tracking status. No automatic charging implied.

## 10. AI Spending

### 10.1 `/spending`

- Cards platform monthly cap $50, spent, reserved, remaining, sites near cap. Period selector UTC monthly; cost chart and per-site table; estimated/actual/provider-usage distinctions.
- Alerts/thresholds and blocked tasks surfaced. Hard cap is enforced backend-side; UI is informational plus restricted admin controls.

### 10.2 `/spending/sites`

- Site rows: tenant, plan, $5 default budget, spent, reserved, remaining, next reset, recent jobs, policy override; edit budget modal with reason, projected platform-cap impact and explicit no-overage behavior.
- Cross-site sum does not automatically authorize larger $50 platform usage.

### 10.3 `/spending/ledger`

- Immutable usage/reservation/correction log: site, job, provider/model, price-version, estimated reservation, final observed cost, timestamp, correction, trace, status. Export restricted, privacy reviewed. Never manually edit historical amounts; use compensating entries.

## 11. Alerts

### 11.1 `/alerts` inbox

- Header `Alerts` plus open/acknowledged/resolved counts; tabs All/Open/Acknowledged/Resolved; filters severity, site, source, date, assigned to.
- List rows severity icon+text, issue title, affected service/site, first/last occurrence, repeat count, assigned owner, lifecycle status. Hover tools Acknowledge, Open, Resolve when authorized; immediate action requires audit, resolution may require reason.
- Global warning if email delivery adapter unhealthy; no implication that dashboard-only notice reaches a person during an outage.

### 11.2 `/alerts/:alertId`

- Header issue/severity/status; timeline detected -> notification attempted -> acknowledged -> resolved; source/job/site links, sanitized error evidence, incident fingerprint, remediation steps, owner/assignee, delivery history, retries, audit actions. Resolve requires explanation when indicated; reopen on recurrence based on policy.

## 12. Security & Audit

### 12.1 `/security` overview

- Cards staff accounts by status, sign-in failures (aggregated), active staff sessions, recent policy changes, pending invited users, authentication configuration warning.
- `Security attention` list (owner MFA enrollment, unrecovered sessions, weak/unset policy) with role-scoped links. No false assurance from checks not implemented.

### 12.2 `/security/staff`

- Table Name/email, platform role (Owner/Admin/Staff), status, MFA enrollment/requirement, last login, active session count, action; invite staff form with scoped role, invitation expiry, audited change, never default credentials.
- Owner role changes and last-owner removal require stronger checks; no uncontrolled escalation by Staff.

### 12.3 `/security/staff/:userId`

- Profile, role grants, active sessions with device/time, auth events (sanitized), pending invite, action history. `Revoke sessions`, `Disable`, `Change role` with reauth and audit. Password recovery token cannot be read or sent through arbitrary email fields.

### 12.4 `/security/audit`

- Searchable append-only log fields Timestamp/Actor/Role/Action/Scope/Target/Outcome/Reason/Trace; filters date, type, resource, actor, success/fail; detail view shows redacted before/after, relation links, correlation without secrets. Export access restricted and logged.

### 12.5 `/security/sessions`

- Staff permitted session management only; own sessions first. High privilege can revoke employee sessions with reason; identify login time, last seen, device label, effective expiry. Never show bearer token/session hash.

## 13. Platform settings

### 13.1 `/settings` index

- Grid of settings categories with plain-language description, current `Configured / Incomplete / Disabled` state, last checked date; no secret previews.

### 13.2 `/settings/platform`

- Platform display/branding, defaults locale/timezone, emergency freeze status, environmental status. Global kill switches separated from marketing preference switches; toggling includes impact summary, confirmation, reason and audit. Nonoverrideable protected-fact guardrails never disabled.

### 13.3 `/settings/email`

- Resend sender addresses (e.g. alerts/auth/forms as actually verified), sending-domain verification, recipient routing, failure retries, provider health, monthly cost ceiling and delivery logs. Credential state only `configured / missing / invalid`, never actual API key. Test send requires explicit authorization and bounded rate limit.

### 13.4 `/settings/google`

- OAuth project nonsecret reference, approved redirect origins, allowed scopes, connected-property inventory, sync health, failure/reconnection guidance, tokens inaccessible in UI. Scope consent copy must be policy-approved.

### 13.5 `/settings/cloudflare`

- Zone-scoped integration state, zone ID nonsecret reference, covered zones, domain verification strategy, dry-run DNS plan behavior, token last-tested timestamp, planned changes requiring explicit authorization. Never show or export token.

### 13.6 `/settings/openai`

- Model catalog and approved configured models, per-task selection, prompt template version, bounded output schema, global budget rule, safety switches, last validation/benchmark, provider health. No browser-facing API credentials and no generic freeform agent console for arbitrary production actions.

### 13.7 `/settings/backups`

- Current local/off-server backup policy, 7 daily + 4 weekly retention, encryption status **without key**, last archive/checksum verification, last isolated full restore, provider availability, RPO/RTO targets and alerts. Manual deletion only under explicitly permissioned audited workflow; no default delete button. Restore runbook link and gated restore-test initiation if implemented.

### 13.8 `/settings/deployment`

- Read-only GitHub source repo, `main` only production source, latest SHA/release, last deploy, health, rollback eligibility; non-main environments clearly labeled, approval/change runbook. Do not store private SSH keys in UI or allow arbitrary git branch production deployment.

### 13.9 `/settings/access`

- ORAP mandatory MFA policy; allowed MFA methods only if implemented and approved; customer optional MFA baseline; secure session duration, invite expiration and recovery instructions. Dangerous policy changes require owner approval, cannot lower ORAP requirement by mistaken toggle.

### 13.10 `/settings/data`

- Document references and statuses for privacy, analytics consent, legal holds, form submission retention, audit/job/revision retention and deletion, customer-facing policies. Missing policies show Pending Approval, never a generated legal approval. Any actual erasure workflow must be auditable and legally reviewed.

## 14. Reusable interaction flows (acceptance-level)

### Flow A: onboard a customer and website
1. ORAP Customers > Add customer; record business metadata and owner. 2. Websites > Register site; select tenant and valid repository contract. 3. Assign plan; inspect defaults and overrides. 4. Invite authorized customer owner. 5. Domain wizard verifies ownership and stages reviewed DNS plan. 6. Only after separate authorization and certificate health does site become publicly active. 7. Show onboarding progress checklist with non-blocking/pending step states.

### Flow B: staff disables autonomous text editing for one field
1. Website > AIO > Field permissions, select eligible field. 2. Switch AUTO to SUGGEST; show effective precedence and immediate effect on queued work. 3. Save with reason; pending auto publish rechecks policy and is denied. 4. New suggestions appear in customer dashboard for approval; protected facts untouched.

### Flow C: customer changes a protected fact
1. ORAP or customer dashboard routes authorized human to separate business-fact edit workflow. 2. Validate new value, source and permissions. 3. Audit fact change and affected page references. 4. Build, verify, publish a new revision. 5. AI never generated the replacement.

### Flow D: failed SEO automation job
1. Job fails; system persists error and event; site remains live. 2. ORAP Overview/Alerts shows actionable issue. 3. Authorized staff examines sanitized job detail and related site/finding; resolves underlying issue. 4. Replay triggers fresh tenant, feature, budget, and authorization checks; audit actor/reason. 5. Success resolves alert or staff records justification; no duplicate publication.

### Flow E: bad content publication
1. Build/validation/health fails. 2. Prior verified artifact remains active. 3. ORAP deployments page shows failed proposed revision and reason. 4. Staff may fix draft and retry or restore a prior content revision through authorized workflow. 5. History records all attempts, never rewrites audit.

### Flow F: edit plan and override one site
1. Subscriptions > Plans > selected plan > edit; see impacted active websites. 2. Save versioned plan after review and reason. 3. Websites > site > Settings > Features: override one eligible feature. 4. Effective-policy preview explains site override versus plan default. 5. Security invariants remain nonoverrideable.

### Flow G: provider disconnected
1. Google/Resend/Cloudflare integration reports revoked/missing. 2. Dashboard shows `Not connected` or `Needs attention` with timestamp, never misleading zero. 3. Staff sees reconnect requirements; provider OAuth flow uses verified callback. 4. Restored connection resumes bounded synchronization only after authorization and consent.

## 15. UI copy and nomenclature guidelines

- Use `Website` for a site instance, `Customer` for business tenant, `Member` for assigned customer user, `Staff` for ORAP identity, `Publication` for content artifact activation, `Deployment` or `Release` for Git-derived platform/site code update.
- Status words: Active, Draft, Disabled, Pending verification, Published, Failed, Reverted, Queued, Running, Completed, Cancelled, Open, Acknowledged, Resolved, Not connected, Unavailable, Stale, Over budget, Paused.
- Date/times explicit and zone aware; avoid `just now` without accessible exact timestamp. Display money as USD with cents. Show provider data source and freshness on metrics.
- Buttons use verbs (`Create website`, `Run audit`, `Review proposal`, `Pause automation`, `Acknowledge alert`). Avoid generic `Submit`, `OK`, `Fix all` where effects are ambiguous.
- Ensure editor permissions and customer-visible controls match actual backend entitlements; never show a successful toast before server acceptance.

## 16. Required frontend tests

- Every navigable route: unauthorized staff denied by backend and UI; direct URL cannot bypass sidebar visibility.
- Portfolio tables never reveal cross-tenant data to site-limited staff. Search never reveals unauthorized identifiers.
- Keyboard-only navigation: skip to main, sidebar, table action menus, filters, dialogs, diff review, forms and page tabs.
- Responsive viewport tests at 360, 768, 1024 and 1440 px; no horizontal document overflow, clipped actions or unreadable cards.
- Data states: loading, no data, no matching filters, error, provider disconnected, permissions missing, retention expired, partial sync, stale metrics.
- Form states: validation, duplicate submit, network error, stale revision conflict, edit while another user changes same policy, pending and canceled request.
- Safety: cannot turn Protected fact into AUTO; cannot edit platform MFA disabled; cannot push code from test branch to production; cannot view secret content; cannot delete last owner or bypass approvals; failed publish serves previous artifact.
- Charts: metric labels, accessible data table, dates/source/units, truthful missing data. Diff views highlight word changes accessibly and preserve exact protected tokens.
- Browser smoke: owner login + required MFA; create fictional tenant; assign site/plan; override setting; view audit; queue test job; acknowledge test alert; inspect publication history; reconnect mock Google status.

## 17. Recommended implementation sequence for Codex

1. Inventory current ORAP routes/components and produce a route-by-route `Implemented / Partial / Missing` matrix. Never replace stable functionality with a mock to match this spec.
2. Establish shared shell, design tokens, route guards, navigation, reusable states, PageHeader, Table and Modal components.
3. Build Overview, Customers, Websites list/detail and within-website tab shell first; wire to existing APIs and real authorization.
4. Add operational views: Automation, Alerts, Security & Audit, Spending; reuse existing backend services.
5. Add site management pages Content, SEO, AIO, Analytics, Domains, Deployments, Settings; mark incomplete backend actions unavailable, not faked.
6. Add Subscriptions and Integrations; conditionally include Forms only once implemented.
7. Complete settings subpages and operational readiness states; performance accessibility/security regression tests.
8. Align roadmap, architecture docs, QA acceptance reports and actual implementation status; present a signed-off UI acceptance checklist before production activation.

## 18. Decisions to get explicit owner review before coding certain actions

- Any UI that grants staff a new power (production rollback, domain apply, account bootstrap, manual backup deletion, cross-site edit rights) needs a reviewed authorization matrix.
- Customer-facing visibility for AI cost, detailed SEO findings, proposal review and form submissions should match tier and permission policy.
- Whether ORAP staff can directly edit a customer's site or must enter the same structured editor with role-based audit is not firmly established; use the same safe content contract either way.
- Exact global report definitions, agreed email/SMS notification policies, pricing and contract offerings are owner/commercial decisions, not UI defaults.
- Select final branding color/typography and ORAP hostname only after verifying current assets/configuration; the dimensions and interaction contract above do not depend on them.

**End of proposal.**


---
**Final task instruction:** Implement the complete ORAP UI and permission framework incrementally under the approved roadmap, with honest status reporting, no mock-only completion, strict Owner-only staff creation, configurable limited staff roles, and no changes to production systems without separate authorization.
