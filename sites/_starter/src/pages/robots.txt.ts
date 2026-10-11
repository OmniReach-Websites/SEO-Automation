export function GET(): Response {
  return new Response(
    'User-agent: *\nAllow: /\nSitemap: https://fictional-copper-spoon.test/sitemap.xml\n',
    {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    },
  );
}
