#!/bin/sh
set -eu

usage() {
  printf '%s\n' 'Usage: bootstrap-secrets.sh [--secrets-dir ABSOLUTE_PATH]'
}

secrets_dir=/opt/servers/omnireach/shared/secrets
while [ "$#" -gt 0 ]; do
  case "$1" in
    --secrets-dir)
      [ "$#" -ge 2 ] || { usage >&2; exit 64; }
      secrets_dir=$2
      shift 2
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

case "$secrets_dir" in
  /*) ;;
  *) printf '%s\n' 'Secret directory must be an absolute path' >&2; exit 64 ;;
esac
[ "$secrets_dir" != / ] || { printf '%s\n' 'Refusing filesystem root' >&2; exit 64; }
[ ! -L "$secrets_dir" ] || { printf '%s\n' 'Refusing a symlinked secret directory' >&2; exit 65; }
command -v openssl >/dev/null 2>&1 || { printf '%s\n' 'openssl is required' >&2; exit 69; }

umask 077
install -d -m 0700 "$secrets_dir"

generate_secret() {
  name=$1
  mode=${2:-0444}
  target=$secrets_dir/$name
  if [ -e "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] || {
      printf 'Refusing non-regular secret target: %s\n' "$name" >&2
      exit 65
    }
    if ! grep -Eq '^[a-f0-9]{64}$' "$target"; then
      printf 'Existing secret has an invalid format: %s\n' "$name" >&2
      exit 65
    fi
    chmod "$mode" "$target"
    printf 'kept %s\n' "$name"
    return
  fi

  temporary=$(mktemp "$secrets_dir/.${name}.XXXXXX")
  trap 'rm -f "$temporary"' EXIT HUP INT TERM
  openssl rand -hex 32 > "$temporary"
  grep -Eq '^[a-f0-9]{64}$' "$temporary" || {
    printf 'Generated secret failed validation: %s\n' "$name" >&2
    exit 70
  }
  chmod "$mode" "$temporary"
  mv "$temporary" "$target"
  trap - EXIT HUP INT TERM
  printf 'created %s\n' "$name"
}

for secret_name in \
  postgres_admin_password \
  postgres_app_password \
  redis_app_password \
  session_secret \
  mfa_encryption_key \
  preview_signing_key \
  contact_encryption_key \
  google_token_encryption_key
do
  generate_secret "$secret_name"
done

# This key is consumed only by the root-run backup container. Unlike application
# secrets, it never needs to be readable by an unprivileged runtime user.
generate_secret backup_encryption_key 0400
generate_secret backup_restore_password 0444

keyring_target=$secrets_dir/mfa_encryption_keyring
keyring_pattern='^\{"activeVersion":[1-9][0-9]*,"keys":\{"[1-9][0-9]*":"[a-f0-9]{64}"(,"[1-9][0-9]*":"[a-f0-9]{64}")*\}\}$'
if [ -e "$keyring_target" ]; then
  [ -f "$keyring_target" ] && [ ! -L "$keyring_target" ] || {
    printf '%s\n' 'Refusing non-regular secret target: mfa_encryption_keyring' >&2
    exit 65
  }
  grep -Eq "$keyring_pattern" "$keyring_target" || {
    printf '%s\n' 'Existing MFA encryption keyring has an invalid format' >&2
    exit 65
  }
  chmod 0444 "$keyring_target"
  printf '%s\n' 'kept mfa_encryption_keyring'
else
  legacy_mfa_key=$(cat "$secrets_dir/mfa_encryption_key")
  temporary=$(mktemp "$secrets_dir/.mfa_encryption_keyring.XXXXXX")
  trap 'rm -f "$temporary"' EXIT HUP INT TERM
  printf '{"activeVersion":1,"keys":{"1":"%s"}}\n' "$legacy_mfa_key" > "$temporary"
  unset legacy_mfa_key
  grep -Eq "$keyring_pattern" "$temporary" || {
    printf '%s\n' 'Generated MFA encryption keyring failed validation' >&2
    exit 70
  }
  chmod 0444 "$temporary"
  mv "$temporary" "$keyring_target"
  trap - EXIT HUP INT TERM
  printf '%s\n' 'created mfa_encryption_keyring'
fi

chmod 0700 "$secrets_dir"
printf '%s\n' 'Secret bootstrap complete; values were not printed.'

if [ "$secrets_dir" = /opt/servers/omnireach/shared/secrets ] &&
  [ -f /opt/servers/caddy/Caddyfile ] &&
  [ -f /opt/servers/caddy/compose.yml ]; then
  script_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
  route_installer=$script_root/deploy/configure-coops-site-route.sh
  [ -x "$route_installer" ] || {
    printf '%s\n' 'Coop production route installer is missing or not executable' >&2
    exit 69
  }
  "$route_installer"
  admin_route_installer=$script_root/deploy/configure-coops-admin-route.sh
  [ -x "$admin_route_installer" ] || {
    printf '%s\n' 'Coop customer-admin route installer is missing or not executable' >&2
    exit 69
  }
  "$admin_route_installer"
  public_route_installer=$script_root/deploy/configure-omnireach-public-route.sh
  [ -x "$public_route_installer" ] || {
    printf '%s\n' 'OmniReach public route installer is missing or not executable' >&2
    exit 69
  }
  "$public_route_installer"
fi
