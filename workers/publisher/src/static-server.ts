import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

import { LocalArtifactStore } from './artifacts.ts';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

export async function readActiveStaticFile(input: {
  root: string;
  siteId: string;
  urlPath: string;
}): Promise<{ body: Uint8Array; contentType: string }> {
  const store = new LocalArtifactStore(input.root);
  const artifactHash = await store.activeHash(input.siteId);
  if (!artifactHash) throw new Error('No active artifact');
  return readArtifactStaticFile({ ...input, artifactHash });
}

export async function readArtifactStaticFile(input: {
  artifactHash: string;
  root: string;
  siteId: string;
  urlPath: string;
}): Promise<{ body: Uint8Array; contentType: string }> {
  const store = new LocalArtifactStore(input.root);
  const directory = store.artifactPath(input.siteId, input.artifactHash);
  const decoded = decodeURIComponent(input.urlPath.split('?')[0] ?? '/');
  if (decoded.includes('..') || decoded.includes('\\')) throw new Error('Unsafe static path');
  const relative = decoded.endsWith('/') ? `${decoded.slice(1)}index.html` : decoded.slice(1);
  const file = resolve(directory, relative || 'index.html');
  if (!file.startsWith(`${directory}${sep}`)) throw new Error('Unsafe static path');
  if (!(await stat(file)).isFile()) throw new Error('Static file not found');
  return {
    body: await readFile(file),
    contentType: contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
  };
}
