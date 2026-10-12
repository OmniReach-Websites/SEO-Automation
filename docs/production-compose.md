# Production Compose and Datastore Runbook

**Status:** Production Compose/release foundation implemented; authentication activation
is not ready and still requires the documented compatibility, key-rotation, security,
and authorized-change gates
**Authority:** The owner authorized production completion on 2026-10-11. Provider spending
and destructive backup operations remain separately controlled by their documented gates.

## Security and ownership model

The production stack is defined by
[`../infrastructure/compose/production.compose.yml`](../infrastructure/compose/production.compose.yml).
It is a different Compose project from local development and has no external network,
volume, container, or port dependency on Christians Reunite.

| Credential                        | Purpose                                          | Runtime availability                    |
| --------------------------------- | ------------------------------------------------ | --------------------------------------- |
| `postgres_admin_password`         | PostgreSQL initialization and migrations         | PostgreSQL and one-shot migrator only   |
| `postgres_app_password`           | Restricted `omnireach_runtime` PostgreSQL login  | Migrator and OmniReach application only |
| `redis_app_password`              | `omnireach_runtime` Redis ACL login              | Redis and OmniReach application only    |
| Four internal application secrets | Sessions, MFA encryption, previews, contact data | OmniReach application only              |

The PostgreSQL administrator is never used by API or worker processes. The runtime login
is `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION`, and
`NOBYPASSRLS`. Migrations create the NOLOGIN authorization roles; the one-shot migrator
then grants those roles to the restricted login so existing transaction-scoped `SET
LOCAL ROLE` calls continue to enforce RLS.

Redis starts from an ephemeral ACL file. The `default` user is off. The named runtime
user can perform application and BullMQ operations but cannot run ACL, configuration,
module, shutdown, replication, flush, or manual persistence commands.

## Required host layout

The approved future layout is:

```text
/opt/servers/omnireach/
  shared/
    config/production.env
    secrets/
  releases/<verified-commit>/
  current -> releases/<verified-commit>
```

The `shared` tree is host-owned state and must never be placed in a release archive or
Git. The secret directory is mode `0700`; generated files are read-only and protected by
the non-traversable directory. The Docker daemon mounts only the specifically declared
files.

## First deployment procedure

The target bootstrap is intentionally a one-time root action. Subsequent deployments use
the restricted `omnireach-deploy` account and never grant it Docker-socket access or
general sudo.

1. Re-run the read-only inventory and verify available CPU, RAM, disk, ports, Docker
   version, Christians Reunite health, and shared Caddy state.
2. Verify the exact release SHA and archive checksum. Extract only into the new immutable
   release directory; never update an active checkout. Verify that both the candidate and
   rollback release manifests explicitly declare Auth Contract v2 compatibility before
   applying the v2 schema or writing v2 authentication state. Missing or older metadata
   fails closed after that cutoff.
3. Create `/opt/servers/omnireach/shared/config/production.env` from
   `infrastructure/compose/production.env.example`. Keep providers disabled and do not
   place passwords or tokens in that file. Populate `TRUSTED_PROXY_CIDRS` only after a
   read-only network inspection identifies the exact Caddy peer address/CIDR. If
   Cloudflare remains proxied, also verify that Caddy accepts forwarding data only from
   current Cloudflare source ranges and include those verified intermediate ranges so
   the API can walk the chain from right to left. Do not use `private_ranges` or a whole
   Docker subnet merely for convenience.
   Production configuration validation fails closed while this value is empty or
   malformed; the blank repository example is intentional and is not deployable as-is.
4. Generate internal credentials directly on the host without displaying them:

   ```bash
   sudo sh /opt/servers/omnireach/current/infrastructure/compose/scripts/bootstrap-secrets.sh \
     --secrets-dir /opt/servers/omnireach/shared/secrets
   ```

   The script refuses relative/root/symlink targets, generates independent 32-byte hex
   values atomically, validates existing files, and never replaces a valid existing
   credential. Running it twice is safe and does not rotate anything.

5. Export only non-secret path/release controls in the authorized deployment shell:

   ```bash
   export OMNIREACH_RELEASE_SHA='<verified 40-character commit SHA>'
   export OMNIREACH_ENV_FILE=/opt/servers/omnireach/shared/config/production.env
   export OMNIREACH_SECRETS_DIR=/opt/servers/omnireach/shared/secrets
   export OMNIREACH_RESOURCE_PREFIX=omnireach-production
   ```

6. Render and inspect structural configuration without printing environment or secret
   file contents:

   ```bash
   docker compose -f infrastructure/compose/production.compose.yml --profile application config --quiet
   ```

7. Verify `omnireach-images.tar.gz.sha256`, load the runtime and migrator images built by
   GitHub Actions, and invoke Compose with `--no-build`. The VPS must never substitute a
   locally rebuilt image for the verified artifact. Start PostgreSQL and Redis, wait for
   health, run the one-shot migration/role job, initialize platform-volume permissions,
   and only then start the API. The exact deployment wrapper must hold the existing
   release lock and invoke Compose with the `application` profile.
8. Verify PostgreSQL/Redis have no host port, the API is loopback-only, readiness returns
   `200`, migrations completed, the restricted role is not privileged, Redis rejects
   unauthenticated/admin commands, persistent volumes are attached, and no secret appears
   in logs or container configuration. From an external test client, prove two distinct
   client networks produce distinct authentication limiter buckets, and prove a direct
   or untrusted peer cannot select its bucket with a forged `X-Forwarded-For` header.
   Also prove the canonical ORAP hostname cannot resolve as a customer host and that
   concurrent credential, membership, domain, policy, or factor changes prevent stale
   session issuance.
9. Continue to Caddy or DNS integration only under their separate explicit approvals.

The first keyring-capable release creates `mfa_encryption_keyring` from the existing
version-1 `mfa_encryption_key` without changing the key. This is a compatibility bridge,
not a rotation. Do not activate a new key until re-encryption, retirement, recovery, and
rollback have passed an isolated production-equivalent drill and the owner has approved
the maintenance change.

The runtime entrypoint reads mounted files and constructs these values inside the API or
worker process:

```text
DATABASE_URL=postgresql://omnireach_runtime:<secret>@postgres:5432/omnireach
REDIS_URL=redis://omnireach_runtime:<secret>@redis:6379/0
```

Passwords are hexadecimal, so URL encoding is deterministic. The resolved URLs must
never be printed, copied to chat, committed, placed in an image, or passed as Docker
command arguments.

## Credential rotation

All rotation occurs under the deployment lock and an approved maintenance/change record.
Never edit an active secret file in place.

### PostgreSQL application credential

1. Generate a new candidate file in the protected directory with `umask 077`; do not
   display it.
2. Preserve the current file as a root-only rollback candidate.
3. Atomically replace `postgres_app_password` with the validated candidate.
4. Run the one-shot migrator. It connects with the separate administrator secret and
   applies the new password to `omnireach_runtime` after migration compatibility checks.
5. Recreate the API and any worker containers so they read the new file, then verify
   readiness and that the prior password is rejected.
6. If validation fails, restore the prior file atomically, rerun the migrator, and
   recreate the affected runtime containers. Record the outcome without credential data.

### PostgreSQL administrative credential

1. Generate a protected candidate file and retain the old file temporarily.
2. While authenticated with the old mounted secret, run an audited `ALTER ROLE
omnireach_db_admin PASSWORD ...` operation that reads the candidate from a file; never
   place the value on a command line.
3. Atomically replace `postgres_admin_password` and run the migrator as a connectivity
   test. Roll back both database password and file from the retained protected copy if it
   fails.

Changing `POSTGRES_PASSWORD_FILE` alone does not rotate an initialized database. The
official image consumes bootstrap values only for an empty data directory.

### Redis application credential

1. Generate a protected candidate without replacing the current file.
2. Add the candidate temporarily to the existing named ACL user over an authenticated,
   private connection.
3. Atomically replace `redis_app_password`, recreate API/workers, and verify connectivity.
4. Restart only the OmniReach Redis service during the approved window. Its entrypoint
   regenerates the ACL with only the current password, removing the prior credential.
5. Verify unauthenticated, prior-password, and prohibited administrative commands fail.

### MFA encryption key

`mfa_encryption_keyring` is a compact host-only JSON document with `activeVersion` and a
`keys` object. `mfa_encryption_key` remains the bridge key for the first compatible
release and must not be changed during that deployment. Neither value may appear in an
environment file, command argument, log, chat, or Git.

Run a rotation only under the deployment lock after a restorable backup and compatible
rollback artifact are verified:

1. Create a root-only candidate keyring containing the current and new random keys, set
   the new version active, validate it offline, and atomically replace the mounted
   keyring file. Never edit the active file in place.
2. Recreate the authentication-capable OmniReach processes. New TOTP and recovery-outbox
   records now use the active version; existing versions remain readable.
3. From the verified release image, run
   `npm run auth:rotate-mfa-key -- --apply --change-id CHANGE_ID`. The command works in
   bounded transactions, prints counts and version state only, writes non-secret batch
   audit evidence, and fails closed if an old key is absent or ciphertext cannot
   authenticate. Factor rewrites advance account authentication state, so plan for
   affected users to sign in again. Continue until `remaining` is zero.
4. Finish or expire queued recovery delivery, then wait at least 10 minutes after the old
   key stopped being active. This drains ephemeral owner-bootstrap state. Run
   `npm run auth:rotate-mfa-key -- --check-retirement OLD_VERSION`; exit status 2 means
   durable references remain and retirement must not proceed.
5. After the check permits retirement and the post-rotation login/recovery drill passes,
   run
   `npm run auth:rotate-mfa-key -- --retire OLD_VERSION --change-id CHANGE_ID`. This
   atomically rechecks durable references under the database write lock, records the
   immutable retirement and non-secret audit event, and enables database guards that
   reject every later factor or recovery-outbox write under the retired version,
   including writes from a stale process.
6. Only after step 5 succeeds, prepare protected candidate files that remove the retired
   entry from the keyring and make the required legacy bridge file contain the active
   key. Atomically replace each file under the deployment lock, recreate every
   authentication-capable process, and repeat the retirement, login, and recovery
   checks. Retain retired material only in approved encrypted recovery custody until the
   owner-approved destruction point; never leave it in an active host keyring.
7. If a check fails before durable retirement, keep both old and new keys readable. A
   controlled abort may atomically make the old version active for new writes, but it
   must not restore an old-only keyring once any new-version write or rotation batch has
   occurred. Roll back only to a keyring-capable compatible artifact. After durable
   retirement, never reactivate the version or roll back to an artifact whose release
   metadata cannot read the active key/schema contract; use a compatible forward fix or
   tested restore.

The single-key `mfa_encryption_key` file is an initial-rollout and runtime compatibility
bridge, not a rollback mechanism. Once a new-version write exists, a pre-keyring binary
cannot safely read the mixed ciphertext set. After durable retirement, the database
guard also rejects the retired-version writes such a stale binary can attempt. Therefore
pre-keyring binaries are permanently incompatible with that database state even though
the bridge file must continue to contain the active key for the current Compose runtime.

Repository unit and disposable-PostgreSQL coverage proves old/new encryption, bounded
rewriting, grants/RLS, authentication-state invalidation, immutable retirement,
non-secret audit evidence, and serialization against concurrent or stale writes. A real
production-equivalent rotation and recovery drill is still required before G31
activation.

## Backups

The persistent sources are:

- `omnireach-production-postgres-v1` for authoritative relational state;
- `omnireach-production-redis-v1` for AOF-backed transient queue/cache continuity; and
- `omnireach-production-platform-data-v1` for uploads, previews, and publications.

Use a consistent logical PostgreSQL dump authenticated through the administrative secret;
do not copy the live PostgreSQL volume directory. Quiesce or snapshot mutable file data
according to the backup manifest. Redis is non-authoritative for durable job state, but
its AOF and recovery behavior must still be validated. Include the non-secret production
configuration and release/schema identifiers. Never include build caches or credentials
in the data archive.

Encrypt before off-server transfer, record checksums and required members, retain 7 daily
and 4 weekly recovery points, and keep encryption-key custody separate from R2 storage
credentials. R-005 remains incomplete until automated off-server transfer and a real
isolated restore have passed. Manual deletion still requires owner authorization.

## Recovery and persistence validation

1. Declare the incident and obtain owner authorization. Preserve the failed state and
   take a fresh backup where safe.
2. Restore into a new, uniquely prefixed isolated Compose project and new volumes. Never
   overwrite the current production volumes as the first recovery attempt.
3. Restore PostgreSQL logically, platform content/media from the encrypted manifest, and
   Redis only when its recovery point is compatible. Otherwise rebuild queued work from
   authoritative PostgreSQL job records.
4. Run forward-compatible migrations, role provisioning, and application readiness.
5. Verify schema/reference counts, RLS isolation, one published site, media hashes,
   authentication, Redis ACL denial, and release/schema/Auth Contract v2 compatibility.
6. Activate the restored release/volumes only after owner approval and a rollback point.
7. Record RPO/RTO, checksums, release identity, validation evidence, and any data loss.

`npm run verify:production-compose` performs the corresponding local destructive/restart
exercise only against its unique ephemeral test project. It is intentionally not a
production restoration test.

After the Auth Contract v2 cutoff, a recovered database may be activated only with a
v2-compatible artifact. A backup containing v2 schema/state does not make a pre-v2
binary safe. If the prior pointer is incompatible, use a v2-compatible forward fix or
restore pair and keep authentication closed until validation passes.
