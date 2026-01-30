import { z } from 'zod';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';

import { computeStableSha256 } from '../rules/stable-hash';
import { summarizePlanChanges } from '../rules/publish-summary';

export const publishDraftPlanSchema = z.object({
  aiPlanDraftId: z.string().min(1),
});

export async function publishAiDraftPlan(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  now?: Date;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const draft = await tx.aiPlanDraft.findUnique({
      where: { id: params.aiPlanDraftId },
      select: {
        id: true,
        athleteId: true,
        coachId: true,
        planJson: true,
        visibilityStatus: true,
        publishedAt: true,
        lastPublishedHash: true,
      },
    });

    if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
      throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
    }

    const hash = computeStableSha256(draft.planJson);

    // Idempotency: if unchanged since last publish, keep publishedAt stable.
    if (draft.visibilityStatus === 'PUBLISHED' && draft.lastPublishedHash && draft.lastPublishedHash === hash) {
      const unchanged = await tx.aiPlanDraft.update({
        where: { id: draft.id },
        data: {
          visibilityStatus: 'PUBLISHED',
          lastPublishedSummaryText: 'No changes',
        },
        include: {
          weeks: { orderBy: [{ weekIndex: 'asc' }] },
          sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
        },
      });

      return { draft: unchanged, published: false, summaryText: 'No changes', hash };
    }

    const previous = await tx.aiPlanDraftPublishSnapshot.findFirst({
      where: { draftId: draft.id },
      orderBy: [{ publishedAt: 'desc' }],
      select: { hash: true, planJson: true },
    });

    const summaryText = previous ? summarizePlanChanges(previous.planJson, draft.planJson) : 'Initial publish';

    const updated = await tx.aiPlanDraft.update({
      where: { id: draft.id },
      data: {
        visibilityStatus: 'PUBLISHED',
        publishedAt: now,
        publishedByCoachId: params.coachId ?? null,
        lastPublishedHash: hash,
        lastPublishedSummaryText: summaryText,
        publishSnapshots: {
          create: {
            athleteId: draft.athleteId,
            coachId: draft.coachId,
            hash,
            planJson: draft.planJson as Prisma.InputJsonValue,
            summaryText,
            publishedAt: now,
            publishedByCoachId: params.coachId ?? null,
          },
        },
      },
      include: {
        weeks: { orderBy: [{ weekIndex: 'asc' }] },
        sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
      },
    });

    return { draft: updated, published: true, summaryText, hash };
  });
}

export async function getDraftPublishStatus(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: {
      id: true,
      athleteId: true,
      coachId: true,
      visibilityStatus: true,
      publishedAt: true,
      publishedByCoachId: true,
      lastPublishedHash: true,
      lastPublishedSummaryText: true,
    },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  return draft;
}
