import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibraryDiscipline } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';
import { deriveIntensityCategory, normalizeEquipment, normalizeTags } from '@/lib/workout-library-taxonomy';

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
    const discipline = (searchParams.get('discipline') ?? '').trim();
    const tagContains = (searchParams.get('tag') ?? '').trim();

    const disciplineFilter = discipline
      ? z.nativeEnum(WorkoutLibraryDiscipline).safeParse(discipline)
      : null;

    if (disciplineFilter && !disciplineFilter.success) {
      return success({ items: [] });
    }

    const items = await prisma.workoutLibrarySession.findMany({
      where: {
        ...(q
          ? {
              title: {
                contains: q,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(disciplineFilter?.success
          ? {
              discipline: disciplineFilter.data,
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: tagContains ? 500 : 200,
      include: {
        _count: {
          select: {
            usage: true,
          },
        },
      },
    });

    const filtered = tagContains
      ? items.filter((item) =>
          item.tags.some((tag) => tag.toLowerCase().includes(tagContains.toLowerCase()))
        )
      : items;

    const responseItems = filtered.slice(0, 200).map((item) => {
      const { _count, ...rest } = item;
      return {
        ...rest,
        usageCount: _count.usage,
      };
    });

    return success({ items: responseItems });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireWorkoutLibraryAdmin();
    const payload = createSchema.parse(await request.json());

    const tags = normalizeTags(payload.tags);
    const equipment = normalizeEquipment(payload.equipment);
    const intensityCategory = deriveIntensityCategory(payload.intensityTarget);

    const created = await prisma.workoutLibrarySession.create({
      data: {
        title: payload.title,
        discipline: payload.discipline,
        tags,
        description: payload.description,
        durationSec: payload.durationSec ?? 0,
        intensityTarget: payload.intensityTarget,
        intensityCategory,
        distanceMeters: payload.distanceMeters ?? null,
        elevationGainMeters: payload.elevationGainMeters ?? null,
        notes: payload.notes ?? null,
        equipment,
        workoutStructure: payload.workoutStructure ?? undefined,
        createdByUserId: user.id,
      },
    });

    return success({ item: created }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
