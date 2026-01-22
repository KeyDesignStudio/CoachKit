import { WorkoutLibrarySessionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';
import { handleError, success } from '@/lib/http';
import { getSafeDbInfoFromDatabase, getSafeDbInfoFromEnv, noStoreHeaders } from '@/lib/db-diagnostics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireWorkoutLibraryAdmin();

    const envDb = getSafeDbInfoFromEnv();
    const db = await getSafeDbInfoFromDatabase();

    const [workoutLibrarySessionTotal, published, draft, bySource, sample] = await prisma.$transaction([
      prisma.workoutLibrarySession.count(),
      prisma.workoutLibrarySession.count({ where: { status: WorkoutLibrarySessionStatus.PUBLISHED } }),
      prisma.workoutLibrarySession.count({ where: { status: WorkoutLibrarySessionStatus.DRAFT } }),
      prisma.workoutLibrarySession.groupBy({
        by: ['source'],
        orderBy: { source: 'asc' },
        _count: { _all: true },
      }),
      prisma.workoutLibrarySession.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    const countsBySource: Record<string, number> = {};
    for (const row of bySource) {
      const count =
        row && typeof (row as any)._count === 'object' && (row as any)._count
          ? ((row as any)._count._all as number | undefined) ?? 0
          : 0;
      countsBySource[String(row.source)] = count;
    }

    return success(
      {
        ok: true,
        db: {
          host: envDb.host,
          database: db.database ?? envDb.database,
          schema: db.schema ?? envDb.schema,
        },
        counts: {
          workoutLibrarySessionTotal,
          published,
          draft,
          countsBySource,
        },
        sample,
      },
      {
        headers: noStoreHeaders(),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
