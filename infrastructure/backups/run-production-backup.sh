#!/bin/sh
set -eu

backup_root=/var/backups/omnireach
runtime_root=/run/backup-runtime
audit_log=$backup_root/audit/retention.jsonl
cli=/opt/omnireach/infrastructure/backups/backup-cli.mjs

fail() {
  printf 'run-production-backup: %s\n' "$1" >&2
  exit "${2:-1}"
}

read_secret() {
  name=$1
  path=/run/secrets/$name
  [ -f "$path" ] && [ ! -L "$path" ] || fail "required secret is unavailable: $name" 78
  value=$(cat "$path")
  [ -n "$value" ] || fail "required secret is empty: $name" 78
  printf '%s' "$value"
}

[ "${OMNIREACH_ENV:-}" = production ] || fail 'OMNIREACH_ENV must be production' 78
[ "${BACKUP_OFFSITE_ENABLED:-false}" = true ] || fail 'off-site backup activation is disabled' 78
[ -n "${R2_ENDPOINT:-}" ] || fail 'R2_ENDPOINT is not configured' 78
[ -n "${R2_BUCKET:-}" ] || fail 'R2_BUCKET is not configured' 78
[ -d /var/lib/omnireach ] || fail 'platform data volume is unavailable' 72
[ -d "$backup_root" ] && [ ! -L "$backup_root" ] || fail 'backup root is unavailable or unsafe' 72

umask 077
mkdir -p "$backup_root/audit" "$runtime_root"

admin_password=$(read_secret postgres_admin_password)
worker_password=$(read_secret postgres_app_password)
export R2_ACCESS_KEY_ID
R2_ACCESS_KEY_ID=$(read_secret r2_access_key_id)
export R2_SECRET_ACCESS_KEY
R2_SECRET_ACCESS_KEY=$(read_secret r2_secret_access_key)

database_url_file=$runtime_root/database-url
record_database_url_file=$runtime_root/record-database-url
inventory_file=$runtime_root/configuration-inventory.json
result_file=$runtime_root/backup-result.json
printf 'postgresql://omnireach_db_admin:%s@postgres:5432/omnireach\n' "$admin_password" >"$database_url_file"
printf 'postgresql://omnireach_runtime:%s@postgres:5432/omnireach\n' "$worker_password" >"$record_database_url_file"
unset admin_password worker_password
chmod 0600 "$database_url_file" "$record_database_url_file"

node -e '
  const { writeFileSync } = require("node:fs");
  writeFileSync(process.argv[1], JSON.stringify({
    formatVersion: 1,
    sourceCommitSha: process.env.SOURCE_COMMIT_SHA || "unknown",
    sources: ["postgresql", "assets", "publications"],
  }) + "\n", { mode: 0o600 });
' "$inventory_file"

case "${1:-daily}" in
  daily)
    kind=daily
    [ "$(date -u +%u)" -ne 7 ] || kind=weekly
    node "$cli" backup \
      --destination "$backup_root" \
      --key-file /run/secrets/backup_encryption_key \
      --kind "$kind" \
      --database-url-file "$database_url_file" \
      --record-database-url-file "$record_database_url_file" \
      --input /var/lib/omnireach/assets \
      --input /var/lib/omnireach/publications \
      --input "$inventory_file" \
      --offsite >"$result_file"

    offsite_key=$(node -e '
      const { readFileSync } = require("node:fs");
      const value = JSON.parse(readFileSync(process.argv[1], "utf8"));
      if (!value.verified || !value.offsite?.archive?.key) process.exit(1);
      process.stdout.write(value.offsite.archive.key);
    ' "$result_file") || fail 'backup completed without a verified off-site object' 70

    node "$cli" verify \
      --offsite-key "$offsite_key" \
      --key-file /run/secrets/backup_encryption_key \
      --record-database-url-file "$record_database_url_file" >/dev/null

    node "$cli" prune \
      --root "$backup_root" \
      --daily 7 \
      --weekly 4 \
      --apply \
      --automated-retention \
      --audit-log "$audit_log" \
      --record-database-url-file "$record_database_url_file" >/dev/null

    node "$cli" prune \
      --offsite \
      --daily 7 \
      --weekly 4 \
      --apply \
      --automated-retention \
      --audit-log "$audit_log" \
      --record-database-url-file "$record_database_url_file" >/dev/null
    printf '{"backup":"complete","offsiteVerified":true,"retention":"7-daily-4-weekly"}\n'
    ;;
  list)
    node "$cli" list --root "$backup_root"
    ;;
  *)
    fail 'expected daily or list command' 64
    ;;
esac
