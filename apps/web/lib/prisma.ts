import { PrismaClient } from '@prisma/client';

import { getAuditActor } from '@/lib/audit-context';
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

function toSafeJsonText(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function changedFieldNames(data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.keys(data as Record<string, unknown>);
}

function inferRecordId(result: unknown, fallback: string): string {
  if (result && typeof result === 'object' && 'id' in (result as Record<string, unknown>)) {
    const id = (result as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim().length) return id;
  }
  return fallback;
}

const prismaMiddlewareClient = basePrisma as unknown as {
  $use: (fn: (params: any, next: (params: any) => Promise<any>) => Promise<any>) => void;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
};

prismaMiddlewareClient.$use(async (params, next) => {
  const action = params.action;
  const modelName = params.model;

  if (!modelName || modelName === 'AdminAuditEvent') {
    return next(params);
  }

  const auditedAction: 'CREATE' | 'UPDATE' | 'DELETE' | null =
    action === 'create' || action === 'createMany' || action === 'upsert'
      ? 'CREATE'
      : action === 'update' || action === 'updateMany'
        ? 'UPDATE'
        : action === 'delete' || action === 'deleteMany'
          ? 'DELETE'
          : null;

  if (!auditedAction) return next(params);

  const actor = getAuditActor();
  const whereRaw = (params.args as Record<string, unknown> | undefined)?.where;
  const whereText = whereRaw ? JSON.stringify(whereRaw) : '*';
  const dataRaw = (params.args as Record<string, unknown> | undefined)?.data;
  const fields = changedFieldNames(dataRaw);
  const fieldNames = fields.length ? fields : ['*'];

  // Avoid cross-transaction drift. If operation runs inside an explicit DB transaction,
  // skip audit write from middleware to prevent writing an audit row outside that transaction boundary.
  const skipWrite = Boolean(params.runInTransaction);

  let beforeRow: Record<string, unknown> | null = null;
  if (!skipWrite && (action === 'update' || action === 'delete') && whereRaw) {
    try {
      const delegate = (basePrisma as unknown as Record<string, any>)[modelName];
      if (delegate && typeof delegate.findUnique === 'function') {
        beforeRow = (await delegate.findUnique({ where: whereRaw })) as Record<string, unknown> | null;
      }
    } catch {
      beforeRow = null;
    }
  }

  const result = await next(params);

  if (skipWrite) return result;

  const recordId = inferRecordId(result, whereText);
  const rows = fieldNames.map((fieldName) => {
    const beforeValue = fieldName === '*' ? beforeRow : beforeRow?.[fieldName];
    const afterValue =
      fieldName === '*'
        ? result
        : result && typeof result === 'object'
          ? (result as Record<string, unknown>)[fieldName]
          : undefined;

    const beforeJsonText = toSafeJsonText(beforeValue);
    const afterJsonText = toSafeJsonText(afterValue);

    return {
      action: auditedAction,
      tableName: modelName,
      fieldName,
      recordId,
      changeText:
        auditedAction === 'CREATE'
          ? 'Record created.'
          : auditedAction === 'DELETE'
            ? 'Record deleted.'
            : 'Field updated.',
      beforeValueText: beforeJsonText,
      afterValueText: afterJsonText,
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
    };
  });

  try {
    for (const row of rows) {
      const auditId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `audit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await prismaMiddlewareClient.$executeRawUnsafe(
        `INSERT INTO "AdminAuditEvent"
          ("id","createdAt","action","tableName","fieldName","recordId","changeText","beforeValue","afterValue","actorUserId","actorEmail","actorRole")
         VALUES
          ($1, NOW(), $2::"AdminAuditAction", $3, $4, $5, $6, CAST($7 AS jsonb), CAST($8 AS jsonb), $9, $10, CAST($11 AS "UserRole"))`,
        auditId,
        row.action,
        row.tableName,
        row.fieldName,
        row.recordId,
        row.changeText,
        row.beforeValueText,
        row.afterValueText,
        row.actorUserId,
        row.actorEmail,
        row.actorRole
      );
    }
  } catch {
    // Audit logging must never block the main write path.
  }

  return result;
});

export const prisma = basePrisma;

if (canUseGlobalCache) globalForPrisma.prisma = basePrisma;
