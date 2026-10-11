# API

**Status:** Implemented local G04–G16 control-plane slices; production activation is not authorized.

Fastify exposes liveness/readiness, authentication, staff-only ORAP administration, host-scoped customer content/media/publication, and bounded public contact routes. Route modules accept injected services and authenticated resolvers; callers never select a tenant/site directly on customer endpoints.

Validate with `npm run typecheck`, `npm run test:integration`, and the relevant `npm run verify:goal -- GNN`. Disable an injected route service to roll back a slice without affecting static public artifacts. Never place production credentials in this workspace or enable production listeners during G01–G16.
