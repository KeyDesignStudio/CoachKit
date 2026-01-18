import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibrarySource, WorkoutLibrarySessionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { failure, handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    source: z.nativeEnum(WorkoutLibrarySource).optional(),
    ids: z.array(z.string().min(1)).optional(),
    confirmApply: z.boolean().default(false),
    allowMoreThanCap: z.boolean().default(false),
  })
  .superRefine((body, ctx) => {
    if (!body.source && (!body.ids || body.ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either source or ids.',
      });
    }

    if (body.source && body.ids && body.ids.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide only one of source or ids.',
      });
    }
  });

type UnpublishSummary = {
  matchedCount: number;
  unpublishedCount: number;
  alreadyDraftCount: number;
  errors: string[];
};

const SOURCE_UNPUBLISH_CAP = 500;

export async function POST(request: NextRequest) {
  try {
    await requireWorkoutLibraryAdmin();

    const body = bodySchema.parse(await request.json());

    if (body.confirmApply !== true) {
      return failure('CONFIRM_REQUIRED', 'confirmApply=true is required to unpublish workouts.', 400);
    }

    const baseWhere = body.ids
      ? {
          id: { in: body.ids },
        }
      : {
          source: body.source,
        };

    const [matchedCount, publishedCount, alreadyDraftCount] = await prisma.$transaction([
      prisma.workoutLibrarySession.count({ where: baseWhere }),
      prisma.workoutLibrarySession.count({
        where: {
          ...baseWhere,
          status: WorkoutLibrarySessionStatus.PUBLISHED,
        },
      }),
      prisma.workoutLibrarySession.count({
        where: {
          ...baseWhere,
          status: WorkoutLibrarySessionStatus.DRAFT,
        },
      }),
    ]);

    if (!body.ids && publishedCount > SOURCE_UNPUBLISH_CAP && body.allowMoreThanCap !== true) {
      return failure(
        'UNPUBLISH_CAP_EXCEEDED',
        `Refusing to unpublish ${publishedCount} workouts for source=${body.source}. Cap is ${SOURCE_UNPUBLISH_CAP}. Set allowMoreThanCap=true to override.`,
        400
      );
    }

    const updated = await prisma.workoutLibrarySession.updateMany({
      where: {
        ...baseWhere,
        status: WorkoutLibrarySessionStatus.PUBLISHED,
      },
      data: {
        status: WorkoutLibrarySessionStatus.DRAFT,
        publishedAt: null,
        publishedByUserId: null,
      },
    });

    const summary: UnpublishSummary = {
      matchedCount,
      unpublishedCount: updated.count,
      alreadyDraftCount,
      errors: [],
    };

    return success(summary);
  } catch (error) {
    return handleError(error);
  }
}
