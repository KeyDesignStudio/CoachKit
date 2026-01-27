import { PrismaClient } from '@prisma/client';

import { getDatabaseUrl } from '@/lib/db-connection';

const globalForPrisma = globalThis as unknown as {
  prisma?: unknown;
};

// If DATABASE_URL is missing but DIRECT_URL is set, allow Prisma to still work.
// Never log the full URL.
const datasourceUrl = getDatabaseUrl();

const basePrisma =
  (globalForPrisma.prisma as PrismaClient | undefined) ??
  new PrismaClient(
    datasourceUrl
      ? {
          datasources: {
            db: { url: datasourceUrl },
          },
        }
      : undefined
  );

export const prisma = basePrisma;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = basePrisma;
