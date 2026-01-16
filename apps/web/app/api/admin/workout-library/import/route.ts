import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibraryDiscipline } from '@prisma/client';
import { readFile } from 'node:fs/promises';

import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';

export const dynamic = 'force-dynamic';

const importItemSchema = z
  .object({
    title: z.string().trim().min(1),
    discipline: z.nativeEnum(WorkoutLibraryDiscipline),
    tags: z.array(z.string().trim().min(1)).default([]),
    description: z.string().trim().min(1),
    durationSec: z.number().int().positive().optional(),
    intensityTarget: z.string().trim().min(1),
    distanceMeters: z.number().positive().optional(),
    elevationGainMeters: z.number().nonnegative().optional(),
    notes: z.string().trim().max(20000).optional(),
    equipment: z.array(z.string().trim().min(1)).default([]),
    workoutStructure: z.unknown().optional(),
  })
  .superRefine((data, ctx) => {
    const hasDuration = typeof data.durationSec === 'number' && data.durationSec > 0;
    const hasDistance = typeof data.distanceMeters === 'number' && data.distanceMeters > 0;

    if (!hasDuration && !hasDistance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'durationSec or distanceMeters is required.',
      });
    }
  });

const importBodySchema = z.union([
  z.array(importItemSchema),
  z.object({ items: z.array(importItemSchema) }),
  z.object({ filePath: z.string().min(1) }),
]);

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireWorkoutLibraryAdmin();

    const parsed = importBodySchema.parse(await request.json());

    let items: z.infer<typeof importItemSchema>[];

    if (Array.isArray(parsed)) {
      items = parsed;
    } else if ('items' in parsed) {
      items = parsed.items;
    } else {
      const raw = await readFile(parsed.filePath, 'utf8');
      const json = JSON.parse(raw);
      items = z.array(importItemSchema).parse(json);
    }

    if (items.length === 0) {
      return success({
        importedCount: 0,
        message: 'No items provided.',
      });
    }

    const created = await prisma.$transaction(
      items.map((item) =>
        prisma.workoutLibrarySession.create({
          data: {
            title: item.title,
            discipline: item.discipline,
            tags: item.tags,
            description: item.description,
            durationSec: item.durationSec ?? 0,
            intensityTarget: item.intensityTarget,
            distanceMeters: item.distanceMeters ?? null,
            elevationGainMeters: item.elevationGainMeters ?? null,
            notes: item.notes ?? null,
            equipment: item.equipment,
            workoutStructure: item.workoutStructure ?? undefined,
            createdByUserId: user.id,
          },
          select: { id: true },
        })
      )
    );

    return success({
      importedCount: created.length,
      ids: created.map((c) => c.id),
    });
  } catch (error) {
    return handleError(error);
  }
}
