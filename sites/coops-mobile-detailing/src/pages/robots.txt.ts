export function GET(): Response {
  return new Response(
    'User-agent: *\nAllow: /\nSitemap: https://coopsmobiledetailing.vercel.app/sitemap.xml\n',
    {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    },
  );
}
