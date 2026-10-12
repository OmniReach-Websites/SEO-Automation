#!/bin/sh
set -eu

deploy_root=/opt/servers/omnireach
incoming_root=$deploy_root/incoming
releases_root=$deploy_root/releases
shared_root=$deploy_root/shared
lock_file=$deploy_root/.release.lock
metadata_validator=/usr/local/libexec/omnireach-validate-release-metadata
required_auth_contract=2
required_crypto_contract=2
api_port=44100

fail() {
  printf 'omnireach-release: %s\n' "$1" >&2
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail 'must run as root through the restricted wrapper'
  [ "${SUDO_USER:-omnireach-deploy}" = omnireach-deploy ] || fail 'unexpected invoking account'
  [ -x "$metadata_validator" ] || fail 'release metadata validator is not installed'
}

validate_release_id() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$' ||
    fail 'release ID must be a 40-character lowercase commit SHA'
}

compose() {
  compose_release_dir=$1
  compose_release_id=$2
  shift 2
  OMNIREACH_RELEASE_SHA=$compose_release_id \
  OMNIREACH_ENV_FILE=$shared_root/config/production.env \
  OMNIREACH_SECRETS_DIR=$shared_root/secrets \
  OMNIREACH_RESOURCE_PREFIX=omnireach-production \
    docker compose \
      --project-name omnireach-production \
      --file "$compose_release_dir/infrastructure/compose/production.compose.yml" \
      --profile application "$@"
}

wait_for_readiness() {
  expected_auth=$1
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    readiness=$(curl --fail --silent --show-error --max-time 3 \
      "http://127.0.0.1:$api_port/health/ready" 2>/dev/null || true)
    if printf '%s' "$readiness" |
      grep -Eq '"authContract"[[:space:]]*:[[:space:]]*'"$expected_auth"'([[:space:]]*[,}])'; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 5
  done
  return 1
}

lock_release_operation() {
  exec 9>"$lock_file"
  flock -n 9 || fail 'another release operation is active'
}

resolve_pointer() {
  pointer_name=$1
  resolved_pointer=''
  [ -L "$deploy_root/$pointer_name" ] || return 0
  resolved_pointer=$(readlink -f "$deploy_root/$pointer_name") ||
    fail "$pointer_name release pointer is broken"
  case "$resolved_pointer" in
    "$releases_root"/*) : ;;
    *) fail "$pointer_name release pointer is outside the release root" ;;
  esac
  [ -d "$resolved_pointer" ] || fail "$pointer_name release directory is missing"
}

metadata_path() {
  printf '%s/omnireach-release.meta\n' "$1"
}

release_schema_target() {
  contract_dir=$1
  contract_id=$(basename "$contract_dir")
  "$metadata_validator" schema-target "$(metadata_path "$contract_dir")" "$contract_id"
}

release_auth_contract() {
  contract_dir=$1
  contract_id=$(basename "$contract_dir")
  "$metadata_validator" auth-contract "$(metadata_path "$contract_dir")" "$contract_id"
}

release_crypto_write() {
  contract_dir=$1
  contract_id=$(basename "$contract_dir")
  "$metadata_validator" crypto-write "$(metadata_path "$contract_dir")" "$contract_id"
}

assert_release_supports() {
  support_dir=$1
  required_schema=$2
  required_auth=$3
  required_crypto=$4
  support_id=$(basename "$support_dir")
  "$metadata_validator" supports "$(metadata_path "$support_dir")" "$support_id" \
    "$required_schema" "$required_auth" "$required_crypto"
}

validate_archive() {
  archive_path=$1
  checksum_path=$2
  chown root:root "$archive_path" "$checksum_path"
  chmod 0600 "$archive_path" "$checksum_path"

  expected_checksum=$(awk 'NR == 1 && $1 ~ /^[0-9a-f]{64}$/ { print $1 }' "$checksum_path")
  [ -n "$expected_checksum" ] || fail 'checksum file is malformed'
  actual_checksum=$(sha256sum "$archive_path" | awk '{ print $1 }')
  [ "$actual_checksum" = "$expected_checksum" ] || fail 'release checksum mismatch'

  tar -tzf "$archive_path" | while IFS= read -r member; do
    case "$member" in
      ''|/*|..|../*|*/..|*/../*) fail 'release archive contains an unsafe path' ;;
    esac
  done
  if tar -tvzf "$archive_path" |
    awk 'substr($1,1,1) != "-" && substr($1,1,1) != "d" { exit 1 }'; then
    :
  else
    fail 'release archive contains unsupported filesystem entries'
  fi
}

stage_release() {
  stage_release_id=$1
  validate_release_id "$stage_release_id"
  stage_archive=$incoming_root/$stage_release_id.tgz
  stage_checksum=$incoming_root/$stage_release_id.tgz.sha256
  [ -f "$stage_archive" ] || fail 'release archive is missing from the fixed incoming directory'
  [ -f "$stage_checksum" ] || fail 'release checksum is missing from the fixed incoming directory'
  [ ! -L "$stage_archive" ] && [ ! -L "$stage_checksum" ] ||
    fail 'incoming release files must not be symlinks'
  validate_archive "$stage_archive" "$stage_checksum"

  release_dir=$releases_root/$stage_release_id
  stage_dir=$releases_root/.$stage_release_id.staging
  if [ -d "$release_dir" ]; then
    [ -f "$release_dir/.artifact-sha256" ] ||
      fail 'existing release is missing its immutable artifact identity'
    [ "$(cat "$release_dir/.artifact-sha256")" = "$actual_checksum" ] ||
      fail 'release ID was reused for a different artifact'
  else
    rm -rf -- "$stage_dir"
    install -d -m 0750 -o root -g root "$stage_dir"
    tar --extract --gzip --file "$stage_archive" --directory "$stage_dir" \
      --no-same-owner --no-same-permissions
    [ -f "$stage_dir/infrastructure/compose/production.compose.yml" ] ||
      fail 'release is missing production Compose'
    [ -x "$stage_dir/infrastructure/compose/scripts/bootstrap-secrets.sh" ] ||
      fail 'release is missing executable secret bootstrap'
    [ -f "$stage_dir/omnireach-images.tar.gz" ] || fail 'release is missing runtime images'
    [ -f "$stage_dir/omnireach-images.tar.gz.sha256" ] ||
      fail 'release is missing runtime image checksum'
    (cd "$stage_dir" && sha256sum --check --status omnireach-images.tar.gz.sha256) ||
      fail 'runtime image checksum mismatch'
    "$metadata_validator" validate "$stage_dir/omnireach-release.meta" "$stage_release_id"
    printf '%s\n' "$actual_checksum" >"$stage_dir/.artifact-sha256"
    chmod 0444 "$stage_dir/omnireach-release.meta" "$stage_dir/.artifact-sha256"
    mv "$stage_dir" "$release_dir"
  fi
  "$metadata_validator" validate "$release_dir/omnireach-release.meta" "$stage_release_id"
  staged_release_dir=$release_dir
}

prepare_release() {
  prepare_dir=$1
  prepare_id=$(basename "$prepare_dir")
  "$prepare_dir/infrastructure/compose/scripts/bootstrap-secrets.sh" \
    --secrets-dir "$shared_root/secrets"
  docker load --input "$prepare_dir/omnireach-images.tar.gz" >/dev/null
  compose "$prepare_dir" "$prepare_id" config --quiet
}

start_release() {
  start_dir=$1
  start_id=$(basename "$start_dir")
  start_auth=$(release_auth_contract "$start_dir")
  compose "$start_dir" "$start_id" up --detach --no-build &&
    wait_for_readiness "$start_auth"
}

set_release_pointers() {
  active_dir=$1
  prior_dir=$2
  ln -sfn "$active_dir" "$deploy_root/.current.candidate"
  mv -Tf "$deploy_root/.current.candidate" "$deploy_root/current"
  if [ -n "$prior_dir" ] && [ "$prior_dir" != "$active_dir" ]; then
    ln -sfn "$prior_dir" "$deploy_root/.previous.candidate"
    mv -Tf "$deploy_root/.previous.candidate" "$deploy_root/previous"
  else
    rm -f -- "$deploy_root/previous"
  fi
}

restore_release() {
  restore_dir=$1
  restore_prior=$2
  [ -n "$restore_dir" ] || return 0
  restore_id=$(basename "$restore_dir")
  printf 'omnireach-release: restoring compatible release %s\n' "$restore_id" >&2
  start_release "$restore_dir" || fail 'candidate and compatible rollback health checks failed'
  set_release_pointers "$restore_dir" "$restore_prior"
}

deploy_release() {
  deploy_id=$1
  lock_release_operation
  stage_release "$deploy_id"
  candidate_dir=$staged_release_dir
  candidate_schema=$(release_schema_target "$candidate_dir")
  candidate_auth=$(release_auth_contract "$candidate_dir")
  candidate_crypto=$(release_crypto_write "$candidate_dir")
  [ "$candidate_auth" -eq "$required_auth_contract" ] ||
    fail 'candidate does not implement the required authentication contract'
  [ "$candidate_crypto" -ge "$required_crypto_contract" ] ||
    fail 'candidate does not implement the required crypto/keyring contract'

  resolve_pointer current
  prior_dir=$resolved_pointer
  if [ -n "$prior_dir" ]; then
    [ -f "$(metadata_path "$prior_dir")" ] ||
      fail 'active release predates contract metadata; use the reviewed bridge operation'
    prior_schema=$(release_schema_target "$prior_dir")
    prior_auth=$(release_auth_contract "$prior_dir")
    prior_crypto=$(release_crypto_write "$prior_dir")
    [ "$candidate_crypto" -eq "$prior_crypto" ] ||
      fail 'ordinary deployment requires equal crypto write contracts; use the reviewed bridge operation'
    assert_release_supports \
      "$prior_dir" "$candidate_schema" "$candidate_auth" "$candidate_crypto" ||
      fail 'active release cannot safely roll back after the candidate contract transition'
    assert_release_supports \
      "$candidate_dir" "$prior_schema" "$prior_auth" "$prior_crypto" ||
      fail 'candidate cannot read the active release contracts'
  fi

  prepare_release "$candidate_dir"
  if ! start_release "$candidate_dir"; then
    compose "$candidate_dir" "$deploy_id" ps >&2 || true
    compose "$candidate_dir" "$deploy_id" logs --no-color --tail 100 api migrate postgres redis >&2 || true
    restore_release "$prior_dir" ''
    fail 'candidate readiness failed and a compatible prior release was restored'
  fi
  set_release_pointers "$candidate_dir" "$prior_dir"
  rm -f -- "$incoming_root/$deploy_id.tgz" "$incoming_root/$deploy_id.tgz.sha256"
  printf 'omnireach-release: activated %s\n' "$deploy_id"
}

bridge_release() {
  candidate_id=$1
  rollback_id=$2
  [ "$candidate_id" != "$rollback_id" ] || fail 'bridge candidate and rollback releases must differ'
  lock_release_operation

  stage_release "$candidate_id"
  candidate_dir=$staged_release_dir
  candidate_schema=$(release_schema_target "$candidate_dir")
  candidate_auth=$(release_auth_contract "$candidate_dir")
  candidate_crypto=$(release_crypto_write "$candidate_dir")
  [ "$candidate_auth" -eq "$required_auth_contract" ] ||
    fail 'bridge candidate does not implement the required authentication contract'
  [ "$candidate_crypto" -ge "$required_crypto_contract" ] ||
    fail 'bridge candidate does not implement the required crypto/keyring contract'

  stage_release "$rollback_id"
  rollback_dir=$staged_release_dir
  rollback_schema=$(release_schema_target "$rollback_dir")
  rollback_auth=$(release_auth_contract "$rollback_dir")
  rollback_crypto=$(release_crypto_write "$rollback_dir")
  [ "$rollback_crypto" -eq "$candidate_crypto" ] ||
    fail 'bridge candidate and rollback must use the same crypto write contract'
  assert_release_supports \
    "$rollback_dir" "$candidate_schema" "$candidate_auth" "$candidate_crypto" ||
    fail 'reviewed rollback release is incompatible with the candidate contracts'
  assert_release_supports \
    "$candidate_dir" "$rollback_schema" "$rollback_auth" "$rollback_crypto" ||
    fail 'bridge candidate cannot recover from reviewed rollback writes'

  resolve_pointer current
  legacy_dir=$resolved_pointer
  prepare_release "$rollback_dir"
  prepare_release "$candidate_dir"
  if ! start_release "$candidate_dir"; then
    compose "$candidate_dir" "$candidate_id" ps >&2 || true
    compose "$candidate_dir" "$candidate_id" logs --no-color --tail 100 api migrate postgres redis >&2 || true
    restore_release "$rollback_dir" "$legacy_dir"
    fail 'bridge candidate failed and the reviewed compatible rollback was activated'
  fi
  set_release_pointers "$candidate_dir" "$rollback_dir"
  rm -f -- \
    "$incoming_root/$candidate_id.tgz" "$incoming_root/$candidate_id.tgz.sha256" \
    "$incoming_root/$rollback_id.tgz" "$incoming_root/$rollback_id.tgz.sha256"
  printf 'omnireach-release: activated bridge candidate %s with rollback %s\n' \
    "$candidate_id" "$rollback_id"
}

rollback_release() {
  lock_release_operation
  resolve_pointer current
  active_dir=$resolved_pointer
  [ -n "$active_dir" ] || fail 'no active release is available'
  resolve_pointer previous
  rollback_dir=$resolved_pointer
  [ -n "$rollback_dir" ] || fail 'no reviewed rollback release is available'

  active_schema=$(release_schema_target "$active_dir")
  active_auth=$(release_auth_contract "$active_dir")
  active_crypto=$(release_crypto_write "$active_dir")
  rollback_schema=$(release_schema_target "$rollback_dir")
  rollback_auth=$(release_auth_contract "$rollback_dir")
  rollback_crypto=$(release_crypto_write "$rollback_dir")
  [ "$rollback_crypto" -ge "$active_crypto" ] ||
    fail 'rollback would lower the active crypto write contract'
  assert_release_supports \
    "$rollback_dir" "$active_schema" "$active_auth" "$active_crypto" ||
    fail 'rollback release is incompatible with the active schema, authentication, or crypto/keyring contracts'
  assert_release_supports \
    "$active_dir" "$rollback_schema" "$rollback_auth" "$rollback_crypto" ||
    fail 'active release cannot recover from rollback writes'
  prepare_release "$rollback_dir"
  if ! start_release "$rollback_dir"; then
    start_release "$active_dir" || fail 'rollback and active release health checks failed'
    fail 'rollback failed and the active release was restored'
  fi
  set_release_pointers "$rollback_dir" "$active_dir"
  printf 'omnireach-release: rolled back to %s\n' "$(basename "$rollback_dir")"
}

require_root
case "${1:-}" in
  deploy)
    [ "$#" -eq 2 ] || fail 'usage: omnireach-release deploy <commit-sha>'
    deploy_release "$2"
    ;;
  bridge)
    [ "$#" -eq 3 ] ||
      fail 'usage: omnireach-release bridge <candidate-sha> <reviewed-rollback-sha>'
    bridge_release "$2" "$3"
    ;;
  rollback)
    [ "$#" -eq 1 ] || fail 'usage: omnireach-release rollback'
    rollback_release
    ;;
  *) fail 'permitted operations are deploy, bridge, and rollback' ;;
esac
