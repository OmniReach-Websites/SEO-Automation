# Caddy Integration

The checked-in files are synthetic, isolated validation fixtures. They never replace or
reload a host Caddy configuration. Generated OmniReach fragments use exact verified
hosts, immutable release roots, and a loopback-only admin upstream. Wildcards,
unverified domains, mutable roots, duplicate hosts, and ambiguous upstreams are rejected.

Validate locally with:

```powershell
docker run --rm -v "${PWD}/infrastructure/caddy/fixtures:/etc/caddy:ro" caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile
```

Production integration remains gated on an authorized, sanitized read-only inventory.
The eventual change must be an additive import, preserve every existing route, run
`caddy validate`, stage atomically, require a human checkpoint before reload, perform
pre/post health checks, and retain the prior file for immediate restoration. Christians
Reunite must not be edited, restarted, renamed, or moved by OmniReach automation.
