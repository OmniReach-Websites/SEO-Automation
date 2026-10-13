import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const fallbackRoot = resolve(
  process.env.STATIC_SITE_ROOT || '/opt/omnireach/sites/coops-mobile-detailing/dist',
);
const publicationRoot = process.env.STATIC_SITE_PUBLICATION_ROOT
  ? resolve(process.env.STATIC_SITE_PUBLICATION_ROOT)
  : undefined;
const publicationSiteId = (
  process.env.STATIC_SITE_PUBLICATION_SITE_ID || process.env.COOPS_SITE_ID
)?.trim();
const host = process.env.STATIC_SITE_HOST || '0.0.0.0';
const port = Number.parseInt(process.env.STATIC_SITE_PORT || '8080', 10);

const contentTypes = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

function cacheControl(pathname) {
  if (pathname.startsWith('/_astro/')) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/images/'))
    return 'public, max-age=604800, stale-while-revalidate=86400';
  if (pathname.endsWith('.html') || pathname === '/') return 'public, max-age=300, must-revalidate';
  return 'public, max-age=3600';
}

async function activeRoot() {
  if (!publicationRoot || !publicationSiteId) return fallbackRoot;
  if (!/^[a-zA-Z0-9_-]{3,100}$/u.test(publicationSiteId)) {
    throw new Error('STATIC_SITE_PUBLICATION_SITE_ID is invalid');
  }
  try {
    const pointerPath = resolve(publicationRoot, publicationSiteId, 'active.json');
    const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
    if (
      !pointer ||
      typeof pointer.artifactHash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(pointer.artifactHash)
    ) {
      throw new Error('Active artifact pointer is invalid');
    }
    const candidate = resolve(publicationRoot, publicationSiteId, 'versions', pointer.artifactHash);
    if (!(await stat(candidate)).isDirectory()) throw new Error('Active artifact is unavailable');
    return candidate;
  } catch (error) {
    if (error?.code !== 'ENOENT')
      console.error('active publication unavailable; using baked fallback', error);
    return fallbackRoot;
  }
}

async function resolveFile(pathname, root) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^\/+/, '');
  const candidate = resolve(root, relative || 'index.html');
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return undefined;

  try {
    const metadata = await stat(candidate);
    if (metadata.isDirectory()) {
      const index = resolve(candidate, 'index.html');
      const indexMetadata = await stat(index);
      return indexMetadata.isFile() ? { metadata: indexMetadata, path: index } : undefined;
    }
    return metadata.isFile() ? { metadata, path: candidate } : undefined;
  } catch {
    if (!extname(candidate)) {
      try {
        const index = resolve(candidate, 'index.html');
        const metadata = await stat(index);
        return metadata.isFile() ? { metadata, path: index } : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

async function sendFile(request, response, file, pathname, status = 200) {
  const etag = `W/"${file.metadata.size.toString(16)}-${Math.trunc(file.metadata.mtimeMs).toString(16)}"`;
  response.setHeader('Cache-Control', cacheControl(pathname));
  response.setHeader('Content-Length', file.metadata.size);
  response.setHeader(
    'Content-Type',
    contentTypes.get(extname(file.path).toLowerCase()) || 'application/octet-stream',
  );
  response.setHeader('ETag', etag);
  response.setHeader('Last-Modified', file.metadata.mtime.toUTCString());
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304);
    response.end();
    return;
  }

  response.writeHead(status);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file.path).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method Not Allowed');
      return;
    }

    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    const root = await activeRoot();
    const file = await resolveFile(pathname, root);
    if (file) {
      await sendFile(request, response, file, pathname);
      return;
    }

    const notFound = await resolveFile('/404.html', root);
    if (notFound) {
      await sendFile(request, response, notFound, '/404.html', 404);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  } catch (error) {
    console.error('static-site-server request failed', error);
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.log(`static-site-server listening on ${host}:${port} with fallback root ${fallbackRoot}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
