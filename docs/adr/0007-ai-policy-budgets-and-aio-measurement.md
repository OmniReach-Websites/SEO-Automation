# ADR 0007: AI policy, budgets, and AIO measurement

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decisions:** D-008, D-015, D-022

## Context

OpenAI assists with bounded SEO/AIO language tasks, but model output can be wrong, injected, malformed, or costly. OmniReach must protect facts, respect field permission, and report AIO honestly.

## Decision

- All OpenAI calls use one server-side adapter with configurable model aliases, official SDK/Responses API, typed Structured Outputs where supported, time/output limits, retries, rate control, redaction, and usage reconciliation.
- Models return proposals only. Deterministic services own context, authorization, per-field policy, facts, links, budget, persistence, staging, publication, and rollback.
- Handle refusal, incomplete output, schema incompatibility, and provider error as non-mutating outcomes. Parsed output remains untrusted.
- Enforce `AUTO`, `SUGGEST`, and `PROTECTED` per field. Off for an eligible AUTO field means SUGGEST. PROTECTED cannot be generated or mutated.
- Default hard cap is $5 USD per website per UTC calendar month, resetting 00:00 UTC on day one. Reserve conservatively and atomically; reconcile actual usage and corrections in an append-only ledger.
- Runtime workers use the PostgreSQL ledger. Reservation and finalization functions lock
  platform capacity before site capacity and update both counters atomically; the
  in-memory ledger is permitted only as a test double.
- Production uses a dedicated `OmniReach Production` OpenAI API project controlled by the
  human owner and adds an initial $50 USD platform-wide hard cap on the same UTC calendar-month reset
  boundary. Authorized ORAP roles may edit site and platform caps, but every change is
  audited with actor, old/new value, reason, and effective time. The concrete project
  reference remains an R-012 input; no key enters Git or chat. One atomic internal ledger
  must reserve capacity under both caps before any provider call.
- Select production models only after documented cost/quality testing. Paid production
  calls remain disabled until explicit owner authorization.
- Initial candidate aliases map `content-review-balanced` to `gpt-6.1-sol` and
  `content-review-economy` to `gpt-6-luna`. Aliases remain configurable and require
  representative quality/cost evaluation. `OPENAI_PROVIDER_ENABLED=false` is the
  fail-closed production default even when a key is present.
- Report verifiable referral traffic, structured-data completeness, and sampled mentions separately. Sampled results retain prompt/provider/model/time/context/repetition/limitations and never become an unexplained ranking score.

## Alternatives considered

1. **Model directly edits DB/files/site:** rejected because authorization, facts, concurrency, and rollback must be deterministic.
2. **Prompt-only fact protection:** rejected because model self-check is not an enforcement boundary.
3. **Platform-wide pooled budget only:** rejected because approved policy is per website.
4. **Hardcoded model ID/pricing:** rejected because models/prices change and need benchmarked configuration.
5. **Proprietary AIO score/ranking claim:** rejected because external placement is not guaranteed or fully measurable.

## Consequences

- R-012 is required for paid/provider production calls, not offline mocks.
- Every retry/known charge is site/job attributable.
- Budget exhaustion stops noncritical AI work without affecting serving or deterministic audits.
- Schema-native SDK helpers should prevent type/schema drift; CI still tests output handling and server policy.

## Validation

G11 protected facts, G21 concurrent reservations, G25 adapter/evals, G26 end-to-end modes, G28 honest reporting, and G30 adversarial scenarios C–F prove the decision.

## Reference

- [OpenAI API — Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs): schema-constrained output, SDK schema helpers, and required refusal/incomplete-response handling. OmniReach still applies deterministic authorization and content-safety validation after parsing.
