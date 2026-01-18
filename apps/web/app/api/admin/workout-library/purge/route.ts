import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibrarySource, WorkoutLibrarySessionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { failure, handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  dryRun: z.boolean().default(true),
  confirmApply: z.boolean().default(false),
  source: z.nativeEnum(WorkoutLibrarySource),
  onlyDrafts: z.boolean().default(true),
});

type PurgeSummary = {
  dryRun: boolean;
  source: WorkoutLibrarySource;
  onlyDrafts: boolean;
  wouldDelete: number;
  deletedCount: number;
};

export async function POST(request: NextRequest) {
  try {
    await requireWorkoutLibraryAdmin();

    const body = bodySchema.parse(await request.json());

    if (!body.dryRun && !body.confirmApply) {
      return failure('CONFIRM_APPLY_REQUIRED', 'confirmApply is required when dryRun=false.', 400);
    }

    const where = {
      source: body.source,
      ...(body.onlyDrafts ? { status: WorkoutLibrarySessionStatus.DRAFT } : {}),
    };

    const wouldDelete = await prisma.workoutLibrarySession.count({ where });

    if (body.dryRun) {
      const summary: PurgeSummary = {
        dryRun: true,
        source: body.source,
        onlyDrafts: body.onlyDrafts,
        wouldDelete,
        deletedCount: 0,
      };
      return success(summary);
    }

    const deleted = await prisma.workoutLibrarySession.deleteMany({ where });

    const summary: PurgeSummary = {
      dryRun: false,
      source: body.source,
      onlyDrafts: body.onlyDrafts,
      wouldDelete,
      deletedCount: deleted.count,
    };

    return success(summary);
  } catch (error) {
    return handleError(error);
  }
}
