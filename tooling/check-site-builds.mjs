import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sitePaths = [
  'sites/_starter',
  'sites/restaurant-example',
  'sites/custom-portfolio-example',
  'sites/coops-mobile-detailing',
  'sites/omnireach',
];

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
    if (sitePath === 'sites/omnireach') {
      const brandAsset = resolve(directory, 'public/omnireach-logo.png');
      const stylesheet = readFileSync(resolve(directory, 'src/styles/global.css'), 'utf8');
      if (!existsSync(brandAsset)) errors.push(`${sitePath}: missing approved logo asset`);
      for (const color of ['#336699', '#86bbd8', '#2f4858', '#9ee493', '#daf7dc']) {
        if (!stylesheet.toLowerCase().includes(color)) {
          errors.push(`${sitePath}: brand palette is missing ${color}`);
        }
      }
      if (!stylesheet.includes('color-scheme: dark')) {
        errors.push(`${sitePath}: dark color scheme declaration is missing`);
      }
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
      if (sitePath === 'sites/omnireach') {
        if (!html.includes('<meta name="theme-color" content="#0b1820">')) {
          errors.push(`${sitePath}: dark browser theme color is missing in ${file}`);
        }
        const logoUses = html.match(/src="\/omnireach-logo\.png"/gu)?.length ?? 0;
        if (logoUses !== 2) {
          errors.push(`${sitePath}: expected header and footer logo in ${file}`);
        }
        const googleTagLoader = 'https://www.googletagmanager.com/gtag/js?id=G-5H7ZB5HMLC';
        const googleTagUses =
          html.match(/https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-5H7ZB5HMLC/gu)?.length ??
          0;
        if (googleTagUses !== 1 || !html.includes(`async src="${googleTagLoader}"`)) {
          errors.push(`${sitePath}: expected exactly one asynchronous Google tag in ${file}`);
        }
        if (!html.includes("gtag('config', 'G-5H7ZB5HMLC');")) {
          errors.push(`${sitePath}: Google tag configuration is missing in ${file}`);
        }
        if (!/^<!DOCTYPE html><html lang="en"><head><!-- Google tag \(gtag\.js\) -->/u.test(html)) {
          errors.push(`${sitePath}: Google tag must be the first content in head in ${file}`);
        }
      }
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
      if (sitePath === 'sites/omnireach') {
        const executableInlineScripts = [
          ...html.matchAll(
            /<script\b(?![^>]*\bsrc=)(?![^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/giu,
          ),
        ];
        const approvedGoogleTagHash = '1f6APo4rT+WRM24XLR07SyqI6L+qzt9T5/P7a6H1lIU=';
        const inlineScriptHash = executableInlineScripts[0]?.[1]
          ? createHash('sha256').update(executableInlineScripts[0][1]).digest('base64')
          : '';
        if (executableInlineScripts.length !== 1 || inlineScriptHash !== approvedGoogleTagHash) {
          errors.push(`${sitePath}: unapproved executable inline script in ${file}`);
        }
      }
      for (const control of html.matchAll(
        /<(?:input|textarea|select)\b[^>]*\sid=["']([^"']+)["'][^>]*>/giu,
      )) {
        const id = control[1];
        if (id && !new RegExp(`<label\\b[^>]*for=["']${escapeRegExp(id)}["']`, 'iu').test(html))
          errors.push(`${sitePath}: control ${id} lacks an explicit label in ${file}`);
      }
      const allowedExternalUrls = new Set([
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
        'https://coopsmobiledetailingaledo.com',
        'https://coopsmobiledetailingaledo.com/',
        'https://coopsmobiledetailingaledo.com/about/',
        'https://coopsmobiledetailingaledo.com/contact/',
        'https://coopsmobiledetailingaledo.com/images/social-card.webp',
        'https://coopsmobiledetailingaledo.com/our-work/',
        'https://coopsmobiledetailingaledo.com/privacy/',
        'https://coopsmobiledetailingaledo.com/services/',
        'https://instagram.com/coops_mobile_detailing',
        'https://admin.omnireach.cloud/login',
        'https://www.googletagmanager.com/gtag/js?id=G-5H7ZB5HMLC',
        'https://omnireach.cloud',
        'https://omnireach.cloud/',
        'https://omnireach.cloud/about/',
        'https://omnireach.cloud/404/',
        'https://omnireach.cloud/contact/',
        'https://omnireach.cloud/privacy/',
        'https://omnireach.cloud/services/',
        'https://omnireach.cloud/tos/',
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
