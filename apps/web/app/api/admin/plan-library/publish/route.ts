import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibrarySource, WorkoutLibrarySessionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  confirmApply: z.boolean().default(false),
  allowMoreThanCap: z.boolean().default(false),
});

type PublishSummary = {
  matchedCount: number;
  publishedCount: number;
  alreadyPublishedCount: number;
  errors: string[];
};

const PUBLISH_CAP = 500;

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdmin();

    const body = bodySchema.parse(await request.json());

    if (body.confirmApply !== true) {
      return failure('CONFIRM_REQUIRED', 'confirmApply=true is required to publish PLAN_LIBRARY drafts.', 400);
    }

    const now = new Date();

    const baseWhere = { source: WorkoutLibrarySource.PLAN_LIBRARY };

    const [matchedCount, draftCount, alreadyPublishedCount] = await prisma.$transaction([
      prisma.workoutLibrarySession.count({ where: baseWhere }),
      prisma.workoutLibrarySession.count({ where: { ...baseWhere, status: WorkoutLibrarySessionStatus.DRAFT } }),
      prisma.workoutLibrarySession.count({ where: { ...baseWhere, status: WorkoutLibrarySessionStatus.PUBLISHED } }),
    ]);

    if (draftCount > PUBLISH_CAP && body.allowMoreThanCap !== true) {
      return failure(
        'PUBLISH_CAP_EXCEEDED',
        `Refusing to publish ${draftCount} PLAN_LIBRARY drafts. Cap is ${PUBLISH_CAP}. Set allowMoreThanCap=true to override.`,
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
