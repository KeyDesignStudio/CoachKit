import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';

export async function getLatestPublishedAiPlanForAthlete(params: { athleteId: string }) {
  requireAiPlanBuilderV1Enabled();

  return prisma.aiPlanDraft.findFirst({
    where: { athleteId: params.athleteId, visibilityStatus: 'PUBLISHED' },
    orderBy: [{ publishedAt: 'desc' }],
    include: {
      weeks: { orderBy: [{ weekIndex: 'asc' }] },
      sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
    },
  });
}

export async function getPublishedAiPlanForAthlete(params: { athleteId: string; aiPlanDraftId: string }) {
  requireAiPlanBuilderV1Enabled();

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    include: {
      weeks: { orderBy: [{ weekIndex: 'asc' }] },
      sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
    },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.visibilityStatus !== 'PUBLISHED') {
    throw new ApiError(404, 'NOT_FOUND', 'Published plan not found.');
  }

  return draft;
}

export async function getPublishedAiPlanSessionForAthlete(params: {
  athleteId: string;
  aiPlanDraftId: string;
  draftSessionId: string;
}) {
  requireAiPlanBuilderV1Enabled();

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: {
      id: true,
      athleteId: true,
      coachId: true,
      visibilityStatus: true,
    },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.visibilityStatus !== 'PUBLISHED') {
    throw new ApiError(404, 'NOT_FOUND', 'Published plan not found.');
  }

  const session = await prisma.aiPlanDraftSession.findUnique({
    where: { id: params.draftSessionId },
  });

  if (!session || session.draftId !== draft.id) {
    throw new ApiError(404, 'NOT_FOUND', 'Session not found.');
  }

  return { draft, session };
}
