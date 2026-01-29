import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';

export const createAthleteSessionFeedbackSchema = z.object({
  aiPlanDraftId: z.string().min(1),
  draftSessionId: z.string().min(1),
  completedStatus: z.enum(['DONE', 'PARTIAL', 'SKIPPED']),
  rpe: z.number().int().min(0).max(10).nullable().optional(),
  feel: z.enum(['EASY', 'OK', 'HARD', 'TOO_HARD']).nullable().optional(),
  sorenessFlag: z.boolean().default(false),
  sorenessNotes: z.string().max(10_000).nullable().optional(),
  sleepQuality: z.number().int().min(0).max(10).nullable().optional(),
});

export async function createAthleteSessionFeedback(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  draftSessionId: string;
  completedStatus: 'DONE' | 'PARTIAL' | 'SKIPPED';
  rpe?: number | null;
  feel?: 'EASY' | 'OK' | 'HARD' | 'TOO_HARD' | null;
  sorenessFlag: boolean;
  sorenessNotes?: string | null;
  sleepQuality?: number | null;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const [draft, session] = await Promise.all([
    prisma.aiPlanDraft.findUnique({
      where: { id: params.aiPlanDraftId },
      select: { id: true, athleteId: true, coachId: true },
    }),
    prisma.aiPlanDraftSession.findUnique({
      where: { id: params.draftSessionId },
      select: { id: true, draftId: true },
    }),
  ]);

  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  if (!session || session.draftId !== draft.id) {
    throw new ApiError(400, 'INVALID_DRAFT_SESSION', 'draftSessionId must belong to aiPlanDraftId.');
  }

  return prisma.athleteSessionFeedback.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      draftId: draft.id,
      sessionId: session.id,
      completedStatus: params.completedStatus,
      rpe: params.rpe ?? null,
      feel: params.feel ?? null,
      sorenessFlag: params.sorenessFlag,
      sorenessNotes: params.sorenessNotes ?? null,
      sleepQuality: params.sleepQuality ?? null,
    },
  });
}

export async function listAthleteSessionFeedback(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  limit?: number;
  offset?: number;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: { id: true, athleteId: true, coachId: true },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  const limit = Math.max(1, Math.min(200, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);

  return prisma.athleteSessionFeedback.findMany({
    where: { athleteId: params.athleteId, coachId: params.coachId, draftId: draft.id },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    skip: offset,
  });
}

export async function createAthleteSessionFeedbackAsAthlete(params: {
  athleteId: string;
  aiPlanDraftId: string;
  draftSessionId: string;
  completedStatus: 'DONE' | 'PARTIAL' | 'SKIPPED';
  rpe?: number | null;
  feel?: 'EASY' | 'OK' | 'HARD' | 'TOO_HARD' | null;
  sorenessFlag: boolean;
  sorenessNotes?: string | null;
  sleepQuality?: number | null;
}) {
  requireAiPlanBuilderV1Enabled();

  const [draft, session] = await Promise.all([
    prisma.aiPlanDraft.findUnique({
      where: { id: params.aiPlanDraftId },
      select: { id: true, athleteId: true, coachId: true, visibilityStatus: true },
    }),
    prisma.aiPlanDraftSession.findUnique({
      where: { id: params.draftSessionId },
      select: { id: true, draftId: true },
    }),
  ]);

  if (!draft || draft.athleteId !== params.athleteId || draft.visibilityStatus !== 'PUBLISHED') {
    throw new ApiError(404, 'NOT_FOUND', 'Published plan not found.');
  }

  if (!session || session.draftId !== draft.id) {
    throw new ApiError(400, 'INVALID_DRAFT_SESSION', 'draftSessionId must belong to aiPlanDraftId.');
  }

  return prisma.athleteSessionFeedback.create({
    data: {
      athleteId: params.athleteId,
      coachId: draft.coachId,
      draftId: draft.id,
      sessionId: session.id,
      completedStatus: params.completedStatus,
      rpe: params.rpe ?? null,
      feel: params.feel ?? null,
      sorenessFlag: params.sorenessFlag,
      sorenessNotes: params.sorenessNotes ?? null,
      sleepQuality: params.sleepQuality ?? null,
    },
  });
}

export async function listAthleteSessionFeedbackAsAthlete(params: {
  athleteId: string;
  aiPlanDraftId: string;
  limit?: number;
  offset?: number;
}) {
  requireAiPlanBuilderV1Enabled();

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: { id: true, athleteId: true, coachId: true, visibilityStatus: true },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.visibilityStatus !== 'PUBLISHED') {
    throw new ApiError(404, 'NOT_FOUND', 'Published plan not found.');
  }

  const limit = Math.max(1, Math.min(200, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);

  return prisma.athleteSessionFeedback.findMany({
    where: { athleteId: params.athleteId, coachId: draft.coachId, draftId: draft.id },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    skip: offset,
  });
}
