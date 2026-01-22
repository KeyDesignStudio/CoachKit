import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibraryDiscipline, WorkoutLibrarySource, WorkoutLibrarySessionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';
import { deriveIntensityCategory, normalizeEquipment, normalizeTags } from '@/lib/workout-library-taxonomy';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  // Prompt templates (primary use-case)
  title: z.string().trim().min(1),
  discipline: z.nativeEnum(WorkoutLibraryDiscipline),
  category: z.string().trim().min(1),
  description: z.string().min(1),

  // Metadata
  status: z.nativeEnum(WorkoutLibrarySessionStatus).default(WorkoutLibrarySessionStatus.DRAFT),
  source: z.nativeEnum(WorkoutLibrarySource).default(WorkoutLibrarySource.MANUAL),
  tags: z.array(z.string().trim().min(1)).default([]),
  equipment: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().max(20000).optional().nullable(),

  // Optional structured fields (allowed, but not required for prompt templates)
  durationSec: z.number().int().nonnegative().optional(),
  intensityTarget: z.string().max(2000).optional(),
  distanceMeters: z.number().positive().optional().nullable(),
  elevationGainMeters: z.number().nonnegative().optional().nullable(),
  workoutStructure: z.unknown().optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    await requireWorkoutLibraryAdmin();

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') ?? '').trim();
    const discipline = (searchParams.get('discipline') ?? '').trim();
    const tagContains = (searchParams.get('tag') ?? '').trim();
    const status = (searchParams.get('status') ?? '').trim().toUpperCase();

    const disciplineFilter = discipline
      ? z.nativeEnum(WorkoutLibraryDiscipline).safeParse(discipline)
      : null;

    const statusFilter = status
      ? z.nativeEnum(WorkoutLibrarySessionStatus).safeParse(status)
      : null;

    if (disciplineFilter && !disciplineFilter.success) {
      return success({ items: [] });
    }

    if (statusFilter && !statusFilter.success) {
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
        ...(statusFilter?.success
          ? {
              status: statusFilter.data,
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
    const intensityTarget = (payload.intensityTarget ?? '').trim();
    const intensityCategory = intensityTarget ? deriveIntensityCategory(intensityTarget) : null;

    const created = await prisma.workoutLibrarySession.create({
      data: {
        title: payload.title,
        discipline: payload.discipline,
        status: payload.status,
        source: payload.source,
        tags,
        category: payload.category,
        description: payload.description,
        durationSec: payload.durationSec ?? 0,
        intensityTarget,
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
