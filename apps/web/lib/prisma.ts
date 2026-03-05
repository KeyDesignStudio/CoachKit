import { Prisma, PrismaClient } from '@prisma/client';

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

type PendingAuditRow = {
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  tableName: string;
  fieldName: string;
  recordId: string;
  changeText: string;
  beforeValue: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined;
  afterValue: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: 'COACH' | 'ATHLETE' | 'ADMIN' | null;
};

const AUDIT_FLUSH_DELAY_MS = 25;
const AUDIT_BATCH_SIZE = 100;

const globalForAuditQueue = globalThis as unknown as {
  __coachkitAuditQueue?: {
    rows: PendingAuditRow[];
    timer: ReturnType<typeof setTimeout> | null;
    flushing: Promise<void> | null;
  };
};

const auditQueue =
  globalForAuditQueue.__coachkitAuditQueue ??
  {
    rows: [] as PendingAuditRow[],
    timer: null as ReturnType<typeof setTimeout> | null,
    flushing: null as Promise<void> | null,
  };

globalForAuditQueue.__coachkitAuditQueue = auditQueue;

function toSafeJsonValue(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

async function flushAuditQueue(): Promise<void> {
  if (auditQueue.flushing) {
    return auditQueue.flushing;
  }

  auditQueue.flushing = (async () => {
    while (auditQueue.rows.length > 0) {
      const batch = auditQueue.rows.splice(0, AUDIT_BATCH_SIZE);
      try {
        await basePrisma.adminAuditEvent.createMany({
          data: batch.map((row) => ({
            action: row.action,
            tableName: row.tableName,
            fieldName: row.fieldName,
            recordId: row.recordId,
            changeText: row.changeText,
            beforeValue: row.beforeValue,
            afterValue: row.afterValue,
            actorUserId: row.actorUserId,
            actorEmail: row.actorEmail,
            actorRole: row.actorRole,
          })),
        });
      } catch {
        // Audit logging must never block the main write path.
      }
    }
  })().finally(() => {
    auditQueue.flushing = null;
    if (auditQueue.rows.length > 0) {
      scheduleAuditFlush();
    }
  });

  return auditQueue.flushing;
}

function scheduleAuditFlush() {
  if (auditQueue.flushing || auditQueue.timer) return;
  auditQueue.timer = setTimeout(() => {
    auditQueue.timer = null;
    void flushAuditQueue();
  }, AUDIT_FLUSH_DELAY_MS);
}

function enqueueAuditRows(rows: PendingAuditRow[]) {
  if (rows.length === 0) return;
  auditQueue.rows.push(...rows);

  if (auditQueue.rows.length >= AUDIT_BATCH_SIZE) {
    if (auditQueue.timer) {
      clearTimeout(auditQueue.timer);
      auditQueue.timer = null;
    }
    void flushAuditQueue();
    return;
  }

  scheduleAuditFlush();
}

const prismaMiddlewareClient = basePrisma as unknown as {
  $use?: (fn: (params: any, next: (params: any) => Promise<any>) => Promise<any>) => void;
};

const registerAuditMiddleware = prismaMiddlewareClient.$use;
if (typeof registerAuditMiddleware === 'function') {
  registerAuditMiddleware(async (params, next) => {
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
  const isBulkAction = action === 'createMany' || action === 'updateMany' || action === 'deleteMany';
  const fields = isBulkAction ? [] : changedFieldNames(dataRaw);
  const fieldNames = fields.length ? fields : ['*'];

  // Avoid cross-transaction drift. If operation runs inside an explicit DB transaction,
  // skip audit write from middleware to prevent writing an audit row outside that transaction boundary.
  const skipWrite = Boolean(params.runInTransaction);

  const result = await next(params);

  if (skipWrite) return result;

  const recordId = inferRecordId(result, whereText);
  const rows = fieldNames.map((fieldName) => {
    const fieldValue =
      fieldName === '*'
        ? result
        : result && typeof result === 'object'
          ? (result as Record<string, unknown>)[fieldName]
          : undefined;

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
      beforeValue: auditedAction === 'DELETE' ? toSafeJsonValue(fieldValue) : undefined,
      afterValue: auditedAction === 'DELETE' ? undefined : toSafeJsonValue(fieldValue),
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
    } satisfies PendingAuditRow;
  });

  enqueueAuditRows(rows);

  return result;
  });
}

export const prisma = basePrisma;

if (canUseGlobalCache) globalForPrisma.prisma = basePrisma;
