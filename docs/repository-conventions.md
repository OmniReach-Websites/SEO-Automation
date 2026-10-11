# Repository Conventions

**Status:** G02 baseline  
**Scope:** source layout, tooling, dependency direction, review ownership, public-repository safety

## 1. Toolchain decision

The repository pins Node.js 24.21.0 LTS and npm 11.19.0. The exact versions are recorded in `.nvmrc`, `packageManager`, and `engines`. Node.js 24 is the active LTS line at the time of G02; upgrades require passing `verify:all` and documenting compatibility effects.

Primary reference: [Node.js v24.21.0 archive](https://nodejs.org/en/download/archive/v24.21.0).

TypeScript uses strict NodeNext/ES2024 settings. ESLint and Prettier are repository-wide. Vitest is the unit/integration runner; Playwright is reserved for outside-in/E2E behavior, even when an early structural test does not launch a browser.

## 2. Workspace naming

| Path              | Package prefix             | Role                                            |
| ----------------- | -------------------------- | ----------------------------------------------- |
| `apps/<name>`     | `@omnireach/<name>`        | Deployable control-plane UI/API applications    |
| `workers/<name>`  | `@omnireach/worker-<name>` | Queue/scheduler/monitoring entrypoints          |
| `sites/<name>`    | `@omnireach/site-<name>`   | Agency-built public sites and contract fixtures |
| `packages/<name>` | `@omnireach/<name>`        | Reusable libraries with explicit public exports |

Every workspace is private. Publishing to npm is prohibited unless a future ADR deliberately changes that rule.

## 3. Dependency direction

```text
apps/* ───────┐
workers/* ────┼──> packages/*
sites/* ──────┘       │
                      └──> lower-level packages only

packages/* -X-> apps/*, workers/*, sites/*
sites/*    -X-> apps/*, workers/*, database/auth/queue/ai internals
```

The machine-readable allowlist is `tooling/workspaces.json` and is enforced by `check-workspaces.mjs`. A new workspace dependency must be listed there and in the consuming `package.json`. Circular workspace dependencies are forbidden.

Intended package layering:

- `shared` is the lowest general utility/schema layer.
- `observability`, `database`, and `contracts` may depend on `shared` but not applications.
- `auth` and `tenant` may use the database/observability/shared layers.
- `content`, `queue`, `ai`, `seo-core`, and `integrations` use only their explicitly allowed lower layers.
- `ui` contains presentation primitives and may use `shared`/`contracts`; it does not access persistence/providers.

## 4. Package exports

G02 workspaces are documented placeholders and intentionally have no `src` directory or export map. When a package first gains implementation:

1. Source lives under `src/` with a deliberate `src/index.ts` public surface.
2. `package.json` declares explicit `exports` and `types` pointing to built `dist` output; deep imports not listed in `exports` are unsupported.
3. Internal modules remain unexported.
4. Build output is never hand-edited or committed unless a future packaging decision requires it.
5. The workspace gains real lint/type/unit tests; empty pass-through tests are prohibited.

Applications, workers, and sites do not expose package APIs unless explicitly documented.

## 5. Files and naming

- Directories/packages: lowercase kebab-case; the approved `_starter` site is the only leading-underscore exception.
- TypeScript source: kebab-case filenames; components may use PascalCase when framework conventions require it.
- Stable domain IDs use opaque database IDs; source slugs and contract field IDs are not authorization.
- Tests end in `.test.ts`; Playwright E2E tests end in `.spec.ts`.
- Generated files, artifacts, media, runtime data, and backups remain outside source directories and Git.

## 6. Public-repository rules

Allowed:

- Source, templates, manifests, migrations, tests, fictional fixtures, sanitized config, and public-intended assets.

Forbidden:

- Real customer records/content, private original uploads, form submissions, analytics exports, database dumps, backups, production artifacts, logs, tokens, credentials, private keys, OAuth material, session values, recovery codes, or real provider/domain configuration not intended public.
- `.env` variants other than `.env.example`.
- Fixtures copied from real customers, even after superficial renaming.

All fixtures must identify themselves as fictional where a reader could mistake them for a real business. Use generated names/domains and never production identifiers.

`.gitignore`, `.gitleaks.toml`, `tooling/repository-policy.json`, and `scan-secrets.mjs` enforce common path and credential safeguards. Detection does not make the repository safe by itself; reviewers must assess context and history.

## 7. Review ownership

Actual GitHub usernames/teams have not been supplied, so G02 does not invent a nonfunctional `CODEOWNERS` file. Until owner/team handles are approved, review responsibility is documented as follows:

| Area                                                  | Required reviewer role                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/auth`, `packages/tenant`, RLS/migrations    | Security-aware Platform Owner/Admin plus implementing developer      |
| `packages/ai`, protected-fact/content policy          | Platform Owner or delegated policy owner plus implementing developer |
| `.github`, `infrastructure`, deployment/backups/Caddy | Platform Owner/Admin plus operations reviewer                        |
| Site contract/schema migrations                       | Platform developer plus content/security reviewer                    |
| Customer-site source                                  | Platform developer; contract/security checks required                |
| Legal/privacy/consent copy                            | Owner-designated legal/policy reviewer                               |

G03 must add actual repository protection/CODEOWNERS only after valid GitHub identities are known. Missing handles must not be replaced with fake users.

## 8. Validation contract

`tooling/goal-verification.json` maps goal IDs to concrete commands. The verifier emits JSON records and rejects unknown goals, empty command lists, placeholder commands, and recursive verifier calls.

```powershell
npm run verify:goal -- G01
npm run verify:goal -- G02
npm run verify:all
```

Provider, Docker, staging, or production checks added by later goals must use named subcommands and fail as `blocked` when required external authorization is absent; they must never silently pass.

## 9. Placeholder policy

The workspace directories created by G02 contain only package metadata and a purpose README. They do not claim health endpoints, APIs, UIs, sites, queues, persistence, or provider behavior. The roadmap goal that first implements a workspace must replace its placeholder statement with real setup, tests, and operational behavior.
