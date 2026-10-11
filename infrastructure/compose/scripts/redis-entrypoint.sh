#!/bin/sh
set -eu

secret=/run/secrets/redis_app_password
[ -r "$secret" ] || { printf '%s\n' 'Redis application secret is not readable' >&2; exit 78; }
password=$(cat "$secret")
case "$password" in
  *[!a-f0-9]*|'') printf '%s\n' 'Redis application secret has an invalid format' >&2; exit 78 ;;
esac
[ "${#password}" -eq 64 ] || { printf '%s\n' 'Redis application secret has an invalid length' >&2; exit 78; }

install -d -o redis -g redis -m 0700 /run/omnireach-redis
temporary=$(mktemp /run/omnireach-redis/.users.acl.XXXXXX)
trap 'rm -f "$temporary"' EXIT HUP INT TERM
{
  printf '%s\n' 'user default off'
  printf 'user omnireach_runtime on >%s ~* &* +@all -acl -bgrewriteaof -bgsave -config -debug -flushall -flushdb -module -replicaof -save -shutdown -slaveof\n' "$password"
} > "$temporary"
chown redis:redis "$temporary"
chmod 0400 "$temporary"
mv "$temporary" /run/omnireach-redis/users.acl
trap - EXIT HUP INT TERM
unset password

exec docker-entrypoint.sh redis-server \
  --appendonly yes \
  --appendfsync everysec \
  --save 60 1 \
  --aclfile /run/omnireach-redis/users.acl
