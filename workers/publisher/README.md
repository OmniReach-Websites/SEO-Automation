# Publisher Worker

**Status:** Local G13/G16 publication pipeline implemented.

Creates deterministic code/content/asset snapshots and manifests, runs allowlisted workspace builds in a secret-minimized bounded child process, stages immutable artifacts atomically, signs expiring preview claims, serves active static files independently, and serializes publication with idempotency, revalidation, health checks, activation, and rollback.

Validate with `npm run verify:goal -- G13` and `G16`. A failed build or post-activation persistence step retains/restores the previous pointer; artifact versions are never edited in place.
