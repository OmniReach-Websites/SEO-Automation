import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const backupRoot = resolve(root, 'infrastructure/backups');
const files = {
  container: resolve(backupRoot, 'run-production-backup.sh'),
  host: resolve(backupRoot, 'run-host-backup.sh'),
  restoreHost: resolve(backupRoot, 'run-host-restore-drill.sh'),
  installer: resolve(backupRoot, 'install-backup-service.sh'),
  service: resolve(backupRoot, 'omnireach-backup.service'),
  timer: resolve(backupRoot, 'omnireach-backup.timer'),
  failureService: resolve(backupRoot, 'omnireach-backup-failure.service'),
  restoreService: resolve(backupRoot, 'omnireach-restore-drill.service'),
  restoreTimer: resolve(backupRoot, 'omnireach-restore-drill.timer'),
  provisioner: resolve(root, 'tooling/configure-r2-backup.ps1'),
};

const source = Object.fromEntries(
  Object.entries(files).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);
const errors = [];

for (const [name, value] of Object.entries(source)) {
  if (/set\s+-x/u.test(value)) errors.push(`${name} enables command tracing`);
  if (/R2_SECRET_ACCESS_KEY=[A-Za-z0-9]/u.test(value)) {
    errors.push(`${name} contains a literal R2 secret`);
  }
}

for (const expected of [
  'BACKUP_OFFSITE_ENABLED',
  '--offsite',
  '--offsite-key',
  '--automated-retention',
  '--daily 3',
  '--weekly 1',
  '--record-database-url-file',
  '/var/lib/omnireach/assets',
  '/var/lib/omnireach/publications',
  'restore-to-disposable',
  'restore-postgres',
  '.endsWith(".orbk")',
  'policyCount',
]) {
  if (!source.container.includes(expected)) {
    errors.push(`container runner is missing ${expected}`);
  }
}

for (const expected of [
  'restore-postgres',
  'compose rm --force --stop restore-postgres',
  'flock -n 9',
  'CREATE ROLE omnireach_app NOLOGIN',
]) {
  if (!source.restoreHost.includes(expected)) {
    errors.push(`restore host runner is missing ${expected}`);
  }
}
if (!source.container.includes('unset admin_password worker_password')) {
  errors.push('container runner does not promptly clear database password shell variables');
}

for (const expected of [
  'readlink -f "$current_link"',
  'flock -n 9',
  '--no-deps backup',
  'OMNIREACH_BACKUP_ROOT',
]) {
  if (!source.host.includes(expected)) errors.push(`host runner is missing ${expected}`);
}

for (const expected of [
  'credential input permissions must be 0600 or 0400',
  'openssl rand -hex 32',
  'BACKUP_OFFSITE_ENABLED=true',
  'systemd-analyze verify',
  'systemctl enable --now omnireach-backup.timer',
  'BACKUP_R2_MAX_TOTAL_BYTES=8589934592',
  'BACKUP_R2_MAX_REQUESTS=50',
  '--run-restore',
]) {
  if (!source.installer.includes(expected)) errors.push(`installer is missing ${expected}`);
}
if (!source.service.includes('OnFailure=omnireach-backup-failure.service')) {
  errors.push('backup systemd service does not activate the fixed failure-alert handler');
}
if (!source.failureService.includes('run-host-backup.sh record-failure')) {
  errors.push('backup failure service does not record the ORAP alert');
}
if (!source.restoreService.includes('run-host-restore-drill.sh')) {
  errors.push('restore service does not use the isolated host runner');
}
if (!source.restoreTimer.includes('OnCalendar=Sun *-*-01..07 03:15:00 America/Chicago')) {
  errors.push('restore timer is not scheduled monthly in the approved maintenance window');
}
if (!source.provisioner.includes('--run-restore')) {
  errors.push('PowerShell provisioner does not request the first isolated restore drill');
}
if (!source.provisioner.includes('.Replace("`r`n", "`n").Replace("`r", "`n")')) {
  errors.push('PowerShell provisioner does not normalize the remote shell payload to LF');
}
if (!source.provisioner.includes("tr -d '\\r'")) {
  errors.push('PowerShell provisioner does not strip transport carriage returns from credentials');
}
for (const forbidden of [
  'printf \'%s\\n\' "$r2_secret_access_key"',
  'echo "$r2_secret_access_key"',
]) {
  if (source.installer.includes(forbidden)) errors.push('installer may print the R2 secret');
}

for (const expected of [
  'ProtectSystem=strict',
  'ReadWritePaths=/opt/backups/omnireach /run/lock',
  'NoNewPrivileges=true',
]) {
  if (!source.service.includes(expected)) errors.push(`systemd service is missing ${expected}`);
}
for (const expected of [
  'OnCalendar=*-*-* 02:30:00 America/Chicago',
  'Persistent=true',
  'RandomizedDelaySec=15m',
]) {
  if (!source.timer.includes(expected)) errors.push(`systemd timer is missing ${expected}`);
}
if (
  !source.provisioner.includes(
    "@('R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY')",
  )
) {
  errors.push('PowerShell provisioner does not limit transfer to the four required R2 settings');
}
if (!source.provisioner.includes('StrictHostKeyChecking=yes')) {
  errors.push('PowerShell provisioner does not require a pinned known host');
}

const indexed = execFileSync(
  'git',
  [
    'ls-files',
    '--stage',
    'infrastructure/backups/run-production-backup.sh',
    'infrastructure/backups/run-host-backup.sh',
    'infrastructure/backups/install-backup-service.sh',
    'infrastructure/backups/run-host-restore-drill.sh',
  ],
  { cwd: root, encoding: 'utf8' },
);
for (const path of [
  'infrastructure/backups/run-production-backup.sh',
  'infrastructure/backups/run-host-backup.sh',
  'infrastructure/backups/install-backup-service.sh',
  'infrastructure/backups/run-host-restore-drill.sh',
]) {
  const line = indexed.split(/\r?\n/u).find((entry) => entry.endsWith(`\t${path}`));
  if (!line?.startsWith('100755 ')) errors.push(`${path} must be executable in Git`);
}

console.log(JSON.stringify({ check: 'backup-service', errors, ok: errors.length === 0 }));
process.exitCode = errors.length === 0 ? 0 : 1;
