# Queue Package

Versioned opaque BullMQ envelopes, admission validation, deterministic deduplication,
retry/error policy, site-scoped leases, and a durable-state abstraction. Redis receives
only record identifiers and routing metadata—never credentials, content, prompts, or
provider tokens. Workers rehydrate and reauthorize records from PostgreSQL before every
execution.
