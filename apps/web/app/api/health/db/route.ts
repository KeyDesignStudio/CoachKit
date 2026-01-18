import { randomUUID } from 'crypto';

import { prisma } from '@/lib/prisma';
import { getDatabaseHost } from '@/lib/db-connection';
import { isPrismaInitError, logPrismaInitError } from '@/lib/prisma-diagnostics';

export const dynamic = 'force-dynamic';

export async function GET() {
  const requestId = randomUUID();
  const host = getDatabaseHost();
  const timestamp = new Date().toISOString();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, host, timestamp }, { status: 200 });
  } catch (error) {
    if (isPrismaInitError(error)) {
      logPrismaInitError({ requestId, where: 'GET /api/health/db', error });
    } else {
      console.error('DB_HEALTHCHECK_FAILED', {
        requestId,
        host,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { value: error },
      });
    }

    return Response.json({ ok: false, error: 'DB_UNREACHABLE', host, requestId }, { status: 500 });
  }
}
