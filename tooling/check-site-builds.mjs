import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sitePaths = ['sites/_starter', 'sites/restaurant-example', 'sites/custom-portfolio-example'];

function filesRecursively(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(path) : [path];
  });
}

export function checkSiteBuilds() {
  const errors = [];
  const indexes = [];
  for (const sitePath of sitePaths) {
    const directory = resolve(root, sitePath);
    const manifest = JSON.parse(readFileSync(resolve(directory, 'site.manifest.json'), 'utf8'));
    const output = resolve(directory, manifest.build.outputDirectory);
    if (!existsSync(output)) {
      errors.push(`${sitePath}: missing build output`);
      continue;
    }
    for (const route of manifest.routes) {
      const relative =
        route.path === '/' ? 'index.html' : `${route.path.replace(/^\//u, '')}index.html`;
      if (!existsSync(resolve(output, relative)))
        errors.push(`${sitePath}: missing route output ${route.path}`);
    }
    for (const file of filesRecursively(output).filter((path) => path.endsWith('.html'))) {
      const html = readFileSync(file, 'utf8');
      if (!/<html\s[^>]*lang=/iu.test(html))
        errors.push(`${sitePath}: missing document language in ${file}`);
      if (!/<meta\s[^>]*name=["']viewport["']/iu.test(html))
        errors.push(`${sitePath}: missing viewport metadata in ${file}`);
      if (!/<title>\s*[^<]+\s*<\/title>/iu.test(html))
        errors.push(`${sitePath}: missing nonempty title in ${file}`);
      if (!/<h1[\s>]/iu.test(html)) errors.push(`${sitePath}: missing h1 in ${file}`);
      if (!/<main[\s>]/iu.test(html)) errors.push(`${sitePath}: missing main landmark in ${file}`);
      const ids = [...html.matchAll(/\sid=["']([^"']+)["']/giu)].map((match) => match[1]);
      if (new Set(ids).size !== ids.length)
        errors.push(`${sitePath}: duplicate element id in ${file}`);
      for (const image of html.matchAll(/<img\b[^>]*>/giu)) {
        if (!/\salt=["'][^"']*["']/iu.test(image[0]))
          errors.push(`${sitePath}: image missing alt attribute in ${file}`);
      }
      if (/\stabindex=["'](?:[1-9]\d*)["']/iu.test(html))
        errors.push(`${sitePath}: positive tabindex is forbidden in ${file}`);
      if (/\sautofocus(?:\s|>|=)/iu.test(html))
        errors.push(`${sitePath}: autofocus is forbidden in ${file}`);
      for (const control of html.matchAll(
        /<(?:input|textarea|select)\b[^>]*\sid=["']([^"']+)["'][^>]*>/giu,
      )) {
        const id = control[1];
        if (id && !new RegExp(`<label\\b[^>]*for=["']${escapeRegExp(id)}["']`, 'iu').test(html))
          errors.push(`${sitePath}: control ${id} lacks an explicit label in ${file}`);
      }
      const allowedExternalUrls = new Set([
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
        'https://schema.org',
      ]);
      const externalUrls = [...html.matchAll(/https:\/\/[^\s"'`<>]+/giu)].map((match) => match[0]);
      for (const url of externalUrls) {
        if (!allowedExternalUrls.has(url)) {
          errors.push(`${sitePath}: unapproved external URL ${url} in ${file}`);
        }
      }
      const fictionalDomainSurface = externalUrls.reduce(
        (surface, url) => surface.replaceAll(url, ''),
        html,
      );
      if (/(?:localhost|\.com\b|\.net\b)/iu.test(fictionalDomainSurface))
        errors.push(`${sitePath}: non-fictional public domain found in ${file}`);
      for (const match of html.matchAll(/href=["'](\/[^"'#?]*)["']/giu)) {
        const href = match[1];
        if (!href) continue;
        const target = href.endsWith('/')
          ? resolve(output, href.slice(1), 'index.html')
          : resolve(output, href.slice(1));
        if (!existsSync(target) || !statSync(target).isFile())
          errors.push(`${sitePath}: broken internal link ${href} in ${file}`);
      }
    }
    indexes.push(readFileSync(resolve(output, 'index.html'), 'utf8'));
  }
  if (new Set(indexes).size !== indexes.length)
    errors.push('custom fixtures must produce materially distinct homepages');
  const starter = resolve(root, 'sites/_starter/dist');
  if (existsSync(starter)) {
    for (const path of ['robots.txt', 'sitemap.xml']) {
      if (!existsSync(resolve(starter, path))) errors.push(`starter missing ${path}`);
    }
    const home = readFileSync(resolve(starter, 'index.html'), 'utf8');
    const jsonLd = /<script type="application\/ld\+json">([^<]+)<\/script>/u.exec(home)?.[1];
    if (!jsonLd) errors.push('starter missing structured data');
    else {
      try {
        JSON.parse(jsonLd);
      } catch {
        errors.push('starter structured data is invalid JSON');
      }
    }
  }
  return { errors, ok: errors.length === 0, sites: sitePaths.length };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const result = checkSiteBuilds();
console.log(JSON.stringify({ check: 'site-builds', ...result }));
process.exitCode = result.ok ? 0 : 1;
