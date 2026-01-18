export function getDatabaseUrl(): string | undefined {
  const fromDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (fromDatabaseUrl) return fromDatabaseUrl;

  const fromDirectUrl = process.env.DIRECT_URL?.trim();
  if (fromDirectUrl) return fromDirectUrl;

  return undefined;
}

export function getDatabaseHost(): string {
  const url = getDatabaseUrl();
  if (!url) return 'unknown';

  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

export function getRuntimeEnvInfo() {
  return {
    NODE_ENV: process.env.NODE_ENV ?? 'unknown',
    VERCEL_ENV: process.env.VERCEL_ENV ?? 'unknown',
  };
}
