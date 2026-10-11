#!/bin/sh
# R-003 read-only inventory collector. Run as a user that can read the named paths and
# Docker metadata. It performs no writes, service control, container exec, log reads,
# environment inspection, database access, or secret/private-key reads.
set -u

section() { printf '\n===== %s =====\n' "$1"; }
safe() { "$@" 2>&1 || printf '[unavailable: %s]\n' "$*"; }

section "collection scope"
printf 'collected_utc='; safe date -u +%Y-%m-%dT%H:%M:%SZ
printf 'hostname='; safe hostname
printf 'authorized_paths=/opt/servers/caddy /opt/servers/christiansreunite /opt/servers/omnireach\n'

section "operating system and uptime"
safe uname -a
safe sh -c "grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release"
safe uptime

section "capacity and headroom"
safe sh -c "lscpu | grep -E '^(CPU\\(s\\)|Model name|Thread|Core|Socket)'"
safe free -h
safe df -hT / /opt
safe df -i / /opt

section "Docker versions and aggregate storage"
safe docker version --format 'client={{.Client.Version}} server={{.Server.Version}}'
safe docker compose version
safe docker info --format 'driver={{.Driver}} root={{.DockerRootDir}} cpus={{.NCPU}} memory={{.MemTotal}} cgroup={{.CgroupVersion}}'
safe docker system df

section "Compose projects and containers"
safe docker compose ls --all
safe docker ps --all --no-trunc --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
safe docker stats --all --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}\t{{.BlockIO}}'

section "container runtime policy (no env, labels, logs, or command arguments)"
docker ps --all --quiet 2>/dev/null | while IFS= read -r container_id; do
  [ -n "$container_id" ] || continue
  safe docker inspect --format 'name={{.Name}} image={{.Config.Image}} state={{.State.Status}} health={{with index .State "Health"}}{{.Status}}{{else}}none{{end}} restart={{.HostConfig.RestartPolicy.Name}} network={{.HostConfig.NetworkMode}} memory={{.HostConfig.Memory}} nano_cpus={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}} readonly_root={{.HostConfig.ReadonlyRootfs}} privileged={{.HostConfig.Privileged}} security_opt={{json .HostConfig.SecurityOpt}} mounts={{range .Mounts}}{{.Type}}:{{.Destination}}:rw={{.RW}};{{end}}' "$container_id"
done

section "Docker networks and volumes (names/drivers only)"
safe docker network ls --format 'table {{.Name}}\t{{.Driver}}\t{{.Scope}}\t{{.Internal}}'
safe docker volume ls --format 'table {{.Name}}\t{{.Driver}}'

section "listening sockets and firewall summary"
safe ss -lntup
if command -v ufw >/dev/null 2>&1; then safe ufw status verbose; fi

section "authorized deployment path metadata"
for root in /opt/servers/caddy /opt/servers/christiansreunite /opt/servers/omnireach; do
  printf '\n-- %s --\n' "$root"
  safe stat --format='path=%n type=%F owner=%U group=%G mode=%a size=%s modified=%y' "$root"
  safe du -sh "$root"
  safe find "$root" -maxdepth 3 -xdev -type f \
    ! -iname '*.env' ! -iname '.env*' ! -iname '*secret*' ! -iname '*credential*' \
    ! -iname '*.key' ! -iname '*.pem' ! -iname '*id_rsa*' ! -iname '*id_ed25519*' \
    -printf '%M %u:%g %s %TY-%Tm-%TdT%TH:%TM %p\n'
done

section "sanitized Compose and Caddy configuration structure"
python3 - <<'PY'
from pathlib import Path
import re

roots = [Path('/opt/servers/caddy'), Path('/opt/servers/christiansreunite'), Path('/opt/servers/omnireach')]
names = {'Caddyfile', 'compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml'}
sensitive = re.compile(r'(?i)(password|passwd|requirepass|secret|token|credential|private.?key|api.?key|authorization|cookie|dsn|database_url|redis_url|basicauth)')
for root in roots:
    if not root.is_dir():
        continue
    for path in sorted(p for p in root.rglob('*') if p.is_file() and (p.name in names or p.suffix == '.caddy')):
        try:
            if path.stat().st_size > 1_000_000:
                print(f'--- {path} [skipped: over 1 MB] ---')
                continue
            print(f'--- {path} ---')
            for number, line in enumerate(path.read_text(errors='replace').splitlines(), 1):
                stripped = line.strip()
                if not stripped or stripped.startswith('#'):
                    continue
                print(f'{number}: [REDACTED SENSITIVE DIRECTIVE]' if sensitive.search(line) else f'{number}: {line}')
        except (OSError, UnicodeError) as error:
            print(f'--- {path} [unavailable: {type(error).__name__}] ---')
PY

section "SSH policy (never authorized keys or private keys)"
safe sh -c "grep -RhiE '^[[:space:]]*(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|AllowUsers|AllowGroups|MaxAuthTries|ClientAliveInterval|ClientAliveCountMax)[[:space:]]' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null"
if command -v sshd >/dev/null 2>&1; then
  safe sh -c "sshd -T 2>/dev/null | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries|clientaliveinterval|clientalivecountmax|allowusers|allowgroups) '"
elif [ -x /usr/sbin/sshd ]; then
  safe sh -c "/usr/sbin/sshd -T 2>/dev/null | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries|clientaliveinterval|clientalivecountmax|allowusers|allowgroups) '"
fi

section "timers and running service metadata"
safe systemctl list-timers --all --no-pager
safe systemctl list-units --type=service --state=running --no-pager

section "sanitization reminder"
printf '%s\n' 'Review before returning. Remove public IPs, email addresses, customer/domain names, internal hostnames, account names, and any unexpected sensitive value. Do not return env files, logs, database output, keys, tokens, or passwords.'
