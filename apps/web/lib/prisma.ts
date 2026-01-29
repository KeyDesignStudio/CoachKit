import { PrismaClient } from '@prisma/client';

import { getDatabaseUrl } from '@/lib/db-connection';

const globalForPrisma = globalThis as unknown as {
  prisma?: unknown;
};

// If DATABASE_URL is missing but DIRECT_URL is set, allow Prisma to still work.
// Never log the full URL.
const datasourceUrl = getDatabaseUrl();

// In local dev we cache PrismaClient on globalThis to avoid exhausting connections during hot reload.
// In test harness runs we intentionally avoid caching, because the harness swaps DATABASE_URL per suite/shard.
const canUseGlobalCache = process.env.NODE_ENV !== 'production' && !process.env.TEST_RUN_ID;

const basePrisma =
  (canUseGlobalCache ? (globalForPrisma.prisma as PrismaClient | undefined) : undefined) ??
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

if (canUseGlobalCache) globalForPrisma.prisma = basePrisma;
