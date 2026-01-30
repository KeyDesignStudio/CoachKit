import { z } from 'zod';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';

export const athletePublishAckSchema = z.object({
  aiPlanDraftId: z.string().min(1),
  lastSeenPublishedHash: z.string().min(1),
});

export async function getAthletePublishStatus(params: { athleteId: string; aiPlanDraftId: string }) {
  requireAiPlanBuilderV1Enabled();

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

  return {
    publishedAt: draft.publishedAt,
    lastPublishedHash: draft.lastPublishedHash,
    lastPublishedSummaryText: draft.lastPublishedSummaryText,
    athleteLastSeenHash: ack?.lastSeenPublishedHash ?? null,
    athleteLastSeenAt: ack?.lastSeenAt ?? null,
  };
}

export async function ackAthletePublish(params: {
  athleteId: string;
  aiPlanDraftId: string;
  lastSeenPublishedHash: string;
  now?: Date;
}) {
  requireAiPlanBuilderV1Enabled();

  const now = params.now ?? new Date();

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: {
      id: true,
      athleteId: true,
      visibilityStatus: true,
      lastPublishedHash: true,
    },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.visibilityStatus !== 'PUBLISHED') {
    throw new ApiError(404, 'NOT_FOUND', 'Published plan not found.');
  }

  if (!draft.lastPublishedHash) {
    throw new ApiError(409, 'NOT_PUBLISHED', 'Plan has no published hash.');
  }

  if (params.lastSeenPublishedHash !== draft.lastPublishedHash) {
    throw new ApiError(409, 'HASH_MISMATCH', 'Ack hash must match the latest published hash.');
  }

  const ack = await prisma.aiPlanPublishAck.upsert({
    where: { athleteId_draftId: { athleteId: params.athleteId, draftId: draft.id } },
    update: {
      lastSeenPublishedHash: params.lastSeenPublishedHash,
      lastSeenAt: now,
    },
    create: {
      athleteId: params.athleteId,
      draftId: draft.id,
      lastSeenPublishedHash: params.lastSeenPublishedHash,
      lastSeenAt: now,
    },
    select: { lastSeenPublishedHash: true, lastSeenAt: true },
  });

  return ack;
}
