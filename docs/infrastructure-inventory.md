# Sanitized Production Infrastructure Inventory

**Host:** `srv1789012`  
**Evidence collected:** 2026-10-11 02:27:58 UTC  
**Mode:** Owner-authorized read-only R-003 inventory  
**Mutation authorization:** None

This record contains only reviewed, nonsecret facts from the returned inventory. It does
not contain environment values, logs, database contents, credentials, private keys, or
customer data.

## Capacity snapshot

- Ubuntu 24.04.4 LTS, Linux 6.8, Docker 29.6.1, Compose 5.2.0, cgroup v2.
- 2 vCPU and 7.8 GiB RAM; 7.0 GiB was available, swap usage was zero, and load was low.
- Root filesystem was 12% used with 86 GiB available; inode use was 2%.
- This point-in-time snapshot supports an isolated, resource-capped ten-site pilot plan,
  but does not replace sustained load monitoring or prove the 99.5% objective.

### Bounded existing-service observation

The owner returned nine read-only samples collected from 13:20:00 through 13:28:17 UTC
on 2026-10-11. During that interval:

- All four existing containers remained running and the Christians Reunite PostgreSQL
  container remained healthy.
- One-minute load ranged from 0.00 to 0.10; reported used memory ranged from 721 to
  736 MiB, with roughly 7.2 GiB available and no swap use.
- The root filesystem stayed at 12% used with 86 GiB available and 2% inode use.
- Every sampled request to the existing public route returned HTTP 200, with total
  request time between approximately 0.052 and 0.122 seconds.
- `/opt/backups` did not exist, which is consistent with the backup system not yet being
  installed and must be resolved only during the authorized G31 backup setup.

This is useful pre-deployment evidence for the existing service, but it is not a
representative OmniReach capacity test: no OmniReach runtime was active, the sample was
shorter than the planned 30 minutes, and it contained no OmniReach build, audit, worker,
or ten-site workload. The isolated ten-site suite supplies G30's pre-production evidence;
representative live-host capacity and non-regression are deferred to G31 after OmniReach
is staged and before its public route is activated.

## Existing services and isolation

- Compose projects: `caddy` (one container) and `christiansreunite` (three containers).
- Public listeners observed: SSH 22/TCP and Caddy 80/443 TCP plus 443/UDP.
- Christians Reunite website binds to loopback `127.0.0.1:8088`; its PostgreSQL service
  has no host-published port and uses an internal backend Docker network.
- Caddy owns the public ports, uses the external `christiansreunite_frontend` network,
  and routes `christiansreunite.com` to `website:80`.
- Caddy's admin port 2019 is container-only, not host-published in the observed output.
- Persistent volumes are separately named for Caddy data/config and Christians Reunite
  PostgreSQL data. No OmniReach runtime containers or volumes existed.

## Deployment and configuration shape

- `/opt/servers/caddy`, `/opt/servers/christiansreunite`, and
  `/opt/servers/omnireach` are root-owned mode `0755` directories.
- Caddy currently bind-mounts one root-owned `Caddyfile`; it has no fragment import yet.
- Christians Reunite bind-mounts its web root, Nginx configuration, and initialization
  schema read-only; runtime database data lives in its dedicated volume.
- `/opt/servers/omnireach` contains Git metadata but no active Compose project. G31 must
  use immutable release artifacts and a restricted deploy identity rather than treating
  that checkout as the production source of truth.

## Risks and G31 constraints

1. Host UFW reported inactive. Only 22/80/443 were publicly listening in this snapshot,
   but any provider-level firewall remains unverified and needs owner review.
2. Existing images use mutable tags (`caddy:2`, `nginx:alpine`, `postgres:16-alpine`, and
   a locally built API image). Christians Reunite remains untouched; OmniReach images
   and workflows must remain digest-pinned.
3. All four existing containers have no explicit memory, CPU, or PID limits; writable
   root filesystems; no additional security options; and `unless-stopped` restart
   policies. None is privileged. Existing application/configuration bind mounts are
   read-only, while the Caddy and PostgreSQL data volumes are writable as expected.
   OmniReach must have explicit resource limits, least-privilege runtime hardening, and
   staggered resource-heavy work without changing the existing containers.
4. Only the Christians Reunite database exposes a Docker health check. Pre/post checks
   for the website, API, and Caddy need explicit HTTP and configuration validation.
5. No application backup timer was evident. This does not prove no other backup exists,
   but G31 remains blocked on R-005 and verified backup/off-server recovery evidence.
6. Effective SSH policy permits root login, public-key authentication, and password
   authentication. It also uses `MaxAuthTries 6`, no server-initiated keepalive interval,
   and `ClientAliveCountMax 3`. Direct root/password access is a high-risk production
   posture. Remediation belongs to a separately authorized hardening change after a
   non-root sudo identity and key-based access are proven in a concurrent session.
7. Caddy has no import boundary. Future activation needs a reviewed additive fragment,
   mount/import design, complete validation, prior-file preservation, and separate
   mutation authorization.
8. The sanitized inventory records the shared proxy network name but not the exact
   Caddy peer address/CIDR or a verified Cloudflare-to-Caddy forwarding policy. Before
   production authentication activation, a read-only refresh must collect those
   nonsecret network facts so `TRUSTED_PROXY_CIDRS` can be narrow. Caddy and the API
   must then be tested together to show distinct clients do not collapse into one rate
   bucket and forged forwarding headers are ignored. This is not authorization to edit
   Caddy or restart either service.

## Follow-up inputs and release evidence

- Provider-level firewall policy, if one exists.
- Backup destination, recovery evidence, and key custody under R-005.
- Owner confirmation of the intended production origin: a read-only 2026-10-11
  Cloudflare check found that the proxied apex A record targets a different address from
  the host used for the authorized `srv1789012` inventory. Neither address is repeated in
  this public document, and no DNS record was changed.
- Sustained resource baseline under representative OmniReach and existing-service load;
  the bounded 2026-10-11 observation is retained as pre-deployment evidence only.

The authorized R-003 inventory is complete for planning. R-001 is also complete and the
isolated G18 routing plan passes, but no route was activated. Provider firewall and backup
custody are separate owner/provider inputs, while live capacity and non-regression
measurements belong to G31 staging and activation. No production Caddy, SSH, container,
firewall, or service change is authorized by this inventory.
