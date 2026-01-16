import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibraryDiscipline } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';

export const dynamic = 'force-dynamic';

const createSchema = z
  .object({
    title: z.string().trim().min(1),
    discipline: z.nativeEnum(WorkoutLibraryDiscipline),
    tags: z.array(z.string().trim().min(1)).default([]),
    description: z.string().trim().min(1),
    durationSec: z.number().int().positive().optional(),
    intensityTarget: z.string().trim().min(1),
    distanceMeters: z.number().positive().optional().nullable(),
    elevationGainMeters: z.number().nonnegative().optional().nullable(),
    notes: z.string().trim().max(20000).optional().nullable(),
    equipment: z.array(z.string().trim().min(1)).default([]),
    workoutStructure: z.unknown().optional().nullable(),
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

export async function GET(request: NextRequest) {
  try {
    await requireWorkoutLibraryAdmin();

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') ?? '').trim();

    const items = await prisma.workoutLibrarySession.findMany({
      where: q
        ? {
            title: {
              contains: q,
              mode: 'insensitive',
            },
          }
        : {},
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    return success({ items });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireWorkoutLibraryAdmin();
    const payload = createSchema.parse(await request.json());

    const created = await prisma.workoutLibrarySession.create({
      data: {
        title: payload.title,
        discipline: payload.discipline,
        tags: payload.tags,
        description: payload.description,
        durationSec: payload.durationSec ?? 0,
        intensityTarget: payload.intensityTarget,
        distanceMeters: payload.distanceMeters ?? null,
        elevationGainMeters: payload.elevationGainMeters ?? null,
        notes: payload.notes ?? null,
        equipment: payload.equipment,
        workoutStructure: payload.workoutStructure ?? undefined,
        createdByUserId: user.id,
      },
    });

    return success({ item: created }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
