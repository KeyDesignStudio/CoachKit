import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibraryDiscipline, WorkoutLibrarySource, WorkoutLibrarySessionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';
import {
  buildFreeExerciseDbCandidate,
  fetchFreeExerciseDb,
  type FreeExerciseDbCandidate,
} from '@/lib/ingestion/free-exercise-db';

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
  try {
    await requireWorkoutLibraryAdmin();

    const body = bodySchema.parse(await request.json());
    const dryRun = body.dryRun;

    if (!dryRun && !body.confirmApply) {
      return success({
        source: 'FREE_EXERCISE_DB',
        dryRun,
        scanned: 0,
        wouldCreate: 0,
        wouldUpdate: 0,
        skippedDuplicates: 0,
        errors: 0,
        sample: { creates: [], updates: [], skips: [] },
        message: 'Import blocked: confirmApply=true is required when dryRun=false.',
      } satisfies ImportSummary);
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

    if (toCreate.length > 0) {
      await prisma.workoutLibrarySession.createMany({
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
    }

    return success({
      source: 'FREE_EXERCISE_DB',
      dryRun: false,
      scanned: candidates.length,
      wouldCreate: toCreate.length,
      wouldUpdate: toUpdate.length,
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
    return handleError(error);
  }
}
