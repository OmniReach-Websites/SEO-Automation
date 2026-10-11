# Deployment

The reusable workflow builds and tests an exact commit, creates a deterministic archive
containing CI-built runtime/migrator images, the application/workers, site sources,
production Compose definition, and deployment controller, checksums it, verifies the SSH
host key, and transfers it to a restricted target account. It has no push trigger and
binds no environment. `deploy-production.yml` is the production-only caller: verified
pushes to `main` bind the protected `production` GitHub environment, rebuild and retest
the exact commit, then transfer and activate that immutable SHA.

`release.mjs` supplies target-side checksum verification, immutable staging, a serialized
activation lock, atomic pointer replacement, health failure restoration, and explicit
rollback. It never modifies a Git checkout. The local harness uses only a temporary
fictional target:

```powershell
npm run verify:deploy-harness
```

The production owner supplied the target host/account, pinned host key, secret custody,
maintenance window, health objectives, and explicit activation authorization. Those
values remain in GitHub's protected environment or host-only configuration; no credential
belongs in Git.

`install-target.sh` is the one-time root bootstrap. It creates only the dedicated
OmniReach directories, generates the internal secrets on the VPS, installs a narrowly
scoped sudo rule, and leaves provider credentials and Caddy untouched. The deploy account
can invoke only `omnireach-release-root`; that command accepts only
`deploy <40-character-sha>` and resolves all filesystem paths internally.

The target-side activation wrapper supplies the verified release SHA and host-only
configuration/secret paths to `production.compose.yml`, holds the release lock through
migration and readiness, loads only the checksummed CI-built images, invokes Compose with
`--no-build`, and leaves shared Caddy untouched until its distinct approved step. See
[`../../docs/production-compose.md`](../../docs/production-compose.md).
