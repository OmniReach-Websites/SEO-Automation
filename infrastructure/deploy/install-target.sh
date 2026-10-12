#!/bin/sh
set -eu

deploy_root=/opt/servers/omnireach
source_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

fail() {
  printf 'install-target: %s\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail 'run this installer as root'
id omnireach-deploy >/dev/null 2>&1 || fail 'the omnireach-deploy account does not exist'

install -d -m 0755 -o root -g root "$deploy_root"
install -d -m 0750 -o omnireach-deploy -g omnireach-deploy "$deploy_root/incoming"
install -d -m 0750 -o root -g root "$deploy_root/releases"
install -d -m 0750 -o root -g root "$deploy_root/shared" "$deploy_root/shared/config"
install -d -m 0700 -o root -g root "$deploy_root/shared/secrets"
install -d -m 0755 -o root -g root /usr/local/libexec

install -m 0755 -o root -g root "$source_root/target-release.sh" /usr/local/sbin/omnireach-release-root
install -m 0755 -o root -g root "$source_root/validate-release-metadata.sh" \
  /usr/local/libexec/omnireach-validate-release-metadata
cat >/usr/local/bin/omnireach-release <<'EOF'
#!/bin/sh
exec sudo -n /usr/local/sbin/omnireach-release-root "$@"
EOF
chown root:root /usr/local/bin/omnireach-release
chmod 0755 /usr/local/bin/omnireach-release

cat >/etc/sudoers.d/omnireach-release <<'EOF'
omnireach-deploy ALL=(root) NOPASSWD: /usr/local/sbin/omnireach-release-root *
EOF
chown root:root /etc/sudoers.d/omnireach-release
chmod 0440 /etc/sudoers.d/omnireach-release
visudo -cf /etc/sudoers.d/omnireach-release >/dev/null

if [ ! -f "$deploy_root/shared/config/production.env" ]; then
  install -m 0640 -o root -g root "$source_root/../compose/production.env.example" \
    "$deploy_root/shared/config/production.env"
fi

"$source_root/../compose/scripts/bootstrap-secrets.sh" \
  --secrets-dir "$deploy_root/shared/secrets"

printf 'install-target: restricted deployment bootstrap installed\n'
