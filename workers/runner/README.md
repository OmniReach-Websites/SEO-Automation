# Worker Runner

Shared execution guard for typed jobs. Each handler rehydrates its authoritative
PostgreSQL job and target records from the complete opaque envelope, compares
tenant/site scope, rejects cancelled or terminal jobs, rechecks current site and feature
status, and acquires the per-site job lease before producing an external side effect.
