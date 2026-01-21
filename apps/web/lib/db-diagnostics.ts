import { prisma } from '@/lib/prisma';

export type SafeDbInfo = {
  host: string | null;
  database: string | null;
  schema: string | null;
};

function getDatabaseUrl(): string | null {
  return process.env.DATABASE_URL_NEON ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
}

export function getSafeDbInfoFromEnv(): SafeDbInfo {
  const urlText = getDatabaseUrl();
  if (!urlText) return { host: null, database: null, schema: null };

  try {
    const url = new URL(urlText);
    const database = url.pathname?.replace(/^\//, '') || null;
    const schema = url.searchParams.get('schema') || 'public';

    return {
      host: url.hostname || null,
      database,
      schema,
    };
  } catch {
    return { host: null, database: null, schema: null };
  }
}

export async function getSafeDbInfoFromDatabase(): Promise<Pick<SafeDbInfo, 'database' | 'schema'>> {
  try {
    const [row] = await prisma.$queryRaw<{ database: string; schema: string }[]>`
      select current_database() as database, current_schema() as schema
    `;

    return {
      database: row?.database ?? null,
      schema: row?.schema ?? null,
    };
  } catch {
    return { database: null, schema: null };
  }
}

export function noStoreHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    ...extra,
  };
}
