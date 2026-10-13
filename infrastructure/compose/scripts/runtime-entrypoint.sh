#!/bin/sh
set -eu

read_hex_secret() {
  name=$1
  path=/run/secrets/$name
  [ -r "$path" ] || { printf 'Required secret is not readable: %s\n' "$name" >&2; exit 78; }
  value=$(cat "$path")
  case "$value" in
    *[!a-f0-9]*|'') printf 'Required secret has an invalid format: %s\n' "$name" >&2; exit 78 ;;
  esac
  [ "${#value}" -eq 64 ] || {
    printf 'Required secret has an invalid length: %s\n' "$name" >&2
    exit 78
  }
  printf '%s' "$value"
}

postgres_password=$(read_hex_secret postgres_app_password)
redis_password=$(read_hex_secret redis_app_password)
export DATABASE_URL="postgresql://omnireach_runtime:${postgres_password}@postgres:5432/omnireach"
export REDIS_URL="redis://omnireach_runtime:${redis_password}@redis:6379/0"
export SESSION_SECRET="$(read_hex_secret session_secret)"
export MFA_ENCRYPTION_KEY="$(read_hex_secret mfa_encryption_key)"
keyring_path=/run/secrets/mfa_encryption_keyring
[ -r "$keyring_path" ] || {
  printf '%s\n' 'Required secret is not readable: mfa_encryption_keyring' >&2
  exit 78
}
keyring_pattern='^\{"activeVersion":[1-9][0-9]*,"keys":\{"[1-9][0-9]*":"[a-f0-9]{64}"(,"[1-9][0-9]*":"[a-f0-9]{64}")*\}\}$'
grep -Eq "$keyring_pattern" "$keyring_path" || {
  printf '%s\n' 'Required secret has an invalid format: mfa_encryption_keyring' >&2
  exit 78
}
export MFA_ENCRYPTION_KEYRING_JSON="$(cat "$keyring_path")"
export PREVIEW_SIGNING_KEY="$(read_hex_secret preview_signing_key)"
export CONTACT_ENCRYPTION_KEY="$(read_hex_secret contact_encryption_key)"
export GOOGLE_TOKEN_ENCRYPTION_KEY="$(read_hex_secret google_token_encryption_key)"
unset postgres_password redis_password

exec "$@"
