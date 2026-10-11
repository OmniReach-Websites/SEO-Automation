const paths = ['/', '/about/', '/menu/', '/contact/', '/privacy/'];
export function GET(): Response {
  const urls = paths
    .map((path) => `<url><loc>https://fictional-copper-spoon.test${path}</loc></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    {
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    },
  );
}
