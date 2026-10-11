#!/usr/bin/env bash
# G30 read-only capacity and existing-route observer.
# This script prints metadata only. It never reads env files, logs, databases, keys,
# request/response bodies, or Docker environment values, and performs no mutation.

set -u

duration_minutes="${OMNIREACH_OBSERVE_MINUTES:-30}"
interval_seconds="${OMNIREACH_OBSERVE_INTERVAL_SECONDS:-60}"
existing_public_url="${EXISTING_PUBLIC_URL:-}"

case "$duration_minutes" in
  ''|*[!0-9]*) echo 'OMNIREACH_OBSERVE_MINUTES must be an integer' >&2; exit 2 ;;
esac
case "$interval_seconds" in
  ''|*[!0-9]*) echo 'OMNIREACH_OBSERVE_INTERVAL_SECONDS must be an integer' >&2; exit 2 ;;
esac
if [ "$duration_minutes" -lt 1 ] || [ "$duration_minutes" -gt 240 ]; then
  echo 'OMNIREACH_OBSERVE_MINUTES must be between 1 and 240' >&2
  exit 2
fi
if [ "$interval_seconds" -lt 15 ] || [ "$interval_seconds" -gt 900 ]; then
  echo 'OMNIREACH_OBSERVE_INTERVAL_SECONDS must be between 15 and 900' >&2
  exit 2
fi
if [ -n "$existing_public_url" ]; then
  case "$existing_public_url" in
    https://* ) ;;
    * ) echo 'EXISTING_PUBLIC_URL must use https://' >&2; exit 2 ;;
  esac
fi

sample_count=$((duration_minutes * 60 / interval_seconds + 1))
if [ "$sample_count" -lt 2 ]; then sample_count=2; fi

printf 'collection=g30-read-only-observation\n'
printf 'started_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'hostname=%s\n' "$(hostname 2>/dev/null || printf unavailable)"
printf 'duration_minutes=%s interval_seconds=%s samples=%s\n' \
  "$duration_minutes" "$interval_seconds" "$sample_count"
if [ -n "$existing_public_url" ]; then
  # Print the host only, never a path or query string.
  printf 'existing_route_host=%s\n' \
    "$(printf '%s' "$existing_public_url" | sed -E 's#^https://([^/@]+@)?([^/:?#]+).*$#\2#')"
else
  printf 'existing_route_host=not_supplied\n'
fi

sample=1
while [ "$sample" -le "$sample_count" ]; do
  printf '\n[sample %s/%s] utc=%s\n' "$sample" "$sample_count" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' '-- uptime/load --'
  uptime 2>&1 || true
  if [ -r /proc/loadavg ]; then awk '{print "loadavg=" $1 " " $2 " " $3}' /proc/loadavg; fi

  printf '%s\n' '-- memory --'
  free -m 2>&1 || true

  printf '%s\n' '-- filesystem capacity --'
  df -P -h / /opt /opt/servers /opt/backups 2>&1 | awk '!seen[$0]++' || true
  df -P -i / /opt /opt/servers /opt/backups 2>&1 | awk '!seen[$0]++' || true

  printf '%s\n' '-- docker container resources/status --'
  docker stats --all --no-stream \
    --format 'name={{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}} pids={{.PIDs}} block_io={{.BlockIO}}' \
    2>&1 || true
  docker ps --format 'name={{.Names}} state={{.State}} status={{.Status}}' 2>&1 || true

  printf '%s\n' '-- existing public route metadata --'
  if [ -n "$existing_public_url" ] && command -v curl >/dev/null 2>&1; then
    curl --silent --show-error --output /dev/null --max-time 15 --connect-timeout 5 \
      --write-out 'http_code=%{http_code} remote_ip=%{remote_ip} connect_seconds=%{time_connect} tls_seconds=%{time_appconnect} total_seconds=%{time_total}\n' \
      "$existing_public_url" 2>&1 || printf 'route_check=failed\n'
  elif [ -n "$existing_public_url" ]; then
    printf 'route_check=curl_unavailable\n'
  else
    printf 'route_check=skipped_no_url\n'
  fi

  if [ "$sample" -lt "$sample_count" ]; then sleep "$interval_seconds"; fi
  sample=$((sample + 1))
done

printf '\nfinished_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
