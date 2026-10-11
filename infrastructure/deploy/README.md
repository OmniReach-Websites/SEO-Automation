# Deployment

The reusable workflow builds and tests an exact commit, creates a deterministic archive
containing CI-built runtime/migrator images, the application/workers, site sources,
production Compose definition, and deployment controller, checksums it, verifies the SSH
host key, and transfers it to a restricted target account. It has no push trigger and
binds no environment; production activation belongs to G31.

`release.mjs` supplies target-side checksum verification, immutable staging, a serialized
activation lock, atomic pointer replacement, health failure restoration, and explicit
rollback. It never modifies a Git checkout. The local harness uses only a temporary
fictional target:

```powershell
npm run verify:deploy-harness
```

Before G31, an owner must provide the target host/account, pinned host key, secret
custody, protected `main` environment approvers, maintenance window, health objectives,
and explicit production authorization. No value belongs in Git.

The target-side activation wrapper must supply the verified release SHA and host-only
configuration/secret paths to `production.compose.yml`, hold the release lock through
migration and readiness, load only the checksummed CI-built images, invoke Compose with
`--no-build`, and leave shared Caddy untouched until its distinct approved step. See
[`../../docs/production-compose.md`](../../docs/production-compose.md).
