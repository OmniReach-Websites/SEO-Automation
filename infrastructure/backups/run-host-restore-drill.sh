#!/bin/sh
set -eu

deploy_root=/opt/servers/omnireach
current_link=$deploy_root/current
shared_root=$deploy_root/shared
backup_root=/opt/backups/omnireach
lock_file=/run/lock/omnireach-backup.lock
release_dir=
release_sha=

fail() {
  printf 'run-host-restore-drill: %s\n' "$1" >&2
  exit "${2:-1}"
}

[ "$(id -u)" -eq 0 ] || fail 'must run as root' 77
[ -L "$current_link" ] || fail 'current release link is unavailable' 72
release_dir=$(readlink -f "$current_link")
case "$release_dir" in
  "$deploy_root"/releases/*) ;;
  *) fail 'current release resolves outside the immutable release directory' 72 ;;
esac
release_sha=$(basename "$release_dir")
case "$release_sha" in
  *[!a-f0-9]*|'') fail 'current release identifier is invalid' 72 ;;
esac
[ "${#release_sha}" -eq 40 ] || fail 'current release identifier is not a full commit SHA' 72

compose_file=$release_dir/infrastructure/compose/production.compose.yml
[ -f "$compose_file" ] || fail 'current release is missing production Compose' 72
[ -f "$shared_root/config/production.env" ] || fail 'production environment file is unavailable' 72
[ -d "$shared_root/secrets" ] || fail 'production secret directory is unavailable' 72
[ -d "$backup_root" ] && [ ! -L "$backup_root" ] || fail 'backup root is unavailable or unsafe' 72
command -v docker >/dev/null 2>&1 || fail 'docker is unavailable' 69
command -v flock >/dev/null 2>&1 || fail 'flock is unavailable' 69

exec 9>"$lock_file"
flock -n 9 || fail 'another backup or restore operation is already running' 75

export OMNIREACH_RELEASE_SHA=$release_sha
export OMNIREACH_ENV_FILE=$shared_root/config/production.env
export OMNIREACH_SECRETS_DIR=$shared_root/secrets
export OMNIREACH_RESOURCE_PREFIX=omnireach-production
export OMNIREACH_BACKUP_ROOT=$backup_root

compose() {
  docker compose \
    --project-name omnireach-production \
    --file "$compose_file" \
    --profile operations \
    --profile restore-drill "$@"
}

cleanup() {
  compose rm --force --stop restore-postgres >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
cleanup
compose up --detach --no-build --wait restore-postgres
compose exec -T restore-postgres psql --no-psqlrc --username omnireach_restore \
  --dbname omnireach_restore --set ON_ERROR_STOP=1 --command \
  "DO \$\$ BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnireach_app') THEN CREATE ROLE omnireach_app NOLOGIN; END IF;
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnireach_auth') THEN CREATE ROLE omnireach_auth NOLOGIN; END IF;
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnireach_platform') THEN CREATE ROLE omnireach_platform NOLOGIN; END IF;
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnireach_worker') THEN CREATE ROLE omnireach_worker NOLOGIN; END IF;
   END \$\$;" >/dev/null
compose run --rm --no-deps backup restore-drill
cleanup
trap - EXIT HUP INT TERM
