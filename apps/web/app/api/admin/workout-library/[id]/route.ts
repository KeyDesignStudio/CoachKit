import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibraryDiscipline, WorkoutLibrarySource, WorkoutLibrarySessionStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';
import { deriveIntensityCategory, normalizeEquipment, normalizeTags } from '@/lib/workout-library-taxonomy';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    discipline: z.nativeEnum(WorkoutLibraryDiscipline).optional(),
    status: z.nativeEnum(WorkoutLibrarySessionStatus).optional(),
    source: z.nativeEnum(WorkoutLibrarySource).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    category: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    durationSec: z.number().int().nonnegative().optional(),
    intensityTarget: z.string().max(2000).optional(),
    distanceMeters: z.number().positive().nullable().optional(),
    elevationGainMeters: z.number().nonnegative().nullable().optional(),
    notes: z.string().trim().max(20000).nullable().optional(),
    equipment: z.array(z.string().trim().min(1)).optional(),
    workoutStructure: z.unknown().nullable().optional(),
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

    const normalizedTags = payload.tags !== undefined ? normalizeTags(payload.tags) : undefined;
    const normalizedEquipment = payload.equipment !== undefined ? normalizeEquipment(payload.equipment) : undefined;

    const intensityTargetTrimmed =
      payload.intensityTarget !== undefined ? (payload.intensityTarget ?? '').trim() : undefined;
    const intensityCategory =
      intensityTargetTrimmed !== undefined
        ? intensityTargetTrimmed
          ? deriveIntensityCategory(intensityTargetTrimmed)
          : null
        : undefined;

    const existing = await prisma.workoutLibrarySession.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) throw notFound('Library session not found.');

    const updated = await prisma.workoutLibrarySession.update({
      where: { id },
      data: {
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.discipline !== undefined ? { discipline: payload.discipline } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.source !== undefined ? { source: payload.source } : {}),
        ...(normalizedTags !== undefined ? { tags: normalizedTags } : {}),
        ...(payload.category !== undefined ? { category: payload.category } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.durationSec !== undefined ? { durationSec: payload.durationSec } : {}),
        ...(intensityTargetTrimmed !== undefined ? { intensityTarget: intensityTargetTrimmed } : {}),
        ...(intensityCategory !== undefined ? { intensityCategory } : {}),
        ...(payload.distanceMeters !== undefined ? { distanceMeters: payload.distanceMeters } : {}),
        ...(payload.elevationGainMeters !== undefined ? { elevationGainMeters: payload.elevationGainMeters } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        ...(normalizedEquipment !== undefined ? { equipment: normalizedEquipment } : {}),
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
