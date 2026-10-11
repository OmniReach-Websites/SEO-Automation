import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { validateSiteContract } from '@omnireach/contracts';

import type { SiteBuildDefinition } from './local-builder.ts';

export function discoverSiteBuildDefinitions(
  repositoryRoot: string,
): ReadonlyMap<string, SiteBuildDefinition> {
  const root = realpathSync(resolve(repositoryRoot));
  const sitesRoot = realpathSync(join(root, 'sites'));
  assertWithin(root, sitesRoot);
  const definitions = new Map<string, SiteBuildDefinition>();

  const entries = readdirSync(sitesRoot, { withFileTypes: true }).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = realpathSync(join(sitesRoot, entry.name));
    assertWithin(sitesRoot, directory);
    const manifestPath = join(directory, 'site.manifest.json');
    const packagePath = join(directory, 'package.json');
    if (!lstatSync(manifestPath, { throwIfNoEntry: false })?.isFile()) continue;
    if (!lstatSync(packagePath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Site workspace package is missing: ${entry.name}`);
    }
    const contract = validateSiteContract(JSON.parse(readFileSync(manifestPath, 'utf8')));
    const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<
      string,
      unknown
    >;
    const sourcePath = relative(root, directory).split(sep).join('/');
    if (contract.site.sourcePath !== sourcePath) {
      throw new Error(`Site contract source path does not match its directory: ${entry.name}`);
    }
    if (packageManifest.name !== contract.build.workspace) {
      throw new Error(`Site contract workspace does not match package name: ${entry.name}`);
    }
    const scripts = packageManifest.scripts;
    const dependencies = packageManifest.dependencies;
    if (
      typeof scripts !== 'object' ||
      scripts === null ||
      typeof (scripts as Record<string, unknown>).build !== 'string'
    ) {
      throw new Error(`Site workspace has no build script: ${entry.name}`);
    }
    const astroVersion =
      typeof dependencies === 'object' && dependencies !== null
        ? (dependencies as Record<string, unknown>).astro
        : undefined;
    if (typeof astroVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(astroVersion)) {
      throw new Error(`Site workspace must pin the approved Astro adapter: ${entry.name}`);
    }
    if (definitions.has(sourcePath)) throw new Error(`Duplicate site source path: ${sourcePath}`);
    const previewRoute = contract.routes.find(({ id }) => id === contract.preview.entryRoute);
    if (!previewRoute) throw new Error(`Preview route is missing: ${entry.name}`);
    definitions.set(sourcePath, {
      buildTools: {
        astro: astroVersion,
        node: process.version,
      },
      healthPaths: [previewRoute.path],
      routes: contract.routes.map(({ path }) => path),
      workspace: contract.build.workspace,
    });
  }
  if (definitions.size === 0) throw new Error('No validated site workspaces were discovered');
  return definitions;
}

function assertWithin(parent: string, candidate: string): void {
  const suffix = relative(parent, candidate);
  if (suffix.startsWith('..') || resolve(parent, suffix) !== candidate) {
    throw new Error('Site workspace escapes the repository boundary');
  }
}
