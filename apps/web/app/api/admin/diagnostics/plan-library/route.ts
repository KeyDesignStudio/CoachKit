import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { getSafeDbInfoFromDatabase, getSafeDbInfoFromEnv, noStoreHeaders } from '@/lib/db-diagnostics';

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

    return success(
      {
        ok: true,
        db: {
          host: envDb.host,
          database: db.database ?? envDb.database,
          schema,
        },
        tables: tableDiags,
      },
      {
        headers: noStoreHeaders(),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
