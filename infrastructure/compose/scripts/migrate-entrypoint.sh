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

admin_password=$(read_hex_secret postgres_admin_password)
app_password=$(read_hex_secret postgres_app_password)
export DATABASE_URL="postgresql://omnireach_db_admin:${admin_password}@postgres:5432/omnireach"
unset admin_password

npm run db:migrate

PGPASSWORD=$(printf '%s' "$DATABASE_URL" | node -e "process.stdin.once('data', d => process.stdout.write(new URL(d.toString()).password))") \
  psql \
    --host=postgres \
    --username=omnireach_db_admin \
    --dbname=omnireach \
    --set=ON_ERROR_STOP=1 \
    --set=app_password="$app_password" <<'SQL'
SELECT format(
  'CREATE ROLE omnireach_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnireach_runtime')
\gexec

SELECT format(
  'ALTER ROLE omnireach_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'app_password'
)
\gexec

REVOKE ALL ON DATABASE omnireach FROM PUBLIC;
GRANT CONNECT ON DATABASE omnireach TO omnireach_runtime;
GRANT omnireach_app, omnireach_auth, omnireach_platform, omnireach_worker TO omnireach_runtime;
SQL

unset app_password DATABASE_URL PGPASSWORD
printf '%s\n' 'Database migrations and restricted runtime role provisioning completed.'

