#!/bin/sh
set -eu

caddy_root=/opt/servers/caddy
caddyfile=$caddy_root/Caddyfile
compose_file=$caddy_root/compose.yml
marker='# BEGIN OMNIREACH COOPS CUSTOMER ADMIN'
backup=$caddy_root/Caddyfile.pre-coops-admin-$(date -u +%Y%m%dT%H%M%SZ)
candidate=$(mktemp "$caddy_root/.Caddyfile.coops-admin.XXXXXX")
changed=false

fail() {
  printf 'configure-coops-admin-route: %s\n' "$1" >&2
  exit 1
}

cleanup() { rm -f -- "$candidate"; }
trap cleanup EXIT HUP INT TERM

[ "$(id -u)" -eq 0 ] || fail 'must run as root'
[ -f "$caddyfile" ] || fail 'shared Caddyfile is missing'
[ -f "$compose_file" ] || fail 'shared Caddy Compose file is missing'

cp --preserve=mode,ownership -- "$caddyfile" "$candidate"
if ! grep -Fq "$marker" "$candidate"; then
  if grep -Eq '(^|[[:space:],])admin\.coopsmobiledetailingaledo\.com([[:space:],{]|$)' "$candidate"; then
    fail 'the Coop customer-admin domain already has an unmanaged Caddy route'
  fi
  cp --preserve=mode,ownership,timestamps -- "$caddyfile" "$backup"
  changed=true
  cat >>"$candidate" <<'EOF'

# BEGIN OMNIREACH COOPS CUSTOMER ADMIN
admin.coopsmobiledetailingaledo.com {
    encode zstd gzip
    header {
        Cache-Control "no-store"
        Permissions-Policy "camera=(), geolocation=(), microphone=()"
        Referrer-Policy "no-referrer"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }
    reverse_proxy omnireach-api:4100
}
# END OMNIREACH COOPS CUSTOMER ADMIN
EOF
fi

docker compose --file "$compose_file" exec -T caddy \
  caddy validate --config /dev/stdin --adapter caddyfile <"$candidate" ||
  fail 'candidate Caddy configuration is invalid'

if ! cmp -s "$candidate" "$caddyfile"; then mv -- "$candidate" "$caddyfile"; fi
if ! docker compose --file "$compose_file" exec -T caddy \
  caddy reload --force --config /dev/stdin --adapter caddyfile <"$caddyfile"; then
  if [ -f "$backup" ]; then
    cp --preserve=mode,ownership -- "$backup" "$caddyfile"
    docker compose --file "$compose_file" exec -T caddy \
      caddy reload --force --config /dev/stdin --adapter caddyfile <"$caddyfile" || true
  fi
  fail 'Caddy reload failed; the prior configuration was restored when available'
fi

printf '%s\n' 'configure-coops-admin-route: route active'
