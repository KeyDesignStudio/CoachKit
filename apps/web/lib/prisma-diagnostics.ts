import { Prisma } from '@prisma/client';

import { getDatabaseHost, getRuntimeEnvInfo } from '@/lib/db-connection';

export function isPrismaInitError(error: unknown): error is Prisma.PrismaClientInitializationError {
  return error instanceof Prisma.PrismaClientInitializationError;
}

export function logPrismaInitError(params: {
  requestId?: string;
  where: string;
  error: Prisma.PrismaClientInitializationError;
  extra?: Record<string, unknown>;
}) {
  const { requestId, where, error, extra } = params;
  const env = getRuntimeEnvInfo();

  console.error('PRISMA_DB_UNREACHABLE', {
    requestId,
    where,
    dbHost: getDatabaseHost(),
    ...env,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...(extra ? { extra } : {}),
  });
}
