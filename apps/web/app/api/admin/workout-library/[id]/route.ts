import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibraryDiscipline } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    discipline: z.nativeEnum(WorkoutLibraryDiscipline).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    description: z.string().trim().min(1).optional(),
    durationSec: z.number().int().nonnegative().optional(),
    intensityTarget: z.string().trim().min(1).optional(),
    distanceMeters: z.number().positive().nullable().optional(),
    elevationGainMeters: z.number().nonnegative().nullable().optional(),
    notes: z.string().trim().max(20000).nullable().optional(),
    equipment: z.array(z.string().trim().min(1)).optional(),
    workoutStructure: z.unknown().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // Optional: if durationSec is explicitly set to 0 and no distanceMeters, reject.
    // This preserves the rule that durationSec OR distanceMeters should be present.
    if (Object.prototype.hasOwnProperty.call(data, 'durationSec')) {
      const duration = data.durationSec;
      const distance = data.distanceMeters;
      const hasDuration = typeof duration === 'number' && duration > 0;
      const hasDistance = typeof distance === 'number' && distance > 0;
      if (duration === 0 && !hasDistance) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'durationSec must be > 0 unless distanceMeters is provided.',
        });
      }
      if (!hasDuration && !hasDistance && typeof duration === 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'durationSec or distanceMeters is required.',
        });
      }
    }
  });

export async function GET(_request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireWorkoutLibraryAdmin();
    const id = context.params.id;

    const item = await prisma.workoutLibrarySession.findUnique({
      where: { id },
    });

    if (!item) throw notFound('Library session not found.');

    return success({ item });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireWorkoutLibraryAdmin();
    const id = context.params.id;
    const payload = patchSchema.parse(await request.json());

    const existing = await prisma.workoutLibrarySession.findUnique({
      where: { id },
      select: { id: true, durationSec: true, distanceMeters: true },
    });

    if (!existing) throw notFound('Library session not found.');

    const durationAfter = payload.durationSec ?? existing.durationSec;
    const distanceAfter =
      payload.distanceMeters !== undefined ? payload.distanceMeters : existing.distanceMeters;

    const hasDurationAfter = typeof durationAfter === 'number' && durationAfter > 0;
    const hasDistanceAfter = typeof distanceAfter === 'number' && distanceAfter > 0;

    if (!hasDurationAfter && !hasDistanceAfter) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'durationSec or distanceMeters is required.');
    }

    const updated = await prisma.workoutLibrarySession.update({
      where: { id },
      data: {
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.discipline !== undefined ? { discipline: payload.discipline } : {}),
        ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.durationSec !== undefined ? { durationSec: payload.durationSec } : {}),
        ...(payload.intensityTarget !== undefined ? { intensityTarget: payload.intensityTarget } : {}),
        ...(payload.distanceMeters !== undefined ? { distanceMeters: payload.distanceMeters } : {}),
        ...(payload.elevationGainMeters !== undefined ? { elevationGainMeters: payload.elevationGainMeters } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        ...(payload.equipment !== undefined ? { equipment: payload.equipment } : {}),
        ...(payload.workoutStructure !== undefined
          ? {
              workoutStructure:
                payload.workoutStructure === null ? Prisma.DbNull : payload.workoutStructure,
            }
          : {}),
      },
    });

    return success({ item: updated });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireWorkoutLibraryAdmin();
    const id = context.params.id;

    // Cascade handles favorites/usage.
    await prisma.workoutLibrarySession.delete({
      where: { id },
    });

    return success({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
