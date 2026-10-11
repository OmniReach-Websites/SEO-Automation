# Scheduler Worker

Tenant-aware daily scheduling with timezone/DST handling, deterministic jitter, a
PostgreSQL single-active lease, intended-window admission, and durable BullMQ dispatch
claims. Failed dispatches become eligible for retry; successful opaque-envelope
dispatches are recorded. Admission and execution recheck site, feature, budget, and
current policy state.
