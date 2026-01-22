import { PrismaClient, WorkoutLibrarySource } from '@prisma/client';

import { getDatabaseUrl } from '@/lib/db-connection';
import { ApiError } from '@/lib/errors';

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

function containsPlanLibrarySource(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.source === WorkoutLibrarySource.PLAN_LIBRARY || v.source === 'PLAN_LIBRARY') return true;
  return false;
}

const prismaWithGuard = basePrisma.$extends({
  query: {
    workoutLibrarySession: {
      create({ args, query }) {
        if (containsPlanLibrarySource((args as any).data)) {
          throw new ApiError(
            400,
            'PLAN_LIBRARY_TEMPLATES_DISABLED',
            'Plan Library templates are disabled. Plan Library is schedule data only and must not write Workout Library templates.'
          );
        }
        return query(args);
      },
      update({ args, query }) {
        if (containsPlanLibrarySource((args as any).data)) {
          throw new ApiError(
            400,
            'PLAN_LIBRARY_TEMPLATES_DISABLED',
            'Plan Library templates are disabled. Plan Library is schedule data only and must not write Workout Library templates.'
          );
        }
        return query(args);
      },
      upsert({ args, query }) {
        if (containsPlanLibrarySource((args as any).create) || containsPlanLibrarySource((args as any).update)) {
          throw new ApiError(
            400,
            'PLAN_LIBRARY_TEMPLATES_DISABLED',
            'Plan Library templates are disabled. Plan Library is schedule data only and must not write Workout Library templates.'
          );
        }
        return query(args);
      },
      createMany({ args, query }) {
        const data = (args as any).data;
        if (Array.isArray(data)) {
          for (const row of data) {
            if (containsPlanLibrarySource(row)) {
              throw new ApiError(
                400,
                'PLAN_LIBRARY_TEMPLATES_DISABLED',
                'Plan Library templates are disabled. Plan Library is schedule data only and must not write Workout Library templates.'
              );
            }
          }
        } else if (containsPlanLibrarySource(data)) {
          throw new ApiError(
            400,
            'PLAN_LIBRARY_TEMPLATES_DISABLED',
            'Plan Library templates are disabled. Plan Library is schedule data only and must not write Workout Library templates.'
          );
        }
        return query(args);
      },
      updateMany({ args, query }) {
        if (containsPlanLibrarySource((args as any).data)) {
          throw new ApiError(
            400,
            'PLAN_LIBRARY_TEMPLATES_DISABLED',
            'Plan Library templates are disabled. Plan Library is schedule data only and must not write Workout Library templates.'
          );
        }
        return query(args);
      },
    },
  },
});

export const prisma = prismaWithGuard as unknown as PrismaClient;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
