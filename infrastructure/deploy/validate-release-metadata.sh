#!/bin/sh
set -eu

fail() {
  printf 'validate-release-metadata: %s\n' "$1" >&2
  exit 1
}

positive_integer() {
  printf '%s' "$1" | grep -Eq '^[1-9][0-9]*$'
}

read_metadata() {
  metadata_file=$1
  expected_release=$2
  [ -f "$metadata_file" ] && [ ! -L "$metadata_file" ] ||
    fail 'metadata must be a regular non-symlink file'
  metadata_bytes=$(wc -c <"$metadata_file")
  [ "$metadata_bytes" -le 4096 ] || fail 'metadata file is unexpectedly large'

  metadata_version=''
  metadata_release=''
  metadata_source=''
  metadata_auth=''
  metadata_schema_min=''
  metadata_schema_max=''
  metadata_schema_target=''
  metadata_migration_head=''
  metadata_migration_count=''
  seen_keys='|'

  while IFS= read -r metadata_line || [ -n "$metadata_line" ]; do
    [ -n "$metadata_line" ] || continue
    case "$metadata_line" in
      *=*) : ;;
      *) fail 'metadata line is malformed' ;;
    esac
    metadata_key=${metadata_line%%=*}
    metadata_value=${metadata_line#*=}
    case "$seen_keys" in
      *"|$metadata_key|"*) fail "duplicate metadata key: $metadata_key" ;;
    esac
    seen_keys=${seen_keys}${metadata_key}'|'
    case "$metadata_key" in
      OMNIREACH_RELEASE_METADATA_VERSION) metadata_version=$metadata_value ;;
      OMNIREACH_RELEASE_ID) metadata_release=$metadata_value ;;
      OMNIREACH_SOURCE_COMMIT) metadata_source=$metadata_value ;;
      OMNIREACH_AUTH_CONTRACT) metadata_auth=$metadata_value ;;
      OMNIREACH_SCHEMA_MIN) metadata_schema_min=$metadata_value ;;
      OMNIREACH_SCHEMA_MAX) metadata_schema_max=$metadata_value ;;
      OMNIREACH_SCHEMA_TARGET) metadata_schema_target=$metadata_value ;;
      OMNIREACH_MIGRATION_HEAD) metadata_migration_head=$metadata_value ;;
      OMNIREACH_MIGRATION_COUNT) metadata_migration_count=$metadata_value ;;
      *) fail "unknown metadata key: $metadata_key" ;;
    esac
  done <"$metadata_file"

  [ "$metadata_version" = 1 ] || fail 'unsupported metadata version'
  printf '%s' "$expected_release" | grep -Eq '^[0-9a-f]{40}$' ||
    fail 'expected release ID is invalid'
  [ "$metadata_release" = "$expected_release" ] || fail 'release metadata identity mismatch'
  [ "$metadata_source" = "$expected_release" ] || fail 'source commit identity mismatch'
  positive_integer "$metadata_auth" || fail 'authentication contract must be positive'
  positive_integer "$metadata_schema_min" || fail 'minimum schema contract must be positive'
  positive_integer "$metadata_schema_max" || fail 'maximum schema contract must be positive'
  positive_integer "$metadata_schema_target" || fail 'target schema contract must be positive'
  positive_integer "$metadata_migration_count" || fail 'migration count must be positive'
  printf '%s' "$metadata_migration_head" |
    grep -Eq '^[0-9]{14}_[a-z0-9_]+$' || fail 'migration head is invalid'
  [ "$metadata_schema_min" -le "$metadata_schema_target" ] &&
    [ "$metadata_schema_target" -le "$metadata_schema_max" ] ||
    fail 'target schema contract is outside the compatibility range'
}

[ "$#" -ge 3 ] ||
  fail 'usage: validate-release-metadata COMMAND FILE EXPECTED_RELEASE [SCHEMA AUTH]'
command_name=$1
metadata_path=$2
expected_id=$3
shift 3
read_metadata "$metadata_path" "$expected_id"

case "$command_name" in
  validate)
    [ "$#" -eq 0 ] || fail 'validate accepts no additional arguments'
    ;;
  supports)
    [ "$#" -eq 2 ] || fail 'supports requires schema and authentication contracts'
    required_schema=$1
    required_auth=$2
    positive_integer "$required_schema" || fail 'required schema contract must be positive'
    positive_integer "$required_auth" || fail 'required authentication contract must be positive'
    [ "$metadata_auth" -eq "$required_auth" ] ||
      fail 'release authentication contract is incompatible'
    [ "$metadata_schema_min" -le "$required_schema" ] &&
      [ "$required_schema" -le "$metadata_schema_max" ] ||
      fail 'release schema contract is incompatible'
    ;;
  schema-target)
    [ "$#" -eq 0 ] || fail 'schema-target accepts no additional arguments'
    printf '%s\n' "$metadata_schema_target"
    ;;
  auth-contract)
    [ "$#" -eq 0 ] || fail 'auth-contract accepts no additional arguments'
    printf '%s\n' "$metadata_auth"
    ;;
  *) fail 'unknown metadata command' ;;
esac
