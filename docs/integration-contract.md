# OmniReach Site Integration Contract

**Status:** G01 design contract; executable schema begins in G09  
**Audience:** OmniReach developers integrating agency-built customer sites

## 1. Purpose

The contract lets OmniReach manage content, facts, previews, contact forms, audits, builds, and publication across completely custom frontend designs. It standardizes integration behavior, not appearance. A customer site may use unique components, layout, styling, information architecture, and frontend implementation as long as its approved adapter produces a compliant static artifact.

The contract does not turn OmniReach into a self-service builder. Staff create and register sites. Customers can edit only declared fields and supported structural operations.

## 2. Required manifest identity

Every site manifest declares:

- `contractVersion`: supported positive version.
- `siteSlug`: globally unique source mapping; no tenant/customer secret.
- V1 uses the approved static Astro adapter with an exact workspace dependency version;
  custom design does not imply an arbitrary runtime or build command.
- locales/timezone and canonical route policy.
- routes/pages and their stable sections/fields.
- protected fact references.
- trusted workspace package and contained output directory. The runner invokes the
  reviewed workspace `build` script; manifests cannot inject shell commands.
- preview capability and health checks.
- optional bounded contact-form declarations.

The executable schema and TypeScript types created in G09 are authoritative. This document describes required semantics without claiming the schema already exists.

## 3. Stable IDs and content model

IDs are durable API/database keys, not display labels or array positions.

```text
page:    home
section: home.hero
field:   home.hero.title
fact:    business.hours
form:    contact.primary
```

Changing a component name or visual layout must not silently change a field ID. Removing/renaming an ID requires a contract/content migration that preserves revisions and published artifacts.

Live values are not committed in the manifest. PostgreSQL stores versioned structured JSON values keyed by stable field ID. Values carry schema version, locale where applicable, provenance, current revision, and optimistic concurrency token.

## 4. Supported V1 field surface

- Plain text.
- Strictly allowlisted rich text.
- Image/media reference plus accessible alt text.
- Button label and validated link.
- Cards/list of known item schema.
- SEO title/description fields where explicitly exposed.
- Selected color/theme tokens.
- Visibility of known sections.
- Reordering of known sections/items.

No field grants arbitrary HTML, CSS, JavaScript, tracking identifiers, form destinations, security headers, server logic, environment values, or raw source access.

Each field declares:

- stable `id`, `kind`, schema/version, validation limits, and locale behavior;
- `customerEditable` and applicable role grants;
- AI eligibility/mode and data classification;
- protected fact references or whole-field protection;
- renderer/component binding and fallback behavior.

## 5. Per-field AI and protected facts

Allowed effective modes:

- `AUTO`: only approved marketing copy; default where declared eligible.
- `SUGGEST`: turning AUTO off yields a reviewable proposal.
- `PROTECTED`: provider generation and AI mutation are forbidden.

Prices, hours, dates, addresses, phone/email, legal text, guarantees, availability, booking/ordering conditions, verified identity, testimonials, and other material facts are separate verified fact records. A marketing field can reference them through immutable structured tokens. If safe separation is not possible, protect the whole field.

The contract cannot override system protection. No manifest, plan, ORAP switch, prompt, or customer preference may authorize AI changes to a protected fact. Authorized Customer Owners and ORAP staff use a separate audited human fact workflow.

## 6. Pages, routes, and rendering

- Routes are normalized, unique, bounded, and free of traversal, arbitrary query-space generation, or collisions.
- Canonical, sitemap, robots, structured data, headings, links, images, and facts are generated from declared hooks and verified data.
- The builder consumes one immutable snapshot. It must not query mutable live content during a build.
- Output is confined to the declared directory and validated before publication.
- Any reviewed `sites/*` workspace with a valid contract, matching package identity,
  pinned approved Astro adapter, and build script is discovered automatically. Adding a
  custom visual design does not require adding its name to application code.
- Builds cannot receive production provider keys or arbitrary shell/network authority.
- Every artifact records code SHA, contract version, content revision, asset-manifest hash, build versions, routes, checksums, and health expectations.

Public rendering must remain functional when API, Redis, workers, OpenAI, or Google are unavailable.

## 7. Preview contract

Preview uses a frozen draft snapshot and must be:

- authenticated and site/role scoped;
- short-lived and unguessable;
- `noindex` and excluded from sitemaps;
- isolated from production pages through origin and/or sandbox/CSP controls;
- visibly identified as draft with revision and expiry;
- incapable of using production form destinations or privileged browser credentials.

## 8. Optional contact-form contract

V1 contact forms are optional reusable components backed by OmniReach's centralized
submission service, not arbitrary server actions or per-customer backends. ORAP
administrators enable or disable forms per site. Authorized customer roles may configure
only supported field definitions and view only their own site's submissions. A form declares:

- stable form ID and allowed route/origin;
- allowed field IDs, types, required flags, and byte/length limits;
- consent text/version reference where required;
- server-side destination reference, never a browser-visible secret;
- success/failure UX and accessibility behavior;
- retention category and whether message content may be stored;
- abuse-control policy.

The platform validates exact site/form/origin, applies Cloudflare Turnstile, honeypots,
and rate limits, redacts sensitive logs, and sends through a centralized delivery adapter.
Attachments are disabled by default. Submitter confirmation email is optional and
disabled by default. Provider failure must not affect static page availability. R-009
activation inputs are required before a real form sends or retains customer submissions.

## 9. Media contract

- Manifests/content store asset IDs, not filesystem paths supplied by users.
- Originals use site-isolated opaque keys and remain outside Git.
- Uploads pass size, signature, decoded-dimension, type/SVG, integrity, and quarantine policy.
- Published artifacts reference immutable derivatives/manifest hashes.
- Removing an editor reference does not delete media used by any active artifact.
- Alt text is required or deliberately marked decorative according to component semantics.

## 10. Build and health contract

The site adapter exposes deterministic operations for:

1. Validate manifest and content snapshot.
2. Render preview from an immutable draft snapshot.
3. Build a production artifact from immutable source/content/assets.
4. Enumerate expected routes/files.
5. Run static/output checks.
6. Run pre-activation and post-activation HTTP/content/headers health checks.

The implementation must bound CPU, memory, duration, output bytes, and concurrency. A failed operation returns typed safe errors and never changes the active artifact.

## 11. Custom designs and complex applications

Allowed without a separate architecture:

- Completely custom visual design and component structure.
- Static/prerendered pages.
- Contract-managed content/media/sections.
- Bounded platform contact forms.

Requires a separate approved integration RFC/ADR:

- Reservations, ordering, commerce, authentication beyond OmniReach admin, or inventory.
- Arbitrary customer executable code or server-side plugins.
- Custom runtime/database, payment or regulated data.
- Third-party webhooks with business side effects.
- Customer-controlled scripts, tracking, or form destinations.

## 12. Developer onboarding checklist

1. Create the site under `sites/<site-slug>/` using fabricated data until onboarding is authorized.
2. Register a supported contract version and unique site slug.
3. Declare all routes, stable sections/fields, permissions, AI modes, and facts references.
4. Ensure no secret, live customer data, original private asset, or provider identifier is hardcoded.
5. Declare build/output/health behavior and bounded contact forms.
6. Run contract, type, build, link, HTML, structured-data, accessibility, security, and snapshot checks.
7. Demonstrate edits/previews/publication against fictional snapshots.
8. Demonstrate protected-fact rejection and cross-site isolation.
9. Obtain code review for manifest/schema migrations and any new adapter capability.
10. Register the site in ORAP only through the authorized agency workflow.

## 13. Contract compatibility

- Validators reject unknown major versions and unsafe commands/paths.
- Backward-compatible additions use optional/defaulted fields with tests.
- Breaking changes introduce a new contract version and migration guide.
- The platform supports the prior version until every registered site is migrated and its last healthy artifact remains recoverable.
- A contract migration never rewrites content/audit history silently.

## 14. Required contract tests

- Unique IDs/routes and contained paths/output.
- Supported field/component/form schemas and role/AI policy.
- Fact references exist and cannot be AI-editable.
- Link protocols, rich-text sanitization, Unicode, locale/timezone behavior.
- Build reproducibility, expected routes, missing media, no-index preview.
- Two materially different frontend designs satisfy the same contract.
- Static pages survive control/worker/provider outage.
- Form invalid-origin, cross-site, rate-limit, redaction, and provider-failure cases.
- No manifest contains credential-like data or production write endpoints.

See [`architecture.md`](architecture.md), [`security.md`](security.md), and [ADR 0004](adr/0004-site-integration-contract-and-custom-designs.md).
