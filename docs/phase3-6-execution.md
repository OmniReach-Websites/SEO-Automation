# Phase 3–6 Execution Record

**Updated:** 2026-10-13

**Branch:** `feat/phases-3-6`

**Production posture:** the owner authorized the Phase 3–6 production release, the existing Google OAuth credentials, the exact callback `https://admin.omnireach.cloud/v1/orap/integrations/google/callback`, and a $5/site/month AI ceiling on 2026-10-13. The private Cloudflare R2 bucket and bucket-scoped transport credential now exist, but scheduled encrypted backups and a real restore drill do not. Controlled AI execution, final commercial/legal decisions, and a second real customer remain TODO until the concrete evidence below exists.

Status vocabulary is strict: **Implemented** means code and local evidence exist; **Staging verified** requires a production-equivalent isolated environment; **Live** requires current production evidence; **Waiting** requires an owner/provider action; **Deferred** is outside V1.

## Outcome

| Phase                     | Repository result                                                            | Production state                                                                                                   | Evidence                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 3 — security/recovery     | Implemented and locally verified                                             | Private R2 transport is verified; VPS secret installation, schedule, retention, alerts, and restore drill are TODO | `npm test`, `npm run test:security`, `npm run verify:offsite-backup`; `security-test-matrix.md`; `key-rotation-break-glass.md` |
| 4 — Google/reporting      | Implemented and locally verified with provider fixtures                      | Credentials/callback approved; live property connection and comparison are TODO                                    | `google-integration-runbook.md`; Google unit/schema/route tests; customer report tests                                         |
| 5 — controlled AI         | Durable path and synthetic benchmark locally verified; provider defaults off | Model and $5/site ceiling selected; paid-provider benchmark, explicit activation and production smoke are TODO     | `ai-automation-readiness.md`; AI runtime, evaluation, policy, budget and proposal tests                                        |
| 6 — commercial/onboarding | Implemented controls and generic tooling                                     | Final pricing/legal decisions and an approved real second customer are TODO                                        | `commercial-readiness.md`; `legal-policy-readiness.md`; `onboarding-runbook.md`                                                |

## Phase 3 checklist

- [x] Customer TOTP enrollment, one-time recovery-code presentation, verification and password-reauthenticated disable; successful changes revoke sessions.
- [x] Exact-RP WebAuthn enrollment, password-first assertion sign-in, passkey list/rename/revoke, counter replay protection, one-use ceremonies and atomic session issuance.
- [x] Account security page and active session listing/revocation.
- [x] Platform mandatory second-step behavior retained; customer 2FA remains optional by default.
- [x] Auth Contract v3, exact-host tenancy, RLS and pool reuse/race suites remain passing.
- [x] Versioned MFA keyring, dry-run and bounded re-encryption tool, old/new key compatibility tests.
- [x] Authenticated encrypted backup archive, local/off-site S3-compatible adapter, list/verify/isolated-restore/dry-run-prune and corruption rejection.
- [x] Static public serving remains independent from API/database/Redis/workers/providers.
- [x] Private Standard-class R2 bucket and dedicated bucket-scoped S3-compatible credential created; upload/download-integrity/list/delete transport probe passed on 2026-10-13 without exposing credentials.
- [ ] **AUTHORIZED/PENDING EVIDENCE:** install the R2 credential and separately held encryption key in protected VPS secret storage, enable the scheduled job and alerts, and record the first verified copy and isolated restore.
- [ ] **Waiting:** schedule production backup and alerts, prove freshness, and complete a timed isolated restore against the 24h RPO/8h RTO targets.
- [ ] **Waiting:** authorized production key-rotation and lost-factor exercises.

## Phase 4 checklist

- [x] OAuth state/nonce/PKCE, exact redirect allowlist, least-privilege read scopes, encrypted server-side tokens and callback replay defense.
- [x] Exact public-host property matching, explicit property selection, consent provenance and audited disconnect/revocation.
- [x] Search Console/GA4 pagination, normalization, refresh, bounded retry/backoff, idempotent snapshots and freshness state.
- [x] `metrics_sync` runner handler uses verified job scope and stops when the centralized Google flag is off.
- [x] Customer reports separate GA4, Search Console, crawl, structured-data, publication, job and integration data with source/window/freshness/caveats.
- [x] Owner supplied the Google OAuth client credentials and approved the exact production redirect `https://admin.omnireach.cloud/v1/orap/integrations/google/callback` on 2026-10-13.
- [ ] **TODO:** finish/confirm the provider consent screen and connect only customer-authorized Search Console/GA4 properties.
- [ ] **Waiting:** compare real provider totals/time zones against the source consoles before any Live data-accuracy claim.

## Phase 5 checklist

- [x] Provider gate defaults off and is evaluated before cycle quota, budget reservation or provider call.
- [x] Tenant and platform hard ceilings, bounded output/timeout/retry/concurrency inputs, reservation release and emergency switches.
- [x] Deterministic checks cover protected facts, unsupported/prohibited claims, unsafe HTML/links, duplicate output and SEO title/description regressions.
- [x] Sanitized evaluation metadata records provider/model/prompt version, token counts, latency and micros cost.
- [x] Every generated result is persisted as a reviewable proposal. `AUTO` does not publish and does not bypass human review.
- [x] Proposal UI shows current/proposed text, evidence, rationale, model/mode and stale state; approval/edit creates a versioned draft; rejection is audited.
- [x] Publication still requires the ordinary preview/validation/publish path and retains rollback history.
- [x] Owner selected the quality-first `content-review-balanced` alias (`gpt-6.1-sol`) and a $5/site/month hard ceiling on 2026-10-13; the ceiling remains editable only through audited ORAP controls.
- [x] Tenant-scoped durable proposal material, atomic job admission, worker-side source/policy revalidation, dedicated `aio_proposal` worker, dated model-price records, immutable result linkage, and synthetic safety benchmark.
- [x] The provider flag is checked before database, quota, budget, or provider access; the API returns a stable disabled response while the flag is off.
- [ ] **TODO:** run and approve a representative paid-provider quality/cost benchmark, explicitly authorize activation, and capture production smoke evidence before enabling `OPENAI_PROVIDER_ENABLED`.

## Phase 6 checklist

- [x] ORAP plan/subscription/override/grace/emergency/AI-cap controls expose effective values and audit mutations.
- [x] Delinquency and subscription controls cannot disable existing static public artifacts.
- [x] Generic `site:onboard` and read-only `site:readiness` commands accept a manifest-driven config, reconcile idempotently, and avoid secret output.
- [x] Content fields map through manifest component/route identity rather than a Coop-specific prefix.
- [x] New generic contact forms are disabled pending verified recipient, consent and abuse-control approval.
- [x] Readiness covers domains, plan, owner/invitation, content/facts, workers, Google and backup evidence with `Waiting` distinct from a blocker.
- [ ] **TODO:** final price/setup/bespoke/overage/cancellation decisions.
- [ ] **TODO:** legal review of privacy, terms, consent, deletion/export and service commitments.
- [ ] **TODO:** approved second customer identity, content/facts, domains, form policy and Google consent for a real onboarding.

## Verification snapshot

On 2026-10-13 the branch passed:

- `npm run typecheck`
- `npm test` — 337 passed, 1 intentionally skipped
- `npm run test:integration` — 62 passed
- `npm run test:security` — 61 passed
- `npm run test:e2e` — 4 passed
- `npm run test:contracts` — 9 passed
- `npm run test:load` — 1 passed
- `npm run verify:all` — G01–G21 passed; after correcting the scheduler harness's seeded-database assumption, G22–G32 passed individually with the same registry commands.

The verified working-tree snapshot also passed formatting, lint, build, migrations, disposable production Compose, backup/restore harnesses, secret scan and every goal-registry command. Re-run the full registry on the final commit before deployment. Passing local tests does not convert any Waiting production item into Live.
