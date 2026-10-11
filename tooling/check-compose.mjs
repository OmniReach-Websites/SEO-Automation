import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'yaml';

export function checkCompose() {
  const compose = parse(
    readFileSync(resolve(import.meta.dirname, '../infrastructure/compose/dev.compose.yml'), 'utf8'),
  );
  const errors = [];
  if (compose.name !== 'omnireach-seo-automation-dev')
    errors.push('unexpected Compose project name');
  for (const service of ['postgres', 'redis']) {
    const definition = compose.services?.[service];
    if (!definition?.image?.includes('@sha256:'))
      errors.push(`${service} image is not digest-pinned`);
    if (!definition?.healthcheck) errors.push(`${service} is missing a health check`);
    if (!definition?.cpus || !definition?.mem_limit || !definition?.pids_limit)
      errors.push(`${service} is missing explicit CPU, memory, or PID limits`);
    if (!(definition?.security_opt ?? []).includes('no-new-privileges:true'))
      errors.push(`${service} does not prohibit privilege escalation`);
    if (definition?.privileged === true) errors.push(`${service} must not be privileged`);
    for (const port of definition?.ports ?? []) {
      if (!String(port).startsWith('127.0.0.1:'))
        errors.push(`${service} port is not loopback-only`);
    }
  }
  if (JSON.stringify(compose).toLowerCase().includes('caddy'))
    errors.push('development Compose must not configure Caddy');
  return { errors, ok: errors.length === 0 };
}

const result = checkCompose();
console.log(JSON.stringify({ check: 'compose', ...result }));
process.exitCode = result.ok ? 0 : 1;
