import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const secretRules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['openai-key', new RegExp(['s', 'k'].join('') + '-(?:proj-)?[A-Za-z0-9_-]{20,}', 'g')],
  ['github-token', /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ['aws-access-key', /AKIA[0-9A-Z]{16}/g],
  ['google-api-key', /AIza[0-9A-Za-z_-]{20,}/g],
  ['slack-token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
];

function runGit(args, repositoryRoot) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function scanText(text, source) {
  const findings = [];
  for (const [rule, expression] of secretRules) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      findings.push({ offset: match.index, rule, source });
    }
  }
  return findings;
}

export function isForbiddenPath(path, policy) {
  const normalized = path.replaceAll('\\', '/');
  if (policy.allowedSensitivePaths.includes(normalized)) return false;
  return policy.forbiddenPathPatterns.some((pattern) => new RegExp(pattern, 'i').test(normalized));
}

export function scanRepository(repositoryRoot = root, scope = 'full') {
  const policy = JSON.parse(
    readFileSync(resolve(repositoryRoot, 'tooling', 'repository-policy.json'), 'utf8'),
  );
  const findings = [];
  const listed = runGit(['ls-files', '--cached', '--others', '--exclude-standard'], repositoryRoot)
    .split(/\r?\n/)
    .filter(Boolean);

  for (const path of listed) {
    if (isForbiddenPath(path, policy)) {
      findings.push({ rule: 'forbidden-path', source: path });
      continue;
    }
    const fullPath = resolve(repositoryRoot, path);
    if (!existsSync(fullPath) || statSync(fullPath).size > policy.maxScannedFileBytes) continue;
    const content = readFileSync(fullPath);
    if (content.includes(0)) continue;
    findings.push(...scanText(content.toString('utf8'), path));
  }

  if (scope === 'full') {
    const historyPaths = runGit(
      ['log', '--all', '--name-only', '--format=', '--no-renames'],
      repositoryRoot,
    )
      .split(/\r?\n/)
      .filter(Boolean);
    for (const path of historyPaths) {
      if (isForbiddenPath(path, policy))
        findings.push({ rule: 'history-forbidden-path', source: path });
    }
    const historyPatch = runGit(
      ['log', '--all', '--format=commit:%H', '--no-ext-diff', '--no-renames', '-p'],
      repositoryRoot,
    );
    findings.push(...scanText(historyPatch, 'git-history'));
  }

  return { filesScanned: listed.length, findings, ok: findings.length === 0, scope };
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const scopeIndex = process.argv.indexOf('--scope');
  const scope = scopeIndex >= 0 ? process.argv[scopeIndex + 1] : 'working-tree';
  if (!['working-tree', 'full'].includes(scope)) throw new Error(`unsupported scope: ${scope}`);
  const result = scanRepository(root, scope);
  console.log(JSON.stringify({ check: 'secrets', ...result }));
  process.exitCode = result.ok ? 0 : 1;
}
