# Worker operations

| Service    | Purpose/queue                       | Default bounds                     | Health                       |
| ---------- | ----------------------------------- | ---------------------------------- | ---------------------------- |
| scheduler  | DB schedules → category queues      | 15s tick, 25 claims, one DB lease  | DB heartbeat + `/tmp` marker |
| runner     | stalled lease recovery              | 30s pulse                          | same                         |
| publisher  | `publish`; immutable activation     | concurrency 1, bounded job timeout | same                         |
| crawler    | `crawl`; same-site evidence         | 100 pages, 2MB/page, 15s fetch     | same                         |
| seo        | `seo_audit`; deterministic findings | concurrency 1                      | same                         |
| monitoring | `health_check`; alert on failure    | 10s request                        | same                         |

Queues are category-specific. Envelopes contain IDs, expiry, timeout, attempts, trace,
and dedupe key. Workers rehydrate exact scoped rows, verify identity/site state, lease and
heartbeat runs, and persist retry/cancel/dead-letter outcomes. The runner recovers expired
leases. Services inherit non-root/secret/network/log/resource/restart/shutdown controls;
only publisher writes platform data and static serving mounts it read-only.

Check status with Compose `ps` and recent logs, then run `npm run coop:diagnose`. Pause
automation with the audited site emergency control; this must not remove the active
static site. Investigate failed/stuck jobs in ORAP/DB before authorized replay—never edit
Redis or job rows manually. For publisher failure, preserve the pointer, fix the input,
and replay; restore the prior revision/artifact if needed.

AIO/OpenAI remains disabled. Backup/metrics jobs are cancelled because no approved
production handler is configured. External alert email remains `Waiting`; ORAP/database
alerts are authoritative until delivery is proven.
