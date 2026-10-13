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

This decision does not yet make paid calls live. The production runner still rejects
`aio_proposal` jobs by policy, no durable job-material record currently supplies the
field/evidence inputs to that runner, and the model-price ledger needs a dated price
record plus a representative benchmark. Those implementation and evidence items are
TODO; `OPENAI_PROVIDER_ENABLED` must stay `false` until they pass.

Before any paid activation the owner must record:

- approved model alias and provider project;
- representative fixture quality result and known failure modes;
- published input/output prices and the date checked;
- maximum output tokens, timeout, retry and concurrency;
- site and platform USD ceilings and plan cycle quotas;
- permitted sites/fields/modes, with protected fields excluded;
- prompt/response retention and provider data-processing decision;
- smoke-test, emergency-stop and rollback owner.

Estimate monthly cost as `(input tokens × input rate + output tokens × output rate) / 1,000,000`, multiplied by approved cycles and a retry margin, then ensure both hard caps are lower than the owner's maximum exposure. The owner authorization and ceiling now exist. Until the remaining job wiring, price record, benchmark, and production smoke evidence exist, paid production AI is **TODO/Disabled**, which is the safe completed posture.
