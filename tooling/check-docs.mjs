import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const requiredFiles = [
  'docs/architecture.md',
  'docs/security.md',
  'docs/operations.md',
  'docs/integration-contract.md',
  'docs/adr/README.md',
];

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.md') ? [fullPath] : [];
  });
}

export function checkDocs(repositoryRoot = root) {
  const errors = [];
  for (const relativePath of requiredFiles) {
    if (!existsSync(join(repositoryRoot, relativePath))) errors.push(`missing ${relativePath}`);
  }

  const adrDirectory = join(repositoryRoot, 'docs', 'adr');
  const adrFiles = existsSync(adrDirectory)
    ? readdirSync(adrDirectory).filter((name) => /^\d{4}-.+\.md$/.test(name))
    : [];
  if (adrFiles.length < 8) errors.push(`expected at least 8 ADRs, found ${adrFiles.length}`);

  const adrIndexPath = join(adrDirectory, 'README.md');
  if (existsSync(adrIndexPath)) {
    const index = readFileSync(adrIndexPath, 'utf8');
    for (let number = 1; number <= 24; number += 1) {
      const id = `D-${String(number).padStart(3, '0')}`;
      const row = index.split('\n').find((line) => line.startsWith(`| ${id} |`));
      if (!row) {
        errors.push(`ADR index missing ${id}`);
        continue;
      }
      const cells = row
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean);
      if (cells.length !== 6 || !cells[1].startsWith('Approved') || !cells[2] || !cells[4]) {
        errors.push(`ADR index has incomplete disposition/owner/targets for ${id}`);
      }
    }
  }

  const architecturePath = join(repositoryRoot, 'docs', 'architecture.md');
  if (existsSync(architecturePath)) {
    const architecture = readFileSync(architecturePath, 'utf8');
    for (let number = 1; number <= 18; number += 1) {
      if (!new RegExp(`^\\| ${number}\\.`, 'm').test(architecture)) {
        errors.push(`architecture missing invariant ${number}`);
      }
    }
    for (const letter of 'ABCDEFGHIJKL') {
      if (!new RegExp(`^\\| ${letter}\\.`, 'm').test(architecture)) {
        errors.push(`architecture missing acceptance scenario ${letter}`);
      }
    }
  }

  const docsRoot = join(repositoryRoot, 'docs');
  if (existsSync(docsRoot)) {
    const markdownLink = /(?<!!)\[[^\]]+\]\((?<target>[^)]+)\)/g;
    for (const file of markdownFiles(docsRoot)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(markdownLink)) {
        const target = match.groups?.target?.trim();
        if (!target || /^(?:https?:\/\/|mailto:|#)/.test(target)) continue;
        const pathPart = target.split('#')[0];
        if (pathPart && !existsSync(resolve(dirname(file), pathPart))) {
          errors.push(`${file.slice(repositoryRoot.length + 1)} has broken link ${target}`);
        }
      }
    }
  }

  return {
    adrCount: adrFiles.length,
    errors,
    ok: errors.length === 0,
  };
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = checkDocs();
  console.log(JSON.stringify({ check: 'docs', ...result }));
  process.exitCode = result.ok ? 0 : 1;
}
