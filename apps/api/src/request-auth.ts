import type { FastifyRequest } from 'fastify';

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  const parsed = request.cookies[name];
  if (parsed) return parsed;
  for (const entry of request.headers.cookie?.split(';') ?? []) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
