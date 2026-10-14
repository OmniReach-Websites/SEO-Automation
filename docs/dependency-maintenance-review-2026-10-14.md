# Dependency maintenance review — October 14, 2026

**Initial review baseline:** `d73ab70f62b3eebf15df958e2161e755f64855c7`

**Final application/maintenance commit:** `2cf8302b039b3b1be481edb40d112b84db554bd4`

**Review branch:** `feature/maintenance-review-20261014`

**Scope:** historical Dependabot pull requests #1 through #6 and routine repository
verification discovered during the review

This review does not authorize blind merging. A green isolated package PR is not enough
when the package belongs to a coordinated runtime or toolchain family. Every selected
change must still pass protected checks against the then-current `main` before merge.

## Review results

| PR                                                                | Proposed change                                                                                                 | Evidence                                                                                                                                                                                                                                                                        | Disposition                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1](https://github.com/OmniReach-Websites/SEO-Automation/pull/1) | `actions/setup-node` 4.4.0 → 7.1.0                                                                              | Refreshed after the maintenance repair. The diff changed only pinned action SHAs. Both protected checks `38582993746` and `38583006116` passed, followed by exact-main CI `38583492763` and deployment `38583492784`.                                                           | **Merged and deployed** as `2848e4fb604b43a25ac79c1edc405c1ae44db729`. The repository-selected Node version and immutable action pinning are preserved.                                                           |
| [#2](https://github.com/OmniReach-Websites/SEO-Automation/pull/2) | `actions/checkout` 4.4.0 → 7.0.1                                                                                | Refreshed after #1. The diff changed only pinned action SHAs and retained `persist-credentials: false` plus exact-ref/fetch-depth controls. Both protected checks `38584662472` and `38584672613` passed, followed by exact-main CI `38585086048` and deployment `38585086093`. | **Merged and deployed** as `2cf8302b039b3b1be481edb40d112b84db554bd4`. The final main CI has no deprecated Node 20 action annotation.                                                                             |
| [#3](https://github.com/OmniReach-Websites/SEO-Automation/pull/3) | Development-tooling group: `@types/node` 24.19.2 → 26.6.5, Prisma CLI 6.12.0 → 7.10.0, TypeScript 6.0.3 → 7.0.2 | Both current-main checks fail during dependency installation. `typescript-eslint@8.71.1` declares TypeScript support below 6.1, while the PR selects TypeScript 7.                                                                                                              | **Do not merge.** Plan a coordinated TypeScript/ESLint/Prisma migration with compatible peer ranges, code-generation review, and full repository/runtime verification.                                            |
| [#4](https://github.com/OmniReach-Websites/SEO-Automation/pull/4) | BullMQ 5.61.2 → 6.3.12                                                                                          | Both current-main checks fail. The disposable production stack reports the `publisher` worker unhealthy under the major upgrade.                                                                                                                                                | **Do not merge.** Investigate BullMQ 6 connection, worker, event, retry, and shutdown compatibility. Preserve durable PostgreSQL job state, idempotency, queue isolation, and all seven worker health guarantees. |
| [#5](https://github.com/OmniReach-Websites/SEO-Automation/pull/5) | `@prisma/adapter-pg` 6.12.0 → 7.10.0                                                                            | Both current-main checks pass, but Prisma CLI and `@prisma/client` remain at 6.12.0.                                                                                                                                                                                            | **Do not merge independently.** Coordinate the adapter, client, CLI, generator, schema, migration workflow, and production migrator in one reviewed upgrade.                                                      |
| [#6](https://github.com/OmniReach-Websites/SEO-Automation/pull/6) | `@prisma/client` 6.12.0 → 7.10.0                                                                                | Both current-main checks pass, but the adapter and Prisma CLI remain at 6.12.0.                                                                                                                                                                                                 | **Do not merge independently.** Include it in the coordinated Prisma 7 migration described for #5.                                                                                                                |

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
`git diff --check` passed locally. Protected Linux CI then ran the full disposable
runtime twice on PR #69 and again on each subsequent branch and main release; all
post-repair runs passed.

## Completed release sequence

1. The bounded verifier repair passed both protected checks in PR #69 and deployed as
   `ad04297bbd1909b80ab341d6c8df09b92759dd5f`.
2. PR #1 was refreshed, re-reviewed, re-tested, merged, and deployed independently.
3. PR #2 was refreshed on top of #1, re-reviewed, re-tested, merged, and deployed.
4. Final main CI and deployment passed on `2cf8302b039b3b1be481edb40d112b84db554bd4`.
5. PRs #3–#6 remain unmerged under the coordinated-upgrade dispositions above.

No production credential, provider setting, DNS record, database content, or shared VPS
service was changed during this review.
