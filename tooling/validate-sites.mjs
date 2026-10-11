import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateSiteContract } from '../packages/contracts/src/site-contract.ts';

const root = resolve(import.meta.dirname, '..');

export function validateManifestFiles(paths) {
  const results = [];
  for (const path of paths) {
    const absolute = resolve(root, path);
    try {
      const input = JSON.parse(readFileSync(absolute, 'utf8'));
      const contract = validateSiteContract(input);
      results.push({ path, siteId: contract.site.id, status: 'valid', version: contract.version });
    } catch (error) {
      results.push({
        errors: error instanceof Error ? [error.message] : ['unknown validation error'],
        path,
        status: 'invalid',
      });
    }
  }
  return results;
}

function defaultPaths() {
  const sites = resolve(root, 'sites');
  if (!existsSync(sites)) return [];
  return readdirSync(sites, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => `sites/${name}/site.manifest.json`)
    .filter((path) => existsSync(resolve(root, path)))
    .sort();
}

const paths = process.argv.slice(2);
const results = validateManifestFiles(paths.length > 0 ? paths : defaultPaths());
const ok = results.length > 0 && results.every(({ status }) => status === 'valid');
console.log(JSON.stringify({ check: 'site-contracts', ok, results }));
process.exitCode = ok ? 0 : 1;
