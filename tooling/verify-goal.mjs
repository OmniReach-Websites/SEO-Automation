import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = resolve(root, 'tooling', 'goal-verification.json');

export function validateRegistry(registry) {
  const errors = [];
  for (const [goal, commands] of Object.entries(registry)) {
    if (!/^G\d{2}$/.test(goal)) errors.push(`invalid goal id ${goal}`);
    if (!Array.isArray(commands) || commands.length === 0) {
      errors.push(`${goal} must have at least one command`);
      continue;
    }
    for (const command of commands) {
      if (!Array.isArray(command) || command.length === 0 || command.some((part) => !part)) {
        errors.push(`${goal} has invalid command`);
        continue;
      }
      const rendered = command.join(' ');
      if (/verify:(?:goal|all)|verify-goal\.mjs/.test(rendered)) {
        errors.push(`${goal} cannot recursively invoke the verifier`);
      }
      if (/placeholder|todo|echo\s+(?:ok|pass)/i.test(rendered)) {
        errors.push(`${goal} has placeholder command: ${rendered}`);
      }
    }
  }
  return errors;
}

function emit(record) {
  console.log(JSON.stringify(record));
}

function runGoal(goal, commands) {
  emit({ event: 'goal-start', goal });
  const startedAt = Date.now();
  for (const [index, command] of commands.entries()) {
    const [executable, ...args] = command;
    emit({ args, command: executable, event: 'command-start', goal, index });
    const isNpm = executable === 'npm';
    const npmCli =
      process.env.npm_execpath ??
      resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const result = spawnSync(
      isNpm ? process.execPath : executable,
      isNpm ? [npmCli, ...args] : args,
      {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        stdio: 'inherit',
      },
    );
    const status = result.status ?? 1;
    emit({ event: 'command-end', goal, index, status });
    if (status !== 0) {
      emit({ durationMs: Date.now() - startedAt, event: 'goal-end', goal, status: 'failed' });
      return false;
    }
  }
  emit({ durationMs: Date.now() - startedAt, event: 'goal-end', goal, status: 'passed' });
  return true;
}

export function main(request = process.argv[2]) {
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const registryErrors = validateRegistry(registry);
  if (registryErrors.length > 0) {
    emit({ errors: registryErrors, event: 'registry-invalid', status: 'failed' });
    return 1;
  }

  const goals = request === '--all' ? Object.keys(registry).sort() : [request];
  if (!request || goals.some((goal) => !Object.hasOwn(registry, goal))) {
    emit({
      availableGoals: Object.keys(registry).sort(),
      event: 'request-invalid',
      requested: request ?? null,
      status: 'failed',
    });
    return 1;
  }

  let passed = true;
  for (const goal of goals) {
    if (!runGoal(goal, registry[goal])) {
      passed = false;
      break;
    }
  }
  emit({ event: 'verification-end', goals, status: passed ? 'passed' : 'failed' });
  return passed ? 0 : 1;
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main();
}
