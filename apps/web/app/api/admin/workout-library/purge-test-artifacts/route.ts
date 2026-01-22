import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z
  .object({
    confirmApply: z.boolean().optional(),
  })
  .optional();

type PurgeTestArtifactsSummary = {
  dryRun: boolean;
  matchedCount: number;
  deletedCount: number;
  sampleIds: string[];
  sampleTitles: string[];
};

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    const body = bodySchema.parse(await request.json().catch(() => undefined));
    const confirmApply = body?.confirmApply === true;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);

    const where = {
      title: { startsWith: 'PW Publish Draft' },
      createdAt: { gte: thirtyDaysAgo },
    } as const;

    const [matchedCount, sample] = await prisma.$transaction([
      prisma.workoutLibrarySession.count({ where }),
      prisma.workoutLibrarySession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, title: true },
      }),
    ]);

    const sampleIds = sample.map((s) => s.id);
    const sampleTitles = sample.map((s) => s.title);

    if (!confirmApply) {
      const summary: PurgeTestArtifactsSummary = {
        dryRun: true,
        matchedCount,
        deletedCount: 0,
        sampleIds,
        sampleTitles,
      };
      return success(summary);
    }

    const deleted = await prisma.workoutLibrarySession.deleteMany({ where });

    const summary: PurgeTestArtifactsSummary = {
      dryRun: false,
      matchedCount,
      deletedCount: deleted.count,
      sampleIds,
      sampleTitles,
    };

    return success(summary);
  } catch (error) {
    return handleError(error);
  }
}
