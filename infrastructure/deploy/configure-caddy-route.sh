#!/bin/sh
set -eu

caddy_root=/opt/servers/caddy
caddyfile=$caddy_root/Caddyfile
compose_file=$caddy_root/compose.yml
expected_sha=abe4467beed349aac4ab8396eb950dd1449e784fc383760a24602f767b098802
backup=$caddy_root/Caddyfile.pre-omnireach-$(date -u +%Y%m%dT%H%M%SZ)
candidate=$(mktemp "$caddy_root/.Caddyfile.omnireach.XXXXXX")

fail() {
  printf 'configure-caddy-route: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  rm -f -- "$candidate"
}
trap cleanup EXIT HUP INT TERM

[ "$(id -u)" -eq 0 ] || fail 'must run as root'
[ -f "$caddyfile" ] || fail 'shared Caddyfile is missing'
[ -f "$compose_file" ] || fail 'shared Caddy Compose file is missing'
[ "$(sha256sum "$caddyfile" | awk '{ print $1 }')" = "$expected_sha" ] ||
  fail 'shared Caddyfile changed after inventory; refusing to edit it'

cp --preserve=mode,ownership,timestamps -- "$caddyfile" "$backup"
cp --preserve=mode,ownership -- "$caddyfile" "$candidate"
cat >>"$candidate" <<'EOF'

admin.omnireach.cloud {
    encode gzip
    header X-Robots-Tag "noindex, nofollow, noarchive"
    reverse_proxy host.docker.internal:44100
}
EOF

mv -- "$candidate" "$caddyfile"
if ! docker compose --file "$compose_file" exec -T caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  cp --preserve=mode,ownership -- "$backup" "$caddyfile"
  fail 'candidate configuration was invalid; the prior file was restored'
fi

if ! docker compose --file "$compose_file" exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
  cp --preserve=mode,ownership -- "$backup" "$caddyfile"
  docker compose --file "$compose_file" exec -T caddy \
    caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
  fail 'reload failed; the prior file was restored and reload was retried'
fi

status=$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --max-time 15 https://christiansreunite.com) || status=000
if [ "$status" != 200 ]; then
  cp --preserve=mode,ownership -- "$backup" "$caddyfile"
  docker compose --file "$compose_file" exec -T caddy \
    caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
  fail 'existing Christians Reunite route failed after reload; prior configuration restored'
fi

printf 'configure-caddy-route: route installed; backup=%s; christians_status=%s\n' \
  "$backup" "$status"
