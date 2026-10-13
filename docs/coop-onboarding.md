# Coop onboarding and readiness

Required inputs: verified owner email, explicit plan code/version, domain-control
confirmation, reviewed protected facts/legal copy, active Platform Owner inviter ID, and
a protected invitation-output path. Never commit a filled config or invitation.

Copy `infrastructure/onboarding/coops.example.json` outside the repository, replace every
placeholder, set `DATABASE_URL` through the approved secret mechanism, and preflight:

```text
npm run coop:diagnose
```

It checks unique site/contract, domains, plan, edit/publish features, owner/invitation,
content/facts/revision, worker heartbeats, and DNS without printing credentials.

Staging application and idempotency proof:

```text
npm run coop:onboard -- --config C:/protected/coops.staging.json
npm run coop:onboard -- --config C:/protected/coops.staging.json
npm run coop:diagnose
```

The command reconciles exact source/hosts, refuses conflicting ownership, never
downgrades a verified domain, requires an existing plan, upserts fields, creates at most
one baseline revision, reuses memberships, and revokes superseded pending invitations.

For production: back up DB/platform data; diagnose; independently verify DNS; obtain
plan/fact approval; apply; save returned site UUID as `COOPS_SITE_ID` in the protected
environment; diagnose again; deliver the one-time invitation securely; deploy; perform a
small approved edit/publish/restore smoke. `admin.coopsmobiledetailingaledo.com` should
use an `A` record to the VPS public IPv4 (`AAAA` only if routed IPv6 exists). Caddy routes
that exact host to `omnireach-api:4100` and obtains TLS.
