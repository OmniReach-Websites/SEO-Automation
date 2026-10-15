# Deployment

The reusable workflow builds and tests an exact commit, creates a deterministic archive
containing CI-built runtime/migrator images, the application/workers, site sources,
production Compose definition, and deployment controller, checksums it, verifies the SSH
host key, and transfers it to a restricted target account. It has no push trigger and
binds no environment. `deploy-production.yml` is the production-only entry point. Push
deployment from `main` remains default-off behind an explicit repository variable; its
bridge and rollback operations are protected manual dispatches.

`release.mjs` supplies target-side checksum verification, immutable staging, a serialized
activation lock, atomic pointer replacement, health failure restoration, and explicit
rollback. It never modifies a Git checkout. The local harness uses only a temporary
fictional target:

```powershell
npm run verify:deploy-harness
```

Target host/account, pinned host key, secret custody, maintenance-window, health, and
authorization values belong only in the protected GitHub environment or host-only
configuration. Their repository references are not evidence that those controls are
configured or that a production change is authorized.

`install-target.sh` is the one-time root bootstrap. It creates only the dedicated
OmniReach directories, generates internal secrets on the VPS, installs a narrowly scoped
sudo rule, and leaves providers and Caddy untouched. The deploy account can invoke only
`omnireach-release-root`; that command validates the fixed `deploy`, `bridge`, and
`rollback` forms and resolves all filesystem paths internally.

The target-side activation wrapper supplies the verified release SHA and host-only
configuration/secret paths to `production.compose.yml`, holds the release lock through
migration and readiness, loads only checksummed CI-built images, invokes Compose with
`--no-build`, and leaves shared Caddy untouched until its separately authorized step.
See [`../../docs/production-compose.md`](../../docs/production-compose.md).

`configure-caddy-route.sh` is the separately authorized, one-time integration step for
the inventoried shared Caddy instance. It refuses to run if the inventoried Caddyfile has
changed, creates a timestamped backup, adds only `admin.omnireach.cloud`, validates before
reload, checks Christians Reunite after reload, and restores the prior file on failure.
DNS changes remain a separate operation.

## Source-bound release contract

`release-contract.json` is the source-of-truth capability declaration for an exact
source commit. The metadata generator reads that checked-in manifest and the migration
tree from the same checkout, verifies that the supplied release ID is that checkout's
`HEAD`, and writes metadata into the checksummed release archive. Metadata from one
checkout must never be copied to or generated on behalf of another commit.

The current manifest declares Auth Contract 3, schema contract 2, and crypto read range
1 through 2 with write contract 2. The source retains the version-1 reader only as the
initial compatibility bridge while all new ciphertext uses the versioned keyring. The
generator detects the `VersionedSecretKeyring` implementation marker: adding
keyring-capable source without crypto contract 2 fails packaging, as does claiming
contract 2 before that source exists.
Branch CI runs the same source/manifest capability check even when deployment is disabled,
so a keyring implementation cannot merge without the atomic manifest bump.

### Contract meanings and bump policy

- `authContract` is the externally observable authentication/readiness contract. A
  rollback must declare the same active contract.
- `schema.minimum`, `schema.maximum`, and `schema.target` declare the schema versions the
  binary can run against and the version its migrations establish.
- `crypto.readMinimum` and `crypto.readMaximum` declare durable encrypted-record/keyring
  formats the binary can read. `crypto.write` declares the format it may write.

Any change that can write a breaking authentication, schema, or encrypted-data format
must bump the corresponding target/write value in the same commit as the writer. Expand
a read range only when tests prove both formats; never advertise aspirational support.
Once a write contract may exist in persistent state, later candidates and rollback
artifacts must continue to read it and must not lower the write contract. Retirement of
an older read format requires owner-controlled migration/rotation evidence before its
minimum can increase. A metadata-format change increments
`OMNIREACH_RELEASE_METADATA_VERSION` and intentionally makes older metadata fail closed.

The target validator rejects unknown, duplicate, missing, source-mismatched, or
out-of-range fields. Candidate, automatic rollback, bridge rollback, and manual rollback
paths all validate schema, authentication, and crypto/keyring compatibility before
activation. Consequently an Auth Contract v2 artifact cannot be selected after
RP-scoped WebAuthn state is possible, and an artifact that only supports crypto contract
1 cannot be selected after crypto contract 2 writes are possible. Reader compatibility
is checked in both directions; the target separately prohibits lowering the write
contract because no artifact activation can prove that older-format data is the only
durable state remaining.

## Reviewed bridge and rollback

The first compatibility transition uses `workflow_dispatch` with operation `bridge`, a
checked confirmation, and two distinct 40-character SHAs. The job runs only from `main`,
also requires the repository activation variable, binds the protected `production`
environment, proves both commits are ancestors of `origin/main`, and independently
checks out, gates, builds, packages, and generates source-bound metadata for each commit.
It then transfers both checksummed artifacts through the restricted SSH account and
invokes:

```text
omnireach-release bridge <candidate-sha> <reviewed-rollback-sha>
```

The rollback operation is a separate protected manual dispatch. Strict host-key
checking, the fixed incoming directory, target lock, immutable release directories, and
restricted wrapper apply to both operations. Neither workflow changes shared Caddy or
Christians Reunite resources.

After every successful deploy, bridge, or rollback, the restricted target controller
retains exactly the ten newest immutable release directories, always counting and
preserving the targets of both `current` and `previous`. Release pruning accepts only
direct child directories whose names are lowercase 40-character commit SHAs, rejects
symlinks or paths that do not resolve exactly as expected, and runs under the same
exclusive release lock. Operators can run `omnireach-release prune` to apply the same
policy without activating a release. This policy does not prune Docker images, named
volumes, shared content, database state, uploaded media, or backups.

The first Auth Contract v2-to-v3 bridge cannot use the currently deployed v2 artifact
as its automatic rollback after the v3 migration has replaced the v2 RLS policies. That
binary would fail closed against the v3 database. Before starting the bridge, prepare
and review two distinct v3-compatible artifacts: the candidate and a deliberately
conservative fallback that supports the same authentication, schema, and crypto
contracts. If candidate readiness fails after migration, the bridge activates that v3
fallback. If neither v3 artifact can start, the safe recovery choices are a compatible
forward fix or an owner-authorized restore of the pre-transition database backup
together with its matching v2 artifact. An automatic v2-binary rollback against a v3
database is intentionally unavailable.

These repository controls are preparation, not production evidence. G31 stays blocked
until the owner-controlled environment protection, credentials, backup/restore,
production-equivalent key rotation, live routing, health, isolation, and rollback checks
are separately authorized and recorded. In particular, the v2-to-v3 bridge must not run
until the distinct v3 fallback and the matching backup-restore path have been proven.
