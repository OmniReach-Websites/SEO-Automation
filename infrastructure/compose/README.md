# Compose environments

Development and production are deliberately separate.

## Local development

`dev.compose.yml` creates only the `omnireach-seo-automation-dev` project. PostgreSQL
and Redis bind to loopback ports `54320` and `56379`; the values are fictional and the
stack must never receive production data or credentials.

```powershell
docker compose -f infrastructure/compose/dev.compose.yml config
docker compose -f infrastructure/compose/dev.compose.yml up -d --wait
$env:DATABASE_URL='postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev'
npm run db:migrate
npm run db:seed
```

Stop without deleting data:

```powershell
docker compose -f infrastructure/compose/dev.compose.yml down
```

Local reset is destructive. First confirm the project and exact volume names. Never use
broad Docker prune commands.

## Production template

`production.compose.yml` is an inert production template. It does not modify Caddy,
Cloudflare, Christians Reunite, or external providers. It uses:

- digest-pinned PostgreSQL 16 and Redis images;
- separate named PostgreSQL, Redis, and platform-data volumes;
- an internal backend network with no PostgreSQL or Redis host ports;
- a loopback-only API port pending separately approved Caddy integration;
- a PostgreSQL administrative login used only by the migration job;
- a restricted `omnireach_runtime` PostgreSQL login that can assume only the existing
  RLS application/auth/platform/worker group roles;
- a named Redis ACL user, with the unauthenticated default user disabled;
- mounted secret files and in-container URL construction, keeping password values out of
  Compose YAML, image metadata, and command arguments;
- health checks, restart policies, log rotation, stop grace periods, and CPU/RAM/PID
  limits sized for the approved initial VPS envelope.

`x-omnireach-runtime` is the common API/worker contract. Future long-running worker
entrypoints must inherit its networks, secrets, environment, hardening, and immutable
release image rather than defining independent credentials.

Run the static contract check on any machine:

```powershell
npm run check:production-compose
```

Run the Docker integration harness locally. It uses unique test-only resources, creates
ephemeral credentials, verifies authentication/isolation/persistence/readiness, and
removes its containers, networks, volumes, and temporary secret directory:

```powershell
npm run verify:production-compose
```

Production procedures and approval gates are in
[`../../docs/production-compose.md`](../../docs/production-compose.md).
