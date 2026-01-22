import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { WorkoutLibraryDiscipline, WorkoutLibrarySource, WorkoutLibrarySessionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { failure, handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';
import { getDatabaseHost, getRuntimeEnvInfo } from '@/lib/db-connection';
import { isPrismaInitError, logPrismaInitError } from '@/lib/prisma-diagnostics';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';
import { computeWorkoutLibraryPromptFingerprint } from '@/lib/workout-library-fingerprint';
import { normalizeEquipment, normalizeTags } from '@/lib/workout-library-taxonomy';

export const dynamic = 'force-dynamic';

function parseCommaList(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    return trimmed
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

const importRawItemSchema = z
  .object({
    title: z.any(),
    discipline: z.any(),
    category: z.any().optional(),
    tags: z.any().optional(),
    equipment: z.any().optional(),
    workoutDetail: z.any(),
  })
  .transform((raw) => {
    const title = typeof raw.title === 'string' ? raw.title.trim() : String(raw.title ?? '').trim();
    const discipline =
      typeof raw.discipline === 'string'
        ? raw.discipline.trim().toUpperCase()
        : String(raw.discipline ?? '').trim().toUpperCase();

    const category = typeof raw.category === 'string' ? raw.category.trim() : raw.category ? String(raw.category).trim() : '';
    const workoutDetail = typeof raw.workoutDetail === 'string' ? raw.workoutDetail : String(raw.workoutDetail ?? '');

    return {
      title,
      discipline,
      category: category || null,
      tags: parseCommaList(raw.tags),
      equipment: parseCommaList(raw.equipment),
      workoutDetail: workoutDetail,
    };
  });

const importItemSchema = z
  .object({
    title: z.string().min(1),
    discipline: z.nativeEnum(WorkoutLibraryDiscipline),
    category: z.string().trim().min(1),
    tags: z.array(z.string().trim().min(1)).default([]),
    workoutDetail: z.string().min(1),
    equipment: z.array(z.string().trim().min(1)).default([]),
  });

const importBodySchema = z.object({
  dryRun: z.boolean().default(true),
  confirmApply: z.boolean().default(false),
  onDuplicate: z.enum(['skip']).default('skip'),
  items: z.array(z.unknown()).default([]),
});

const MAX_IMPORT_ROWS = 500;

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let ctx: { dryRun?: boolean; itemCount?: number } = {};
  try {
    const { user } = await requireWorkoutLibraryAdmin();

    const parsedBody = importBodySchema.parse(await request.json());
    ctx = { dryRun: parsedBody.dryRun, itemCount: parsedBody.items.length };
    const dryRun = parsedBody.dryRun;

    if (!dryRun && !parsedBody.confirmApply) {
      return failure('CONFIRM_APPLY_REQUIRED', 'confirmApply is required when dryRun=false.', 400, requestId);
    }

    if (parsedBody.items.length > MAX_IMPORT_ROWS) {
      return failure(
        'MAX_ROWS_EXCEEDED',
        `Import blocked: maxRows=${MAX_IMPORT_ROWS}. Split the file into smaller batches.`,
        400,
        requestId
      );
    }

    if (parsedBody.items.length === 0) {
      return failure('NO_ITEMS', 'No items provided.', 400, requestId);
    }

    const normalized: Array<z.infer<typeof importItemSchema>> = [];
    const errors: Array<{ index: number; message: string }> = [];

    for (let i = 0; i < parsedBody.items.length; i++) {
      const raw = parsedBody.items[i];
      const rawParsed = importRawItemSchema.safeParse(raw);
      if (!rawParsed.success) {
        errors.push({ index: i + 1, message: 'Invalid row shape.' });
        continue;
      }

      const coerced = {
        ...rawParsed.data,
        discipline: rawParsed.data.discipline as unknown,
      };

      const candidate = importItemSchema.safeParse(coerced);
      if (!candidate.success) {
        const message = candidate.error.issues[0]?.message ?? 'Validation error.';
        errors.push({ index: i + 1, message });
        continue;
      }

      normalized.push({
        ...candidate.data,
        tags: normalizeTags(candidate.data.tags),
        equipment: normalizeEquipment(candidate.data.equipment),
      });
    }

    const preview = normalized.slice(0, 20);

    if (!dryRun && errors.length > 0) {
      return success({
        dryRun,
        totalCount: parsedBody.items.length,
        validCount: normalized.length,
        errorCount: errors.length,
        preview,
        errors,
        createdCount: 0,
        createdIds: [],
        message: 'Import blocked: fix row errors, then retry.',
      });
    }

    if (dryRun) {
      return success({
        dryRun,
        totalCount: parsedBody.items.length,
        validCount: normalized.length,
        errorCount: errors.length,
        preview,
        errors,
        createdCount: 0,
        createdIds: [],
        skippedExistingCount: 0,
      });
    }

    const candidates = normalized.map((item) => {
      const fingerprint = computeWorkoutLibraryPromptFingerprint({
        discipline: item.discipline,
        title: item.title,
        category: item.category,
      });
      return { item, fingerprint };
    });

    const fingerprints = candidates.map((c) => c.fingerprint);
    const existing = await prisma.workoutLibrarySession.findMany({
      where: { fingerprint: { in: fingerprints } },
      select: { fingerprint: true },
    });
    const existingSet = new Set(existing.map((e) => e.fingerprint).filter(Boolean));

    const toCreate = candidates.filter((c) => !existingSet.has(c.fingerprint));
    const skippedExistingCount = candidates.length - toCreate.length;

    const created = await prisma.$transaction(
      toCreate.map(({ item, fingerprint }) =>
        prisma.workoutLibrarySession.create({
          data: {
            title: item.title,
            discipline: item.discipline,
            status: WorkoutLibrarySessionStatus.DRAFT,
            source: WorkoutLibrarySource.MANUAL,
            fingerprint,
            tags: item.tags,
            category: item.category,
            description: item.workoutDetail,
            durationSec: 0,
            intensityTarget: '',
            intensityCategory: null,
            distanceMeters: null,
            elevationGainMeters: null,
            notes: null,
            equipment: item.equipment,
            workoutStructure: undefined,
            createdByUserId: user.id,
          },
          select: { id: true },
        })
      )
    );

    return success({
      dryRun,
      totalCount: parsedBody.items.length,
      validCount: normalized.length,
      errorCount: errors.length,
      preview,
      errors,
      createdCount: created.length,
      createdIds: created.map((c) => c.id),
      skippedExistingCount,
      message:
        skippedExistingCount > 0
          ? `Skipped ${skippedExistingCount} duplicate rows (fingerprint match). Created ${created.length}.`
          : undefined,
    });
  } catch (error) {
    if (isPrismaInitError(error)) {
      logPrismaInitError({
        requestId,
        where: 'POST /api/admin/workout-library/import',
        error,
        extra: {
          ...ctx,
          url: request.url,
          method: request.method,
        },
      });
      return failure('DB_UNREACHABLE', 'Database is unreachable.', 500, requestId);
    }

    console.error('WORKOUT_LIBRARY_MANUAL_IMPORT_FAILED', {
      requestId,
      ...ctx,
      dbHost: getDatabaseHost(),
      ...getRuntimeEnvInfo(),
      url: request.url,
      method: request.method,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { value: error },
    });

    if (error instanceof ApiError) {
      return failure(error.code, error.message, error.status, requestId);
    }

    if (error instanceof z.ZodError) {
      const message = error.issues.map((issue) => issue.message).filter(Boolean).join(' ');
      return failure('VALIDATION_ERROR', message || 'Invalid request.', 400, requestId);
    }

    // Preserve existing behavior for unknown errors, but include requestId.
    return failure('INTERNAL_SERVER_ERROR', 'Something went wrong.', 500, requestId);
  }
}
