# Dependency maintenance review — October 14, 2026

**Reviewed against protected main:**
`d73ab70f62b3eebf15df958e2161e755f64855c7`  
**Review branch:** `feature/maintenance-review-20261014`  
**Scope:** historical Dependabot pull requests #1 through #6 and routine repository
verification discovered during the review

This review does not authorize blind merging. A green isolated package PR is not enough
when the package belongs to a coordinated runtime or toolchain family. Every selected
change must still pass protected checks against the then-current `main` before merge.

## Review results

| PR                                                                | Proposed change                                                                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                      | Disposition                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1](https://github.com/OmniReach-Websites/SEO-Automation/pull/1) | `actions/setup-node` 4.4.0 → 7.1.0                                                                              | Refreshed to current main. The diff changes only the pinned action SHA in the three workflow files. Both protected Branch CI runs `38580201110` and `38580209055` passed.                                                                                                                                                                                     | **Ready after maintenance fix lands and branch is refreshed again.** This removes the GitHub Actions Node 20 compatibility warning while preserving pinned immutable SHAs and the repository-selected Node version.                     |
| [#2](https://github.com/OmniReach-Websites/SEO-Automation/pull/2) | `actions/checkout` 4.4.0 → 7.0.1                                                                                | Refreshed to current main. The diff changes only the pinned action SHA and retains `persist-credentials: false` and exact-ref/fetch-depth controls. Run `38580211591` passed; duplicate run `38580201770` reached the disposable production stack and failed because only six of seven worker heartbeats had reappeared immediately after dependency restart. | **Hold until the bounded worker-recovery verifier fix is merged, then refresh and rerun both checks.** The failure is not evidence of a checkout-action incompatibility, but it is a real flaky routine check that must not be ignored. |
| [#3](https://github.com/OmniReach-Websites/SEO-Automation/pull/3) | Development-tooling group: `@types/node` 24.19.2 → 26.6.5, Prisma CLI 6.12.0 → 7.10.0, TypeScript 6.0.3 → 7.0.2 | Both current-main checks fail during dependency installation. `typescript-eslint@8.71.1` declares TypeScript support below 6.1, while the PR selects TypeScript 7.                                                                                                                                                                                            | **Do not merge.** Plan a coordinated TypeScript/ESLint/Prisma migration with compatible peer ranges, code-generation review, and full repository/runtime verification.                                                                  |
| [#4](https://github.com/OmniReach-Websites/SEO-Automation/pull/4) | BullMQ 5.61.2 → 6.3.12                                                                                          | Both current-main checks fail. The disposable production stack reports the `publisher` worker unhealthy under the major upgrade.                                                                                                                                                                                                                              | **Do not merge.** Investigate BullMQ 6 connection, worker, event, retry, and shutdown compatibility. Preserve durable PostgreSQL job state, idempotency, queue isolation, and all seven worker health guarantees.                       |
| [#5](https://github.com/OmniReach-Websites/SEO-Automation/pull/5) | `@prisma/adapter-pg` 6.12.0 → 7.10.0                                                                            | Both current-main checks pass, but Prisma CLI and `@prisma/client` remain at 6.12.0.                                                                                                                                                                                                                                                                          | **Do not merge independently.** Coordinate the adapter, client, CLI, generator, schema, migration workflow, and production migrator in one reviewed upgrade.                                                                            |
| [#6](https://github.com/OmniReach-Websites/SEO-Automation/pull/6) | `@prisma/client` 6.12.0 → 7.10.0                                                                                | Both current-main checks pass, but the adapter and Prisma CLI remain at 6.12.0.                                                                                                                                                                                                                                                                               | **Do not merge independently.** Include it in the coordinated Prisma 7 migration described for #5.                                                                                                                                      |

## Routine-operation repair

The production Compose verifier restarted PostgreSQL and Redis to prove persistence,
then immediately counted healthy worker kinds. Worker reconnection and heartbeat writes
are asynchronous, so one of two otherwise identical CI runs observed six kinds while
the other observed all seven.

The review branch changes the verifier to:

- require the exact expected set: `aio`, `crawler`, `monitoring`, `publisher`, `runner`,
  `scheduler`, and `seo`;
- restrict evidence to the disposable release SHA and current two-minute window;
- poll for at most 45 seconds after restart;
- fail with the observed and expected kind sets if recovery does not complete.

This is a bounded readiness assertion, not an unbounded retry or a weakened count check.
Static Compose validation, formatting, ESLint, documentation validation, and
`git diff --check` pass locally. The full disposable runtime check requires Docker; the
local Docker daemon was unavailable, so protected Linux CI is the required runtime
proof for this repair.

## Follow-up sequence

1. Merge the bounded verifier repair only after protected checks pass.
2. Refresh PR #1 and PR #2 onto the new protected main.
3. Re-review their immutable SHAs and workflow diffs.
4. Require both protected Branch CI checks for each PR before any merge.
5. Merge safe workflow-action changes one at a time and verify the exact production
   deployment before proceeding.
6. Leave PRs #3–#6 open or close them with the dispositions above; do not merge them as
   routine updates.

No production credential, provider setting, DNS record, database content, or shared VPS
service was changed during this review.
