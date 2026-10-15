# Controlled AI Automation Readiness

`OPENAI_PROVIDER_ENABLED` defaults to `false`. No scheduler, route, replay or manual job can bypass that gate. It is checked before review-cycle quota, budget reservation or provider use. Site and platform emergency stops, protected fields, plan entitlement, tenant context, per-site and platform monthly caps and output/time bounds remain deterministic application controls.

The evaluation corpus covers metadata, ordinary service copy, crawl summaries and structured-data recommendations using approved facts. Checks reject unsafe HTML/links, prohibited or unsupported claims, changed protected facts, duplicate content and title/description regressions. Stored evaluation input is sanitized and hashed; records include provider/model/prompt version, evidence, token counts, latency and micros cost without placing secrets or arbitrary sensitive prompts in logs.

Both `SUGGEST` and `AUTO` results are stored as proposals. `AUTO` means eligible automated preparation, not publication. The customer reviews current versus proposed content, evidence, rationale, source/model/mode and cost metadata. Approval or an edited approval creates/updates a versioned draft. Rejection is audited. Revision, policy, source-hash or expiry mismatch marks the proposal stale. Publication still requires normal validation, preview, controlled publication and rollback.

## Enablement decision record

On 2026-10-13 the owner selected the quality-first `content-review-balanced` alias,
currently mapped to `gpt-6.1-sol`, and approved a $5 per-site UTC calendar-month hard
ceiling. The ceiling is the existing default and remains changeable only through the
audited ORAP budget control. The platform-wide $50 hard ceiling remains an additional
safety bound.

This decision does not make paid calls live. The repository now has a tenant-scoped,
RLS-protected durable job-material record, atomic job admission, worker-side source and
policy revalidation, a dedicated resource-limited `aio_proposal` worker, immutable
proposal-result linkage, and a synthetic deterministic safety benchmark. The request
route returns `503 ai_provider_disabled` and performs no database/provider work while
`OPENAI_PROVIDER_ENABLED=false`, which remains the production default.

The owner authorized a one-time production benchmark costing no more than $1 USD on
2026-10-15. Migration `20261015183000_ai_runtime_reservation_caps` adds atomic optional
request-scoped site and platform ceilings to the same reservation transaction used by
normal proposal generation. A benchmark process must set an owner-approved request cap;
both the site and platform month-to-date
usage plus active reservations must remain within that ceiling before each provider
request. This is deliberately conservative if unrelated usage already exists.

The owner installed the dedicated-project credential and authorized the controlled test
on 2026-10-15. A nonbillable model lookup returned HTTP 200 for `gpt-6.1-sol`. The first
provider-reaching attempt exposed an accounting-order defect after reserving at most
3,377 USD micros; it persisted no proposal or usage entry. The defect was corrected so
provider usage is reconciled before local safety evaluation, while rejected output still
cannot be staged. The follow-up call recorded a 2,240 USD-micro charge ($0.002240), but
the output failed deterministic proposal evaluation. No proposal, draft, revision, build,
or publication was created. Conservatively treating the entire first reservation as
spent places total possible benchmark exposure at no more than $0.005617.

`OPENAI_PROVIDER_ENABLED=false` remains the production setting. The benchmark service is
manual-only under the Compose `benchmark` profile, and the temporary report endpoint was
removed after evidence collection. Model access and cost enforcement are verified;
safe-content quality, prompt-injection resistance, protected-fact preservation, and
proposal persistence did not pass end-to-end and must not be represented as verified.

The dated price ledger records the official 2026-10-14 standard rates used only for
budget reservation and reconciliation: `gpt-6.1-sol` at $2/M input and $10/M output
tokens, and `gpt-6-luna` at $0.10/M input and $0.50/M output tokens. Source checked on
2026-10-15: `https://platform.openai.com/pricing`. A configured alias must
match both the provider model and a currently effective dated price row or execution
fails closed.

Before any paid activation the owner must record:

- approved model alias and provider project;
- a passing representative paid-provider quality result; the current known failure mode
  is deterministic proposal-evaluation rejection;
- published input/output prices and the date checked;
- maximum output tokens, timeout, retry and concurrency;
- site and platform USD ceilings and plan cycle quotas;
- permitted sites/fields/modes, with protected fields excluded;
- prompt/response retention and provider data-processing decision;
- smoke-test, emergency-stop and rollback owner.

Estimate monthly cost as `(input tokens × input rate + output tokens × output rate) / 1,000,000`, multiplied by approved cycles and a retry margin, then ensure both hard caps are lower than the owner's maximum exposure. The bounded benchmark is complete but did not pass safety evaluation. Until a representative benchmark passes and ongoing activation is explicitly authorized, paid production AI is **TODO/Disabled**, which is the safe completed posture.
