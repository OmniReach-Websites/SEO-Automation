# ADR 0004: Site integration contract and custom designs

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decisions:** D-007, D-008, D-020

## Context

OmniReach must support completely custom agency-built frontend designs while safely exposing structured editing and automation. Inferring editable regions from arbitrary DOM/source would be unreliable and unsafe.

## Decision

- Every managed site implements a versioned typed/runtime-validated manifest declaring stable page/section/field IDs, types, permissions, AI modes, protected fact references, build/preview/health behavior, and bounded contact forms.
- PostgreSQL stores live values as versioned structured JSON keyed by stable IDs, with optimistic concurrency and immutable revisions.
- Custom visual structure and styling are unrestricted within platform security/build constraints; the contract standardizes management behavior, not design.
- Protected facts live separately. Immutable references may embed them in marketing content; protect the whole field if safe separation is impossible.
- V1 supports static/prerendered sites and bounded contact forms. Complex applications need a separate approved adapter/RFC, data store, backup, threat model, and deploy plan.

## Alternatives considered

1. **Single mandatory visual template:** rejected because custom design freedom is approved.
2. **AI/DOM inference of editability:** rejected because IDs, permissions, facts, and migrations would be ambiguous.
3. **Arbitrary customer HTML/code editing:** rejected because OmniReach is agency-first and must protect security/serving integrity.
4. **Arbitrary server plugins in the shared runtime:** rejected for V1 isolation and operations risk.

## Consequences

- Site onboarding includes explicit contract work and tests.
- Schema/ID changes require migrations and backward compatibility.
- Two distinct designs must pass the same contract suite.
- A custom design that lacks the contract remains publishable only as unmanaged source; customer editing/automation stays disabled.

## Validation

G09 validator, G10 distinct fixtures, G11 content/fact tests, G13 builds/forms, and G30 contract/security suites prove the decision.
