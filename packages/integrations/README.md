# Integrations Package

Provider boundaries for Cloudflare, Google, and email integrations. Provider secrets are
supplied at runtime and never persisted by these adapters. Every mutation is planned
first, idempotent, and independently auditable. The in-memory providers are the default
for local development; live clients require an explicitly supplied credential source.
