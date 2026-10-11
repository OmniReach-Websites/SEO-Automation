# OmniReach Setup Guide

This guide covers the verified local environment and the owner-input checklist for an
eventual production activation. Commands are PowerShell and run from the repository
root. Do not substitute production domains or credentials into tracked files.

## 1. Install prerequisites

1. Install Git, Docker Desktop, and Node.js `24.21.x`.
2. Enable Docker Desktop's Linux container engine.
3. Install npm `11.19.x`: `npm install --global npm@11.19.0`.
4. Confirm versions with `node --version`, `npm --version`, and `docker version`.

## 2. Install the repository

```powershell
git clone <your-approved-repository-url>
Set-Location '<your-clone>\SEO-Automation'
npm ci --ignore-scripts
npx playwright install chromium
```

The project pins dependencies in `package-lock.json`. Do not use unreviewed package
updates while setting up an environment.

## 3. Create local configuration

1. Copy `.env.example` to the ignored `.env.local` file.
2. Generate four independent secrets:
   - `SESSION_SECRET`: at least 32 random characters.
   - `MFA_ENCRYPTION_KEY`: a different value of at least 32 characters.
   - `PREVIEW_SIGNING_KEY`: another independent value of at least 32 characters.
   - `CONTACT_ENCRYPTION_KEY`: exactly 32 random bytes encoded as 64 hexadecimal characters.
3. Keep the fictional loopback `DATABASE_URL`, `REDIS_URL`, and `ORAP_HOSTNAME` defaults.
4. Leave provider keys and production-only backup settings blank. Local tests use mocks.
5. Set `SOURCE_COMMIT_SHA` to a 40-character lowercase commit SHA.

Example secret generation:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run it separately for every key. Never reuse or commit the results.

## 4. Start local infrastructure

```powershell
docker compose -f infrastructure/compose/dev.compose.yml up -d
docker compose -f infrastructure/compose/dev.compose.yml ps
```

PostgreSQL binds only to `127.0.0.1:54320`; Redis binds only to
`127.0.0.1:56379`. Both should report `healthy`.

## 5. Initialize fictional local data

```powershell
$env:DATABASE_URL='postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev'
npm run db:migrate
npm run db:seed
npm run verify:local-stack
```

Migrations are forward-only. The seed contains fictional tenants, sites, users, domains,
contracts, entitlements, content, and artifacts.

## 6. Configure and start the API

Load `.env.local` and run:

```powershell
npm run dev:api
```

For local hostname testing, map only fictional `.test` names to `127.0.0.1` in your hosts
file. Keep ORAP and each customer admin hostname distinct. Never use a production domain
in a workstation hosts file.

Verify:

```powershell
Invoke-WebRequest http://127.0.0.1:4100/health/live
Invoke-WebRequest http://127.0.0.1:4100/health/ready
```

## 7. Run the complete local verification suite

```powershell
npm run verify:all
```

Individual infrastructure checks are also available:

```powershell
npm run verify:queue-runtime
npm run verify:scheduler-runtime
npm run verify:alert-lifecycle
npm run verify:ai-budget
npm run verify:caddy
npm run verify:deploy-harness
npm run verify:backup-harness
npm run test:load
```

These use fictional/temporary data and do not contact Cloudflare, Google, OpenAI, an
email provider, or a production server.

## 8. Build customer site fixtures

```powershell
npm run build --workspace @omnireach/site-starter
npm run build --workspace @omnireach/site-restaurant-example
npm run build --workspace @omnireach/site-custom-portfolio-example
npm run check:site-builds
```

Every custom site must pass the versioned OmniReach integration contract before it can
be registered or published.

## 9. Production preparation—owner input required

Do not continue to production until the owner supplies and approves every applicable
R-001 through R-013 item in `docs/roadmap.md`. In particular, obtain:

1. Actual ORAP/domain values and scoped Cloudflare authorization.
2. Production owner identity, MFA/recovery custody, break-glass and change approvers.
3. Authorized read-only VPS/Caddy/Christians Reunite inventory access.
4. GitHub protected-environment approvers, restricted SSH account, pinned host key, and secret custody.
5. Off-server backup destination, encryption custody, storage budget, and deletion authority.
6. Legal/privacy/consent/retention policies and operating jurisdictions.
7. Google OAuth/property permissions, urgent-email provider, and contact-form delivery policy.
8. Commercial plan/pricing/grace period and OpenAI project/spending authorization.
9. Availability, maintenance, capacity, RPO/RTO, and incident-escalation objectives.

Record nonsecret choices and approval status in the owner-input worksheet at
`docs/production-inputs.md`. Deliver credentials only through the approved secret
channel; never paste them into that worksheet, an issue, a commit, or a chat transcript.

## 10. Production activation and pilot

G31 and G32 are intentionally human-gated. Follow `docs/operations.md` one checkpoint at
a time: inventory, backup readiness, restricted deploy identity, protected `main`
environment, exact artifact/checksum, forward migrations, additive Caddy fragment,
health checks, existing-service checks, rollback proof, owner bootstrap/MFA, then the
fictional rehearsal. Onboard a real pilot only after separate explicit authorization,
approved legal policies, verified protected facts, and customer acceptance.
