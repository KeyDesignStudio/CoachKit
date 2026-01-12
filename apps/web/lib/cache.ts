export function privateCacheHeaders(options: {
  maxAgeSeconds: number;
  staleWhileRevalidateSeconds?: number;
}): HeadersInit {
  const stale = options.staleWhileRevalidateSeconds ?? 0;
  const directives = [`private`, `max-age=${Math.max(0, options.maxAgeSeconds)}`];
  if (stale > 0) directives.push(`stale-while-revalidate=${Math.max(0, stale)}`);

  return {
    'Cache-Control': directives.join(', '),
    // Requests authenticate via Clerk cookies; ensure any shared caches separate variants.
    Vary: 'Cookie',
  };
}
