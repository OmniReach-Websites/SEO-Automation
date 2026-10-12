#!/bin/sh
set -eu

deploy_root=/opt/servers/omnireach
incoming_root=$deploy_root/incoming
releases_root=$deploy_root/releases
shared_root=$deploy_root/shared
lock_file=$deploy_root/.release.lock
api_port=44100

fail() {
  printf 'omnireach-release: %s\n' "$1" >&2
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail 'must run as root through the restricted wrapper'
  [ "${SUDO_USER:-omnireach-deploy}" = omnireach-deploy ] || fail 'unexpected invoking account'
}

validate_release_id() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$' || fail 'release ID must be a 40-character lowercase commit SHA'
}

compose() {
  release_dir=$1
  release_id=$2
  shift 2
  OMNIREACH_RELEASE_SHA=$release_id \
  OMNIREACH_ENV_FILE=$shared_root/config/production.env \
  OMNIREACH_SECRETS_DIR=$shared_root/secrets \
  OMNIREACH_RESOURCE_PREFIX=omnireach-production \
    docker compose \
      --project-name omnireach-production \
      --file "$release_dir/infrastructure/compose/production.compose.yml" \
      --profile application "$@"
}

wait_for_readiness() {
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    readiness=$(curl --fail --silent --show-error --max-time 3 \
      "http://127.0.0.1:$api_port/health/ready" 2>/dev/null || true)
    if printf '%s' "$readiness" | grep -Eq '"authContract"[[:space:]]*:[[:space:]]*2'; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 5
  done
  return 1
}

restore_previous() {
  previous=$1
  [ -n "$previous" ] || return 0
  previous_id=$(basename "$previous")
  printf 'omnireach-release: restoring prior release %s\n' "$previous_id" >&2
  compose "$previous" "$previous_id" up --detach --no-build
  wait_for_readiness || fail 'candidate and automatic rollback health checks failed'
  ln -sfn "$previous" "$deploy_root/.current.rollback"
  mv -Tf "$deploy_root/.current.rollback" "$deploy_root/current"
}

deploy_release() {
  release_id=$1
  validate_release_id "$release_id"

  archive=$incoming_root/$release_id.tgz
  checksum=$incoming_root/$release_id.tgz.sha256
  [ -f "$archive" ] || fail 'release archive is missing from the fixed incoming directory'
  [ -f "$checksum" ] || fail 'release checksum is missing from the fixed incoming directory'
  [ ! -L "$archive" ] && [ ! -L "$checksum" ] || fail 'incoming release files must not be symlinks'

  exec 9>"$lock_file"
  flock -n 9 || fail 'another release operation is active'

  chown root:root "$archive" "$checksum"
  chmod 0600 "$archive" "$checksum"

  expected=$(awk 'NR == 1 && $1 ~ /^[0-9a-f]{64}$/ { print $1 }' "$checksum")
  [ -n "$expected" ] || fail 'checksum file is malformed'
  actual=$(sha256sum "$archive" | awk '{ print $1 }')
  [ "$actual" = "$expected" ] || fail 'release checksum mismatch'

  tar -tzf "$archive" | while IFS= read -r member; do
    case "$member" in
      ''|/*|..|../*|*/..|*/../*) fail 'release archive contains an unsafe path' ;;
    esac
  done
  if tar -tvzf "$archive" | awk 'substr($1,1,1) != "-" && substr($1,1,1) != "d" { exit 1 }'; then
    :
  else
    fail 'release archive contains unsupported filesystem entries'
  fi

  release_dir=$releases_root/$release_id
  stage_dir=$releases_root/.$release_id.staging
  if [ ! -d "$release_dir" ]; then
    rm -rf -- "$stage_dir"
    install -d -m 0750 -o root -g root "$stage_dir"
    tar --extract --gzip --file "$archive" --directory "$stage_dir" \
      --no-same-owner --no-same-permissions
    [ -f "$stage_dir/infrastructure/compose/production.compose.yml" ] || fail 'release is missing production Compose'
    [ -x "$stage_dir/infrastructure/compose/scripts/bootstrap-secrets.sh" ] || fail 'release is missing executable secret bootstrap'
    [ -f "$stage_dir/omnireach-images.tar.gz" ] || fail 'release is missing runtime images'
    [ -f "$stage_dir/omnireach-images.tar.gz.sha256" ] || fail 'release is missing runtime image checksum'
    (cd "$stage_dir" && sha256sum --check --status omnireach-images.tar.gz.sha256) || fail 'runtime image checksum mismatch'
    mv "$stage_dir" "$release_dir"
  fi

  "$release_dir/infrastructure/compose/scripts/bootstrap-secrets.sh" \
    --secrets-dir "$shared_root/secrets"
  docker load --input "$release_dir/omnireach-images.tar.gz" >/dev/null
  compose "$release_dir" "$release_id" config --quiet

  previous=''
  if [ -L "$deploy_root/current" ]; then
    previous=$(readlink -f "$deploy_root/current")
    case "$previous" in
      "$releases_root"/*) : ;;
      *) fail 'current release pointer is outside the release root' ;;
    esac
  fi

  # This migration establishes a fail-closed authentication contract that a
  # pre-v2 binary cannot satisfy. Refuse to let the ordinary auto-deploy path
  # cross that one-way boundary: doing so would make its automatic rollback
  # target unable to pass authentication readiness. The first transition must
  # use the separately reviewed bridge/forward-recovery runbook.
  auth_contract_migration="$release_dir/packages/database/prisma/migrations/20261010250000_g05_account_authentication_policy/migration.sql"
  if [ -n "$previous" ] && [ -f "$auth_contract_migration" ]; then
    current_readiness=$(curl --fail --silent --show-error --max-time 3 \
      "http://127.0.0.1:$api_port/health/ready" 2>/dev/null || true)
    if ! printf '%s' "$current_readiness" | grep -Eq '"authContract"[[:space:]]*:[[:space:]]*2'; then
      fail 'authentication contract v2 is a forward-only boundary; deploy a reviewed bridge release before this artifact'
    fi
  fi

  if ! compose "$release_dir" "$release_id" up --detach --no-build; then
    restore_previous "$previous"
    fail 'candidate start failed and the prior release was restored'
  fi
  if ! wait_for_readiness; then
    compose "$release_dir" "$release_id" ps >&2 || true
    compose "$release_dir" "$release_id" logs --no-color --tail 100 api migrate postgres redis >&2 || true
    restore_previous "$previous"
    fail 'candidate readiness failed and the prior release was restored'
  fi

  ln -sfn "$release_dir" "$deploy_root/.current.candidate"
  mv -Tf "$deploy_root/.current.candidate" "$deploy_root/current"
  if [ -n "$previous" ] && [ "$previous" != "$release_dir" ]; then
    ln -sfn "$previous" "$deploy_root/previous"
  fi
  rm -f -- "$archive" "$checksum"
  printf 'omnireach-release: activated %s\n' "$release_id"
}

require_root
[ "$#" -eq 2 ] || fail 'usage: omnireach-release deploy <commit-sha>'
[ "$1" = deploy ] || fail 'only the deploy operation is permitted'
deploy_release "$2"
