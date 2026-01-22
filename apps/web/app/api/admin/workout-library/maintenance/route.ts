import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibrarySessionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';
import {
  deriveIntensityCategory,
  normalizeEquipment,
  normalizeTags,
} from '@/lib/workout-library-taxonomy';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  dryRun: z.boolean().default(true),
  action: z.enum(['normalizeTags', 'normalizeEquipment', 'recomputeIntensityCategory']),
});

type MaintenanceSummary = {
  dryRun: boolean;
  action: z.infer<typeof bodySchema>['action'];
  scanned: number;
  updated: number;
  unchanged: number;
  deleted?: number;
  errors: number;
  examples: Array<{ id: string; title: string; before: unknown; after: unknown }>;
  message?: string;
};

export async function POST(request: NextRequest) {
  try {
    await requireWorkoutLibraryAdmin();

    const body = bodySchema.parse(await request.json());

    const sessions = await prisma.workoutLibrarySession.findMany({
      select: {
        id: true,
        title: true,
        tags: true,
        equipment: true,
        intensityTarget: true,
        intensityCategory: true,
      },
    });

    let updated = 0;
    let unchanged = 0;
    let errors = 0;

    const examples: MaintenanceSummary['examples'] = [];

    const updates: Array<ReturnType<typeof prisma.workoutLibrarySession.update>> = [];

    for (const s of sessions) {
      try {
        if (body.action === 'normalizeTags') {
          const next = normalizeTags(s.tags);
          const isSame = JSON.stringify(next) === JSON.stringify(s.tags);
          if (isSame) {
            unchanged++;
            continue;
          }
          updated++;
          if (examples.length < 10) {
            examples.push({ id: s.id, title: s.title, before: s.tags, after: next });
          }
          if (!body.dryRun) {
            updates.push(prisma.workoutLibrarySession.update({ where: { id: s.id }, data: { tags: next } }));
          }
          continue;
        }

        if (body.action === 'normalizeEquipment') {
          const next = normalizeEquipment(s.equipment);
          const isSame = JSON.stringify(next) === JSON.stringify(s.equipment);
          if (isSame) {
            unchanged++;
            continue;
          }
          updated++;
          if (examples.length < 10) {
            examples.push({ id: s.id, title: s.title, before: s.equipment, after: next });
          }
          if (!body.dryRun) {
            updates.push(
              prisma.workoutLibrarySession.update({ where: { id: s.id }, data: { equipment: next } })
            );
          }
          continue;
        }

        if (body.action === 'recomputeIntensityCategory') {
          const target = (s.intensityTarget ?? '').trim();
          const next = target ? deriveIntensityCategory(target) : null;
          const isSame = s.intensityCategory === next;
          if (isSame) {
            unchanged++;
            continue;
          }
          updated++;
          if (examples.length < 10) {
            examples.push({ id: s.id, title: s.title, before: s.intensityCategory, after: next });
          }
          if (!body.dryRun) {
            updates.push(
              prisma.workoutLibrarySession.update({ where: { id: s.id }, data: { intensityCategory: next } })
            );
          }
          continue;
        }

        unchanged++;
      } catch {
        errors++;
      }
    }

    if (!body.dryRun && updates.length > 0) {
      // Chunk to avoid huge transactions.
      const chunkSize = 250;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await prisma.$transaction(chunk);
      }
    }

    const summary: MaintenanceSummary = {
      dryRun: body.dryRun,
      action: body.action,
      scanned: sessions.length,
      updated,
      unchanged,
      errors,
      examples,
    };

    return success(summary);
  } catch (error) {
    return handleError(error);
  }
}
