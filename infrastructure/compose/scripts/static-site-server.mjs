import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve(
  process.env.STATIC_SITE_ROOT || '/opt/omnireach/sites/coops-mobile-detailing/dist',
);
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

async function resolveFile(pathname) {
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
    const file = await resolveFile(pathname);
    if (file) {
      await sendFile(request, response, file, pathname);
      return;
    }

    const notFound = await resolveFile('/404.html');
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
  console.log(`static-site-server listening on ${host}:${port} with root ${root}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
