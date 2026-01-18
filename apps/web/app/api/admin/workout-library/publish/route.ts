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

type PublishSummary = {
  matchedCount: number;
  publishedCount: number;
  alreadyPublishedCount: number;
  errors: string[];
};

const SOURCE_PUBLISH_CAP = 500;

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireWorkoutLibraryAdmin();

    const body = bodySchema.parse(await request.json());

    if (body.confirmApply !== true) {
      return failure('CONFIRM_REQUIRED', 'confirmApply=true is required to publish drafts.', 400);
    }

    const now = new Date();

    const baseWhere = body.ids
      ? {
          id: { in: body.ids },
        }
      : {
          source: body.source,
        };

    const [matchedCount, draftCount, alreadyPublishedCount] = await prisma.$transaction([
      prisma.workoutLibrarySession.count({ where: baseWhere }),
      prisma.workoutLibrarySession.count({
        where: {
          ...baseWhere,
          status: WorkoutLibrarySessionStatus.DRAFT,
        },
      }),
      prisma.workoutLibrarySession.count({
        where: {
          ...baseWhere,
          status: WorkoutLibrarySessionStatus.PUBLISHED,
        },
      }),
    ]);

    // Safety: publishing by source can touch a lot of rows.
    if (!body.ids && draftCount > SOURCE_PUBLISH_CAP && body.allowMoreThanCap !== true) {
      return failure(
        'PUBLISH_CAP_EXCEEDED',
        `Refusing to publish ${draftCount} drafts for source=${body.source}. Cap is ${SOURCE_PUBLISH_CAP}. Set allowMoreThanCap=true to override.`,
        400
      );
    }

    const updated = await prisma.workoutLibrarySession.updateMany({
      where: {
        ...baseWhere,
        status: WorkoutLibrarySessionStatus.DRAFT,
      },
      data: {
        status: WorkoutLibrarySessionStatus.PUBLISHED,
        publishedAt: now,
        publishedByUserId: user.id,
      },
    });

    const summary: PublishSummary = {
      matchedCount,
      publishedCount: updated.count,
      alreadyPublishedCount,
      errors: [],
    };

    return success(summary);
  } catch (error) {
    return handleError(error);
  }
}
