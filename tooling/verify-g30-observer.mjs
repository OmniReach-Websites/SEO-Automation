import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('./vps-g30-observation.sh', import.meta.url), 'utf8');
const required = [
  'docker stats --all --no-stream',
  'docker ps --format',
  'free -m',
  'df -P -h',
  '--output /dev/null',
  'OMNIREACH_OBSERVE_MINUTES',
  'EXISTING_PUBLIC_URL',
];
const forbidden = [
  'docker restart',
  'docker stop',
  'docker rm',
  'docker compose up',
  'docker compose down',
  'systemctl restart',
  'systemctl stop',
  'caddy reload',
  'printenv',
  'docker logs',
  'docker inspect',
  'cat /etc/',
];
const missing = required.filter((value) => !script.includes(value));
const unsafe = forbidden.filter((value) => script.includes(value));
if (missing.length > 0 || unsafe.length > 0) {
  throw new Error(JSON.stringify({ check: 'g30-observer', missing, unsafe }));
}
console.log(JSON.stringify({ check: 'g30-observer', ok: true, readOnly: true }));
