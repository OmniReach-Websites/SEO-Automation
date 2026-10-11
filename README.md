# OmniReach SEO Automation

OmniReach is an agency-operated, multi-tenant website hosting and SEO/AIO platform. The
repository contains the locally verified platform foundation through the pre-production
release gate. Production activation and real-customer onboarding remain human-gated.

## Start here

- Product and architecture source of truth: [`docs/masterplan.md`](docs/masterplan.md)
- Dependency-ordered delivery plan: [`docs/roadmap.md`](docs/roadmap.md)
- Architecture baseline: [`docs/architecture.md`](docs/architecture.md)
- Repository rules: [`docs/repository-conventions.md`](docs/repository-conventions.md)
- Setup guide: [`docs/setup-guide.md`](docs/setup-guide.md)
- Release-gate evidence: [`docs/release-gate.md`](docs/release-gate.md)
- Production Compose/runbook: [`docs/production-compose.md`](docs/production-compose.md)

## Toolchain

- Node.js 24.21.0 LTS
- npm 11.19.0

Use the pinned versions from `.nvmrc` and `packageManager`. Then run:

```powershell
npm ci
npm run verify:all
```

The verification suite uses loopback infrastructure and fictional data. It does not
provision production infrastructure or call paid providers.
