# ADR 0010: ORAP staff authorization and owner-only administration

- **Status:** Accepted
- **Date:** 2026-10-12
- **Decisions refined:** D-006
- **Authority:** `docs/OmniReach_ORAP_Codex_Master_Prompt.md`

## Context

The original fixed-role baseline proves platform versus customer identity separation,
but the current ORAP guard treats Platform Owner, Platform Admin, and Staff as broadly
equivalent. OmniReach needs agency employees with different duties and customer/site
assignments. A configurable role must not be able to manufacture ownership, provision
other employees, or see resources outside its assignment. Future ORAP modules also need
to become unavailable by default rather than inheriting an accidental broad staff grant.

## Decision

- Keep the approved global identity role kinds. `platform_owner` is the non-grantable
  Owner identity. `platform_admin` is a built-in staff-grade template, not an Owner.
  `staff` receives normalized role assignments and resource scopes.
- Only a current authenticated Platform Owner may invite/create/activate/disable/archive
  internal staff, initiate internal credential reset, assign/remove owner status, edit
  staff roles/permissions, or change staff role/resource-scope assignments. This is a
  direct server-side owner-identity invariant, not a permission key.
- The last active Platform Owner cannot be disabled, demoted, archived, or removed.
- Store a versioned source-defined permission catalog in PostgreSQL. Each stable key has
  module, label, description, risk, applicable scope, owner-only, step-up, reason,
  version, deprecation, and replacement metadata. Source/catalog drift fails closed.
- Seed editable role templates for Operations Manager, Website Developer, Content
  Editor, SEO Specialist, AIO Specialist, Account Manager, Support Representative,
  Billing Manager, and Analyst/Read-only Auditor. Owner changes create immutable role
  versions; they do not rewrite prior audit meaning.
- Normalize staff membership, role, permission, assignment, resource scope, invitation,
  access audit, and role-version data. Preserve the current `platform_memberships` row
  during a forward migration until the compatibility cutover is complete.
- Effective authorization is the intersection of active account/session, mandatory
  platform MFA, identity kind, active role versions, registered capability, resource
  scope, current site policy/entitlement/emergency state, and nonoverrideable security
  controls. Lists, counts, search, export, cache, and execution-time actions use the same
  scope.
- Owners have full functional access subject to authentication, step-up, confirmation,
  audit, tenant isolation, protected facts, budget, retention, and infrastructure gates.
  Owner status is not an application/database superuser bypass.
- Unknown or new capabilities are denied to every non-owner until an Owner deliberately
  includes them in a role. Owner-only catalog entries cannot be assigned to roles.
- Staff authority changes increment the account authentication-state version, revoke
  active platform sessions, invalidate authorization caches, and append non-secret
  before/after audit evidence transactionally.
- High-risk Owner actions require recent strong TOTP/WebAuthn verification or the
  separately approved one-use audited break-glass path. Email-only assurance is
  insufficient where ADR 0003 requires strong assurance.
- Customer-user administration remains separate and may be delegated through scoped
  customer-management capabilities. A Customer Owner is never an ORAP Owner.

## Alternatives considered

1. **Continue fixed global grants:** rejected because it gives every employee broad
   platform access and cannot express customer/site assignments.
2. **Use the existing JSON permissions field:** rejected because it lacks referential
   integrity, version history, catalog metadata, efficient scoped queries, and reliable
   default-deny behavior.
3. **Make staff provisioning a capability:** rejected because a custom role or compromised
   administrator could mint new privileged identities.
4. **Authorize only in the UI:** rejected because hidden routes and direct API calls must
   fail identically.
5. **Owner as PostgreSQL/application superuser:** rejected because ownership does not
   waive tenant, protected-fact, audit, budget, or operational safeguards.

## Consequences

- Existing broad ORAP routes require a capability registration and scoped-query cutover
  before limited staff can use them safely.
- Role/scope mutations are intentionally disruptive to sessions so removed authority is
  not retained until cookie expiry.
- Catalog additions require seed synchronization, documentation, and default-deny tests.
- Production staff lifecycle actions require a current Platform Owner session that
  completed mandatory ORAP two-step authentication. Per the owner-approved 2026-10-12
  policy change, staff-authority actions do not require an additional
  authenticator/passkey step-up; audited reasons, session invalidation, and last-owner
  protection remain mandatory. A future SMS step-up requires a separate policy change.
- The ORAP UI must hide unavailable modules for usability, but the backend remains the
  authoritative enforcement boundary.

## Validation

O01 proves migration/catalog integrity and default deny. O02 proves route/query/action
scope enforcement and immediate invalidation. O03 proves Owner-only lifecycle and
last-owner safeguards. O04 proves role versioning, scopes, and impact previews. O10 runs
the full adversarial cross-role/site/browser matrix.
