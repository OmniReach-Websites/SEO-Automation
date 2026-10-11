import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function checkWorkspaces(repositoryRoot = root) {
  const errors = [];
  const catalogPath = join(repositoryRoot, 'tooling', 'workspaces.json');
  if (!existsSync(catalogPath)) return { errors: ['missing tooling/workspaces.json'], ok: false };

  const catalog = readJson(catalogPath).workspaces;
  const knownNames = new Set(catalog.map((workspace) => workspace.name));
  if (knownNames.size !== catalog.length) errors.push('workspace names must be unique');

  const rootPackage = readJson(join(repositoryRoot, 'package.json'));
  const expectedGlobs = ['apps/*', 'sites/*', 'workers/*', 'packages/*'];
  if (JSON.stringify(rootPackage.workspaces) !== JSON.stringify(expectedGlobs)) {
    errors.push(`root workspaces must equal ${expectedGlobs.join(', ')}`);
  }

  for (const workspace of catalog) {
    const directory = join(repositoryRoot, workspace.path);
    const packagePath = join(directory, 'package.json');
    const readmePath = join(directory, 'README.md');
    if (!existsSync(packagePath)) {
      errors.push(`${workspace.path} missing package.json`);
      continue;
    }
    if (!existsSync(readmePath)) errors.push(`${workspace.path} missing README.md`);

    const manifest = readJson(packagePath);
    if (manifest.name !== workspace.name)
      errors.push(`${workspace.path} has name ${manifest.name}`);
    if (manifest.private !== true) errors.push(`${workspace.name} must be private`);
    if (manifest.type !== 'module') errors.push(`${workspace.name} must use ESM`);

    const allowed = new Set(workspace.allowedWorkspaceDependencies);
    for (const field of dependencyFields) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (!name.startsWith('@omnireach/')) continue;
        if (!knownNames.has(name))
          errors.push(`${workspace.name} references unknown workspace ${name}`);
        if (!allowed.has(name))
          errors.push(`${workspace.name} is not allowed to depend on ${name}`);
      }
    }

    const implementationFiles = readdirSync(directory).filter(
      (name) => !['README.md', 'package.json'].includes(name),
    );
    const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
    if (implementationFiles.length === 0 && !readme.includes('**Status:** Placeholder (G02)')) {
      errors.push(`${workspace.path} placeholder README must declare its status`);
    }
    if (workspace.kind === 'package' && existsSync(join(directory, 'src', 'index.ts'))) {
      if (!manifest.exports || !manifest.types) {
        errors.push(`${workspace.name} implementation requires explicit exports and types`);
      }
    }
  }

  for (const workspace of catalog) {
    for (const dependency of workspace.allowedWorkspaceDependencies) {
      if (!knownNames.has(dependency)) {
        errors.push(`${workspace.name} allowlist references unknown ${dependency}`);
      }
    }
  }

  return { errors, ok: errors.length === 0, workspaceCount: catalog.length };
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = checkWorkspaces();
  console.log(JSON.stringify({ check: 'workspaces', ...result }));
  process.exitCode = result.ok ? 0 : 1;
}
