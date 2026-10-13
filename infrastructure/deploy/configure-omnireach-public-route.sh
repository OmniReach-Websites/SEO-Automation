#!/bin/sh
set -eu

caddy_root=/opt/servers/caddy
caddyfile=$caddy_root/Caddyfile
compose_file=$caddy_root/compose.yml
marker='# BEGIN OMNIREACH PUBLIC SITE'
end_marker='# END OMNIREACH PUBLIC SITE'
backup=$caddy_root/Caddyfile.pre-omnireach-public-$(date -u +%Y%m%dT%H%M%SZ)
candidate=$(mktemp "$caddy_root/.Caddyfile.omnireach-public.XXXXXX")
managed_block=$(mktemp "$caddy_root/.Caddyfile.omnireach-public-block.XXXXXX")
rewritten=$(mktemp "$caddy_root/.Caddyfile.omnireach-public-rewritten.XXXXXX")
changed=false

fail() {
  printf 'configure-omnireach-public-route: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  rm -f -- "$candidate" "$managed_block" "$rewritten"
}
trap cleanup EXIT HUP INT TERM

[ "$(id -u)" -eq 0 ] || fail 'must run as root'
[ -f "$caddyfile" ] || fail 'shared Caddyfile is missing'
[ -f "$compose_file" ] || fail 'shared Caddy Compose file is missing'

cp --preserve=mode,ownership -- "$caddyfile" "$candidate"
cat >"$managed_block" <<'EOF'
# BEGIN OMNIREACH PUBLIC SITE
www.omnireach.cloud {
    redir https://omnireach.cloud{uri} permanent
}

omnireach.cloud {
    encode zstd gzip
    header {
        Content-Security-Policy "default-src 'self'; script-src 'self' 'sha256-1f6APo4rT+WRM24XLR07SyqI6L+qzt9T5/P7a6H1lIU=' https://challenges.cloudflare.com https://www.googletagmanager.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.googletagmanager.com; img-src 'self' data: https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com; style-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        Permissions-Policy "camera=(), geolocation=(), microphone=()"
        Referrer-Policy "strict-origin-when-cross-origin"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }
    handle /v1/public/platform-inquiry* {
        reverse_proxy omnireach-api:4100
    }
    handle {
        reverse_proxy omnireach-public-site:8080
    }
}
# END OMNIREACH PUBLIC SITE
EOF

start_count=$(grep -Fxc "$marker" "$candidate" || true)
end_count=$(grep -Fxc "$end_marker" "$candidate" || true)
if [ "$start_count" -eq 0 ] && [ "$end_count" -eq 0 ]; then
  if grep -Eq '^[[:space:]]*(www\.)?omnireach\.cloud([[:space:],{]|$)' "$candidate"; then
    fail 'the OmniReach public domain already has an unmanaged Caddy route'
  fi
  printf '\n' >>"$candidate"
  cat "$managed_block" >>"$candidate"
elif [ "$start_count" -eq 1 ] && [ "$end_count" -eq 1 ]; then
  awk -v start="$marker" -v finish="$end_marker" -v block="$managed_block" '
    $0 == start {
      while ((getline line < block) > 0) print line
      close(block)
      inside = 1
      next
    }
    inside && $0 == finish { inside = 0; next }
    !inside { print }
    END { if (inside) exit 42 }
  ' "$candidate" >"$rewritten" || fail 'the managed OmniReach Caddy block is malformed'
  mv -- "$rewritten" "$candidate"
else
  fail 'the managed OmniReach Caddy markers are missing or duplicated'
fi

docker compose --file "$compose_file" exec -T caddy \
  caddy validate --config /dev/stdin --adapter caddyfile <"$candidate" ||
  fail 'candidate Caddy configuration is invalid'

if ! cmp -s "$candidate" "$caddyfile"; then
  cp --preserve=mode,ownership,timestamps -- "$caddyfile" "$backup"
  changed=true
  mv -- "$candidate" "$caddyfile"
fi

if ! docker compose --file "$compose_file" exec -T caddy \
  caddy reload --force --config /dev/stdin --adapter caddyfile <"$caddyfile"; then
  if [ -f "$backup" ]; then
    cp --preserve=mode,ownership -- "$backup" "$caddyfile"
    docker compose --file "$compose_file" exec -T caddy \
      caddy reload --force --config /dev/stdin --adapter caddyfile <"$caddyfile" || true
  fi
  fail 'Caddy reload failed; the prior configuration was restored when available'
fi

status=$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --max-time 15 https://christiansreunite.com) || status=000
if [ "$status" != 200 ]; then
  if [ "$changed" = true ]; then
    cp --preserve=mode,ownership -- "$backup" "$caddyfile"
    docker compose --file "$compose_file" exec -T caddy \
      caddy reload --force --config /dev/stdin --adapter caddyfile <"$caddyfile" || true
  fi
  fail 'the existing Christians Reunite route failed after reload; prior configuration restored'
fi

printf 'configure-omnireach-public-route: route active; christians_status=%s\n' "$status"
