import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibraryDiscipline, WorkoutLibrarySource, WorkoutLibrarySessionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { failure, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';
import { getDatabaseHost, getRuntimeEnvInfo } from '@/lib/db-connection';
import { isPrismaInitError, logPrismaInitError } from '@/lib/prisma-diagnostics';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';
import {
  buildFreeExerciseDbCandidate,
  fetchFreeExerciseDb,
  type FreeExerciseDbCandidate,
} from '@/lib/ingestion/free-exercise-db';

import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  dryRun: z.boolean().default(true),
  limit: z.number().int().positive().max(500).default(50),
  offset: z.number().int().min(0).default(0),
  confirmApply: z.boolean().default(false),
});

type ImportSummary = {
  source: 'FREE_EXERCISE_DB';
  dryRun: boolean;
  scanned: number;
  wouldCreate: number;
  wouldUpdate: number;
  createdCount?: number;
  updatedCount?: number;
  skippedDuplicates: number;
  errors: number;
  sample: {
    creates: Array<Pick<FreeExerciseDbCandidate, 'title' | 'fingerprint' | 'tags' | 'equipment'>>;
    updates: Array<{ id: string; title: string; fingerprint: string; changedFields: string[] }>;
    skips: Array<{ id: string; title: string; fingerprint: string; reason: string }>;
  };
  message?: string;
};

function diffCandidate(existing: {
  title: string;
  discipline: WorkoutLibraryDiscipline;
  tags: string[];
  description: string;
  durationSec: number;
  intensityTarget: string;
  equipment: string[];
  workoutStructure: unknown;
} , candidate: FreeExerciseDbCandidate): string[] {
  const changed: string[] = [];
  if (existing.title !== candidate.title) changed.push('title');
  if (existing.discipline !== candidate.discipline) changed.push('discipline');
  if (JSON.stringify(existing.tags) !== JSON.stringify(candidate.tags)) changed.push('tags');
  if (existing.description !== candidate.description) changed.push('description');
  if (existing.durationSec !== candidate.durationSec) changed.push('durationSec');
  if (existing.intensityTarget !== candidate.intensityTarget) changed.push('intensityTarget');
  if (JSON.stringify(existing.equipment) !== JSON.stringify(candidate.equipment)) changed.push('equipment');
  if (JSON.stringify(existing.workoutStructure) !== JSON.stringify(candidate.workoutStructure)) changed.push('workoutStructure');
  return changed;
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let ctx: { dryRun?: boolean; limit?: number; offset?: number; confirmApply?: boolean } = {};
  try {
    await requireWorkoutLibraryAdmin();

    const body = bodySchema.parse(await request.json());
    const dryRun = body.dryRun;
    ctx = { dryRun, limit: body.limit, offset: body.offset, confirmApply: body.confirmApply };

    if (!dryRun && !body.confirmApply) {
      return failure(
        'CONFIRM_APPLY_REQUIRED',
        'confirmApply is required when dryRun=false.',
        400,
        requestId
      );
    }

    const all = await fetchFreeExerciseDb();

    const slice = all.slice(body.offset, body.offset + body.limit);
    const candidates: FreeExerciseDbCandidate[] = [];
    let errors = 0;

    for (const raw of slice) {
      try {
        const candidate = buildFreeExerciseDbCandidate(raw);
        candidates.push(candidate);
      } catch {
        errors++;
      }
    }

    const fingerprints = candidates.map((c) => c.fingerprint);
    const existing = await prisma.workoutLibrarySession.findMany({
      where: {
        source: WorkoutLibrarySource.FREE_EXERCISE_DB,
        fingerprint: { in: fingerprints },
      },
      select: {
        id: true,
        title: true,
        fingerprint: true,
        status: true,
        discipline: true,
        tags: true,
        description: true,
        durationSec: true,
        intensityTarget: true,
        equipment: true,
        workoutStructure: true,
      },
    });

    const byFingerprint = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      if (row.fingerprint) byFingerprint.set(row.fingerprint, row);
    }

    const toCreate: FreeExerciseDbCandidate[] = [];
    const toUpdate: Array<{ id: string; candidate: FreeExerciseDbCandidate; changedFields: string[] }> = [];
    const skips: Array<{ id: string; title: string; fingerprint: string; reason: string }> = [];

    for (const candidate of candidates) {
      const hit = byFingerprint.get(candidate.fingerprint);
      if (!hit) {
        toCreate.push(candidate);
        continue;
      }

      const changedFields = diffCandidate(hit, candidate);
      if (changedFields.length === 0) {
        skips.push({ id: hit.id, title: hit.title, fingerprint: candidate.fingerprint, reason: 'identical' });
        continue;
      }

      if (hit.status !== WorkoutLibrarySessionStatus.DRAFT) {
        skips.push({ id: hit.id, title: hit.title, fingerprint: candidate.fingerprint, reason: `status=${hit.status}` });
        continue;
      }

      toUpdate.push({ id: hit.id, candidate, changedFields });
    }

    if (dryRun) {
      return success({
        source: 'FREE_EXERCISE_DB',
        dryRun: true,
        scanned: candidates.length,
        wouldCreate: toCreate.length,
        wouldUpdate: toUpdate.length,
        skippedDuplicates: skips.length,
        errors,
        sample: {
          creates: toCreate.slice(0, 10).map((c) => ({
            title: c.title,
            fingerprint: c.fingerprint,
            tags: c.tags,
            equipment: c.equipment,
          })),
          updates: toUpdate.slice(0, 10).map((u) => ({
            id: u.id,
            title: u.candidate.title,
            fingerprint: u.candidate.fingerprint,
            changedFields: u.changedFields,
          })),
          skips: skips.slice(0, 10),
        },
      } satisfies ImportSummary);
    }

    if (errors > 0) {
      return success({
        source: 'FREE_EXERCISE_DB',
        dryRun: false,
        scanned: candidates.length,
        wouldCreate: toCreate.length,
        wouldUpdate: toUpdate.length,
        skippedDuplicates: skips.length,
        errors,
        sample: { creates: [], updates: [], skips: [] },
        message: 'Import blocked: fix row errors, then retry.',
      } satisfies ImportSummary);
    }

    let createdCount = 0;
    let updatedCount = 0;

    if (toCreate.length > 0) {
      const created = await prisma.workoutLibrarySession.createMany({
        data: toCreate.map((c) => ({
          title: c.title,
          discipline: WorkoutLibraryDiscipline.STRENGTH,
          status: WorkoutLibrarySessionStatus.DRAFT,
          source: WorkoutLibrarySource.FREE_EXERCISE_DB,
          fingerprint: c.fingerprint,
          tags: c.tags,
          description: c.description,
          durationSec: c.durationSec,
          intensityTarget: c.intensityTarget,
          distanceMeters: null,
          elevationGainMeters: null,
          notes: null,
          equipment: c.equipment,
          workoutStructure: c.workoutStructure as any,
        })),
        skipDuplicates: true,
      });
      createdCount = created.count;
    }

    if (toUpdate.length > 0) {
      await prisma.$transaction(
        toUpdate.map((u) =>
          prisma.workoutLibrarySession.update({
            where: { id: u.id },
            data: {
              title: u.candidate.title,
              discipline: WorkoutLibraryDiscipline.STRENGTH,
              tags: u.candidate.tags,
              description: u.candidate.description,
              durationSec: u.candidate.durationSec,
              intensityTarget: u.candidate.intensityTarget,
              equipment: u.candidate.equipment,
              workoutStructure: u.candidate.workoutStructure as any,
            },
          })
        )
      );
      updatedCount = toUpdate.length;
    }

    return success({
      source: 'FREE_EXERCISE_DB',
      dryRun: false,
      scanned: candidates.length,
      wouldCreate: toCreate.length,
      wouldUpdate: toUpdate.length,
      createdCount,
      updatedCount,
      skippedDuplicates: skips.length,
      errors: 0,
      sample: {
        creates: [],
        updates: toUpdate.slice(0, 10).map((u) => ({
          id: u.id,
          title: u.candidate.title,
          fingerprint: u.candidate.fingerprint,
          changedFields: u.changedFields,
        })),
        skips: skips.slice(0, 10),
      },
      message: `Applied: created ${toCreate.length}, updated ${toUpdate.length}, skipped ${skips.length}.`,
    } satisfies ImportSummary);
  } catch (error) {
    if (isPrismaInitError(error)) {
      logPrismaInitError({
        requestId,
        where: 'POST /api/admin/workout-library/import/free-exercise-db',
        error,
        extra: {
          source: 'FREE_EXERCISE_DB',
          ...ctx,
          url: request.url,
          method: request.method,
        },
      });
      return failure('DB_UNREACHABLE', 'Database is unreachable.', 500, requestId);
    }

    console.error('FREE_EXERCISE_DB_IMPORT_FAILED', {
      requestId,
      source: 'FREE_EXERCISE_DB',
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

    return failure('INTERNAL_SERVER_ERROR', 'Free Exercise DB import failed.', 500, requestId);
  }
}
