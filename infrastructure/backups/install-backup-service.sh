#!/bin/sh
set -eu

deploy_root=/opt/servers/omnireach
backup_root=/opt/backups/omnireach
secrets_dir=$deploy_root/shared/secrets
environment_file=$deploy_root/shared/config/production.env
credentials_file=
enable=false
run_now=false
run_restore=false

usage() {
  printf '%s\n' 'Usage: install-backup-service.sh --credentials-file PROTECTED_FILE [--enable] [--run-now] [--run-restore]'
}

fail() {
  printf 'install-backup-service: %s\n' "$1" >&2
  exit "${2:-1}"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --credentials-file)
      [ "$#" -ge 2 ] || { usage >&2; exit 64; }
      credentials_file=$2
      shift 2
      ;;
    --enable)
      enable=true
      shift
      ;;
    --run-now)
      run_now=true
      shift
      ;;
    --run-restore)
      run_restore=true
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 64
      ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fail 'must run as root' 77
[ -n "$credentials_file" ] || fail '--credentials-file is required' 64
[ -f "$credentials_file" ] && [ ! -L "$credentials_file" ] || fail 'credential input must be a regular non-symbolic file' 65
credential_mode=$(stat -c '%a' "$credentials_file")
case "$credential_mode" in
  600|400) ;;
  *) fail 'credential input permissions must be 0600 or 0400' 65 ;;
esac
[ -L "$deploy_root/current" ] || fail 'current release link is unavailable' 72
release_dir=$(readlink -f "$deploy_root/current")
case "$release_dir" in
  "$deploy_root"/releases/*) ;;
  *) fail 'current release resolves outside the immutable release directory' 72 ;;
esac

credential_value() {
  key=$1
  count=$(grep -c "^${key}=" "$credentials_file" || true)
  [ "$count" -eq 1 ] || fail "credential input must contain exactly one $key" 65
  sed -n "s/^${key}=//p" "$credentials_file"
}

r2_endpoint=$(credential_value R2_ENDPOINT)
r2_bucket=$(credential_value R2_BUCKET)
r2_access_key_id=$(credential_value R2_ACCESS_KEY_ID)
r2_secret_access_key=$(credential_value R2_SECRET_ACCESS_KEY)

printf '%s' "$r2_endpoint" | grep -Eq '^https://[a-zA-Z0-9]+\.r2\.cloudflarestorage\.com$' ||
  fail 'R2 endpoint format is invalid' 65
printf '%s' "$r2_bucket" | grep -Eq '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' ||
  fail 'R2 bucket format is invalid' 65
printf '%s' "$r2_access_key_id" | grep -Eq '^[A-Za-z0-9_-]{16,128}$' ||
  fail 'R2 access key ID format is invalid' 65
printf '%s' "$r2_secret_access_key" | grep -Eq '^[A-Za-z0-9_+/=-]{32,256}$' ||
  fail 'R2 secret access key format is invalid' 65

command -v openssl >/dev/null 2>&1 || fail 'openssl is required' 69
command -v docker >/dev/null 2>&1 || fail 'docker is required' 69
command -v systemctl >/dev/null 2>&1 || fail 'systemd is required' 69

umask 077
install -d -m 0700 -o root -g root "$secrets_dir" "$backup_root" "$backup_root/audit"

install_secret() {
  name=$1
  value=$2
  temporary=$(mktemp "$secrets_dir/.${name}.XXXXXX")
  trap 'rm -f "$temporary"' EXIT HUP INT TERM
  printf '%s\n' "$value" >"$temporary"
  chmod 0400 "$temporary"
  chown root:root "$temporary"
  mv -f "$temporary" "$secrets_dir/$name"
  trap - EXIT HUP INT TERM
}

install_secret r2_access_key_id "$r2_access_key_id"
install_secret r2_secret_access_key "$r2_secret_access_key"
unset r2_access_key_id r2_secret_access_key

backup_key=$secrets_dir/backup_encryption_key
if [ -e "$backup_key" ]; then
  [ -f "$backup_key" ] && [ ! -L "$backup_key" ] || fail 'backup encryption key target is unsafe' 65
  grep -Eq '^[a-f0-9]{64}$' "$backup_key" || fail 'existing backup encryption key format is invalid' 65
  chmod 0400 "$backup_key"
else
  temporary=$(mktemp "$secrets_dir/.backup_encryption_key.XXXXXX")
  trap 'rm -f "$temporary"' EXIT HUP INT TERM
  openssl rand -hex 32 >"$temporary"
  grep -Eq '^[a-f0-9]{64}$' "$temporary" || fail 'generated backup encryption key failed validation' 70
  chmod 0400 "$temporary"
  mv "$temporary" "$backup_key"
  trap - EXIT HUP INT TERM
fi

[ -f "$environment_file" ] && [ ! -L "$environment_file" ] || fail 'production environment file is unavailable or unsafe' 72
environment_tmp=$(mktemp "$deploy_root/shared/config/.production.env.XXXXXX")
trap 'rm -f "$environment_tmp"' EXIT HUP INT TERM
awk '
  !/^(R2_ENDPOINT|R2_BUCKET|R2_REGION|R2_BACKUP_PREFIX|BACKUP_OFFSITE_ENABLED|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_API_TOKEN|BACKUP_ENCRYPTION_KEY|BACKUP_MAX_SOURCE_BYTES|BACKUP_MAX_ENCRYPTED_BYTES|BACKUP_MAX_ARCHIVE_BYTES|BACKUP_R2_MAX_TOTAL_BYTES|BACKUP_R2_MAX_REQUESTS|BACKUP_R2_MAX_LIST_PAGES|BACKUP_R2_MAX_LIST_OBJECTS|BACKUP_R2_MAX_LIST_RESPONSE_BYTES)=/
' "$environment_file" >"$environment_tmp"
{
  printf 'R2_ENDPOINT=%s\n' "$r2_endpoint"
  printf 'R2_BUCKET=%s\n' "$r2_bucket"
  printf '%s\n' 'R2_REGION=auto'
  printf '%s\n' 'R2_BACKUP_PREFIX=omnireach'
  printf '%s\n' 'BACKUP_OFFSITE_ENABLED=true'
  printf '%s\n' 'BACKUP_MAX_SOURCE_BYTES=536870912'
  printf '%s\n' 'BACKUP_MAX_ENCRYPTED_BYTES=536870912'
  printf '%s\n' 'BACKUP_MAX_ARCHIVE_BYTES=536870912'
  printf '%s\n' 'BACKUP_R2_MAX_TOTAL_BYTES=8589934592'
  printf '%s\n' 'BACKUP_R2_MAX_REQUESTS=50'
  printf '%s\n' 'BACKUP_R2_MAX_LIST_PAGES=5'
  printf '%s\n' 'BACKUP_R2_MAX_LIST_OBJECTS=50'
  printf '%s\n' 'BACKUP_R2_MAX_LIST_RESPONSE_BYTES=1048576'
} >>"$environment_tmp"
chmod 0640 "$environment_tmp"
chown root:root "$environment_tmp"
mv "$environment_tmp" "$environment_file"
trap - EXIT HUP INT TERM
unset r2_endpoint r2_bucket

unit_source=$release_dir/infrastructure/backups/omnireach-backup.service
timer_source=$release_dir/infrastructure/backups/omnireach-backup.timer
failure_source=$release_dir/infrastructure/backups/omnireach-backup-failure.service
restore_source=$release_dir/infrastructure/backups/omnireach-restore-drill.service
restore_timer_source=$release_dir/infrastructure/backups/omnireach-restore-drill.timer
[ -f "$unit_source" ] && [ -f "$timer_source" ] && [ -f "$failure_source" ] &&
  [ -f "$restore_source" ] && [ -f "$restore_timer_source" ] ||
  fail 'current release is missing backup systemd units' 72
install -m 0644 -o root -g root "$unit_source" /etc/systemd/system/omnireach-backup.service
install -m 0644 -o root -g root "$timer_source" /etc/systemd/system/omnireach-backup.timer
install -m 0644 -o root -g root "$failure_source" /etc/systemd/system/omnireach-backup-failure.service
install -m 0644 -o root -g root "$restore_source" /etc/systemd/system/omnireach-restore-drill.service
install -m 0644 -o root -g root "$restore_timer_source" /etc/systemd/system/omnireach-restore-drill.timer
systemd-analyze verify \
  /etc/systemd/system/omnireach-backup.service \
  /etc/systemd/system/omnireach-backup.timer \
  /etc/systemd/system/omnireach-backup-failure.service \
  /etc/systemd/system/omnireach-restore-drill.service \
  /etc/systemd/system/omnireach-restore-drill.timer >/dev/null
systemctl daemon-reload

if [ "$enable" = true ]; then
  systemctl enable --now omnireach-backup.timer omnireach-restore-drill.timer
fi
if [ "$run_now" = true ]; then
  [ "$enable" = true ] || fail '--run-now requires --enable' 64
  systemctl start omnireach-backup.service
fi
if [ "$run_restore" = true ]; then
  [ "$run_now" = true ] || fail '--run-restore requires --run-now' 64
  systemctl start omnireach-restore-drill.service
fi

printf 'install-backup-service: configured; timers_enabled=%s first_backup_requested=%s restore_requested=%s secret_values_printed=false\n' \
  "$enable" "$run_now" "$run_restore"
