import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { getSafeDbInfoFromDatabase, getSafeDbInfoFromEnv, noStoreHeaders } from '@/lib/db-diagnostics';
import { WorkoutLibrarySource, WorkoutLibrarySessionStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type TableDiag = {
  table: string;
  exists: boolean;
  rowCount: number | null;
};

async function getTableDiag(schema: string, table: string): Promise<TableDiag> {
  const qualified = `${schema}."${table}"`;

  const existsResult = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass(${qualified}) IS NOT NULL AS "exists";
  `;

  const exists = Boolean(existsResult[0]?.exists);
  if (!exists) {
    return { table, exists: false, rowCount: null };
  }

  const countSql = `SELECT COUNT(*)::int AS count FROM ${qualified};`;
  const countResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(countSql);

  return { table, exists: true, rowCount: typeof countResult[0]?.count === 'number' ? countResult[0]!.count : 0 };
}

export async function GET() {
  try {
    await requireAdmin();

    const envDb = getSafeDbInfoFromEnv();
    const db = await getSafeDbInfoFromDatabase();

    const schema = db.schema ?? envDb.schema ?? 'public';

    const tables = [
      'PlanTemplate',
      'PlanTemplateScheduleRow',
      'AthletePlanInstance',
      'AthletePlanInstanceItem',
    ];

    const tableDiags = await Promise.all(tables.map((table) => getTableDiag(schema, table)));

    const [planLibraryTotal, planLibraryDraft, planLibraryPublished, planLibrarySample] = await prisma.$transaction([
      prisma.workoutLibrarySession.count({ where: { source: WorkoutLibrarySource.PLAN_LIBRARY } }),
      prisma.workoutLibrarySession.count({
        where: { source: WorkoutLibrarySource.PLAN_LIBRARY, status: WorkoutLibrarySessionStatus.DRAFT },
      }),
      prisma.workoutLibrarySession.count({
        where: { source: WorkoutLibrarySource.PLAN_LIBRARY, status: WorkoutLibrarySessionStatus.PUBLISHED },
      }),
      prisma.workoutLibrarySession.findMany({
        where: { source: WorkoutLibrarySource.PLAN_LIBRARY },
        take: 5,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          externalId: true,
          updatedAt: true,
        },
      }),
    ]);

    return success(
      {
        ok: true,
        db: {
          host: envDb.host,
          database: db.database ?? envDb.database,
          schema,
        },
        tables: tableDiags,
        workoutLibrary: {
          planLibrary: {
            total: planLibraryTotal,
            draft: planLibraryDraft,
            published: planLibraryPublished,
            sample: planLibrarySample,
          },
        },
      },
      {
        headers: noStoreHeaders(),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
