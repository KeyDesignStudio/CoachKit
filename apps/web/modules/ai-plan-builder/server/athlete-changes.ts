import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';

export const athleteChangesQuerySchema = z.object({
  aiPlanDraftId: z.string().min(1),
  limit: z.number().int().min(1).max(10).default(10),
});

export async function getAthleteAiPlanChanges(params: { athleteId: string; aiPlanDraftId: string; limit?: number }) {
  requireAiPlanBuilderV1Enabled();

  const limit = Math.max(1, Math.min(10, params.limit ?? 10));

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: {
      id: true,
      athleteId: true,
      visibilityStatus: true,
      publishedAt: true,
      lastPublishedHash: true,
      lastPublishedSummaryText: true,
    },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.visibilityStatus !== 'PUBLISHED') {
    throw new ApiError(404, 'NOT_FOUND', 'Published plan not found.');
  }

  const ack = await prisma.aiPlanPublishAck.findUnique({
    where: { athleteId_draftId: { athleteId: params.athleteId, draftId: draft.id } },
    select: { lastSeenPublishedHash: true, lastSeenAt: true },
  });

  const audits = await prisma.planChangeAudit.findMany({
    where: {
      athleteId: params.athleteId,
      draftPlanId: draft.id,
      ...(ack?.lastSeenAt ? { createdAt: { gt: ack.lastSeenAt } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: { id: true, createdAt: true, changeSummaryText: true },
  });

  return {
    lastPublishedAt: draft.publishedAt,
    lastPublishedSummaryText: draft.lastPublishedSummaryText,
    athleteLastSeenPublishedHash: ack?.lastSeenPublishedHash ?? null,
    audits: audits.map((a) => ({
      createdAt: a.createdAt.toISOString(),
      changeSummaryText: a.changeSummaryText,
    })),
  };
}
