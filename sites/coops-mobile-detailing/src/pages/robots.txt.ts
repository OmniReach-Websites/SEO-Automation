export function GET(): Response {
  return new Response(
    'User-agent: *\nAllow: /\nSitemap: https://coopsmobiledetailingaledo.com/sitemap.xml\n',
    {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    },
  );
}
