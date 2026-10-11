# ADR 0006: GitHub Actions/SSH deployment and external routing

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decisions:** D-012, D-013, D-014

## Context

Production shares a small VPS and Caddy with Christians Reunite. Deployment must be traceable, main-only, reversible, and additive. Cloudflare manages DNS, but registrar automation is not guaranteed.

## Decision

- GitHub Actions builds/tests the exact verified commit and transfers an immutable checksummed artifact over SSH.
- The authoritative repository is `OmniReach-Websites/SEO-Automation`.
- Production activation is allowed only from protected `main`, push-triggered, plus a separately permissioned manual recovery action. Branches/PRs run CI only.
- The SSH identity is dedicated, non-root, host-key verified, and limited to controlled release scripts/paths.
- The human OmniReach owner is the initial production approver and deploy-key custodian,
  and the planned restricted deployment account name is `omnireach-deploy`. The account
  receives neither unrestricted sudo nor Docker-daemon access. Account/key creation and
  production workflow binding remain separately authorized G31 actions.
- Do not disable root/password SSH until the non-root path and documented emergency
  recovery have both been tested. That deferral is not authorization to leave them enabled
  indefinitely or to change SSH now.
- G19 builds an inert reusable workflow and isolated SSH harness. G31 separately binds it to production after all gates and owner authorization.
- Releases serialize, stage to versioned paths, verify migrations/health, atomically switch, and automatically restore the prior pointer on failure.
- Reuse shared Caddy through minimal validated additive routes/imports. Never replace its compose project, ports, networks, or unrelated configuration.
- Inventory and check Christians Reunite before/after changes.
- Automate Cloudflare DNS plan/apply/verification with scoped credentials. Store the
  account ID and token, resolve the zone ID from the exact configured zone name using
  Zone Read, verify account ownership, and fail closed on zero or multiple matches. The
  zone ID is still required by Cloudflare's DNS endpoint but need not be a separate
  owner-supplied setting. Domain purchase/renewal remains manual in V1.

## Alternatives considered

1. **Build source on the production VPS:** rejected as default because CI-built artifacts reduce prod tooling, drift, and mutable checkout risk.
2. **Periodic `git pull`:** rejected because approved deployment is push-triggered and exact-artifact based.
3. **Production webhook running arbitrary shell:** rejected due trust and audit risk.
4. **Replace shared Caddy:** rejected because existing workloads must remain protected.
5. **Automate registrar purchase/renewal now:** deferred until API support, permissions, and financial approval exist.

## Consequences

- R-003 and R-010 are prerequisites for production activation; R-001/R-004 are required for domains/DNS.
- Workflows/config templates remain inert until G31.
- Database migrations must be forward-compatible; schema rollback is not assumed.
- Existing-workload health is a release gate, not a best-effort check.
- Creating accounts, changing SSH, installing services, or modifying shared Caddy each
  requires explicit owner authorization.

## Validation

G03 workflow policy, G17 domain state machine, G18 isolated Caddy validation, G19 SSH harness, G30 release drills, and G31 production evidence prove the decision.
