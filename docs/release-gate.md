# Release Gate Evidence

**Local gate date:** 2026-10-11  
**Scope:** Fictional data and loopback-only infrastructure  
**Production authorization:** G31 progression granted 2026-10-11; execution gates remain

## Current result

The complete local G01–G30 verification registry passes, so G30's pre-production gate is
complete. A bounded nine-sample VPS
observation also showed the existing containers healthy and the existing route returning
HTTP 200 throughout, but OmniReach was not running and the observation ended before the
planned 30 minutes. Repeating an idle-host observation would not prove OmniReach
capacity. Representative staging/activation soak, backup readiness, and production
release sign-off therefore remain G31 evidence rather than circular G30 prerequisites.

The dedicated security suite covers tenant/RLS isolation plus server-rendered XSS
escaping, same-origin state changes, host-only session cookies, upload/path isolation,
SSRF targets, and OAuth redirect/state/replay boundaries. Local PostgreSQL and Redis
containers are digest-pinned, loopback-only, resource/PID limited, and configured to
deny privilege escalation.

| Scenario               | Local evidence                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Tenant isolation   | PostgreSQL RLS/security suites, exact-host API/browser checks, and tampered job-scope rejection                                                                        |
| B — Customer editor    | Browser edit/publish/restore flow, bounded contract fields, media and immutable publication tests                                                                      |
| C — Protected facts    | Database worker privileges, proposal guards, token/literal fact regression corpus, and protected-mode pre-provider rejection                                           |
| D — Suggestions        | AUTO-off mode resolution, stale revision/policy/expiry checks, review controls, and permission reauthorization                                                         |
| E — Autonomous mode    | Budgeted provider mock, fact validation, ordinary publication/health failure rollback, and actionable alert primitives                                                 |
| F — AI budget          | Concurrent database reservation test admits one $3 request and denies the second under the $5 hard cap                                                                 |
| G — Main deploy only   | Branch CI policy, reusable workflow policy, checksum/lock/health failure restoration harness; production binding remains G31                                           |
| H — Existing workloads | Synthetic Caddy route fixture is byte-preserved; R-003 plus a bounded healthy pre-deployment observation are recorded; representative pre/post observation remains G31 |
| I — Domain onboarding  | IDN/collision/takeover/state/dry-run tests and isolated exact-host Caddy validation; real DNS/TLS requires R-001/R-004                                                 |
| J — Observability      | Durable scheduler lease/admission/dispatch, fingerprinted alert history, recorded email attempts, audited ORAP acknowledge/resolve and job cancel/replay controls      |
| K — Recovery           | Authenticated encrypted archive, nested-media restore, separate off-server checksum copy, wrong-key/corrupt/truncated rejection, retention, and isolated file restore  |
| L — Analytics honesty  | Not-connected/unavailable states and distinct referral/completeness/sampled-mention reporting with source/window/caveat                                                |

## Automated local gate

Run `npm run verify:goal -- G30`. It executes formatting, lint, type checks, unit,
integration, security, contract, browser, accessibility, ten-site load, deployment,
backup, Caddy, read-only-observer policy, and secret checks. It does not contact
production or paid providers. The production observation helper is prepared at
`tooling/vps-g30-observation.sh` but is not executed by this gate.

## Production evidence still required

1. Representative sanitized VPS resource evidence after G31 stages OmniReach and before
   public activation, plus the planned post-activation observation of existing Caddy and
   Christians Reunite routes.
2. Automated encrypted off-server backups meeting the 24-hour RPO and 7-daily/4-weekly
   retention target; the development-stage weekly manual download is insufficient.
3. The approved G31 window is 2026-10-18 02:00–04:00 America/Chicago. The exact change
   set, prechecks, rollback evidence, scoped SSH/GitHub credentials, and pre/post
   existing-service checks remain required.
4. Resolve the mismatch between the inventoried `srv1789012` SSH target and the current
   proxied Cloudflare apex origin before installing access or approving a DNS plan.
5. A deliberately unhealthy production candidate proving automatic prior-release restore.
6. Owner production-release sign-off that no critical/high blocker remains under the
   supplied R-013 objectives.

## Phase 3–6 branch evidence (2026-10-13)

Before merge/deploy, the final branch must pass formatting, lint, types, unit,
integration, security, browser, contract, migration, Compose, backup, secret and full
goal-registry checks. The current development snapshot has passed formatting, lint,
types, 337 unit tests (one intentional skip), 62 integration tests, 61 security tests,
nine contract tests, one load test, four browser tests, and all G01–G32 registry
commands. These results are local evidence only and must be repeated on the final commit.

Additional pass/fail criteria:

- **Fail** on any cross-tenant access, stale/revoked-session acceptance, WebAuthn
  counter reuse, factor change without reauthentication, protected-fact mutation,
  direct AI publication, cap bypass, secret scan finding, corrupt-backup acceptance,
  non-isolated restore target, or static-site dependency on an application service.
- **Pass locally** only when Google and AI missing credentials surface disabled/Waiting
  states, rather than mock success, and the generic onboarding command is idempotent.
- **Production Waiting** until R2 upload/restore/freshness, Google consent/real property,
  legal/commercial decisions and paid-AI authorization (if desired) have their own
  evidence. None is required to keep those optional providers safely disabled.
