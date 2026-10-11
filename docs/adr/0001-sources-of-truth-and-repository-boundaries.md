# ADR 0001: Sources of truth and repository boundaries

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decisions:** D-017, D-024

## Context

OmniReach needs one public-capable monorepo for platform/site source while customers and automation edit content at runtime. Treating a production checkout as both application source and mutable content would create deploy loops, merge conflicts, secret leakage, and unrecoverable ambiguity.

## Decision

- GitHub `main` is authoritative for reviewed source code, templates, manifests, migrations, workflows, and sanitized configuration.
- PostgreSQL is authoritative for live editable content, verified facts, revisions, policy, and operational metadata.
- The configured media adapter is authoritative for original uploads; V1 uses a persistent local filesystem outside Git.
- Published versions are immutable artifacts identified by code SHA, content revision, asset-manifest hash, contract/build versions, and checksums.
- Runtime content never commits or pushes to `main`. A future sanitized export may use a non-deploying bot branch/artifact after separate approval.
- G01 documentation precedes application implementation. The roadmap controls dependency order and status.

## Alternatives considered

1. **Commit every customer edit to `main`:** rejected because it creates recursive deploys, content/source conflicts, privacy risk, and production authorship.
2. **Store editable content in site source files only:** rejected because concurrency, revisions, authorization, transactions, and tenant isolation become fragile.
3. **Separate repository per customer:** rejected because the approved product decision requires one monorepo and shared contract/tooling.

## Consequences

- A release is reproducible only when all source/content/asset identifiers are recorded.
- Git backup does not recover customer runtime data; database/media backups are mandatory.
- The public repository must exclude real customer data, originals, backups, credentials, and unsanitized exports.
- Content publication and code release are separate workflows.

## Validation

G02 secret/ignore checks, G11 revisions, G13 artifact manifests, G16 publication, G19/G31 deployment, and G29 recovery prove the decision.
