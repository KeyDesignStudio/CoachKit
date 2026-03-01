import { NextRequest } from 'next/server';
import { AssistantActionType, AssistantDetectionState, type Prisma } from '@prisma/client';
import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { getCoachDetectionOrThrow } from '@/modules/assistant/server/detections';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  recommendationId: z.string().trim().min(1),
  aggressiveness: z.enum(['conservative', 'standard', 'aggressive']).default('standard'),
  aiPlanDraftId: z.string().trim().min(1).optional(),
});

function tryDiffJson(details: unknown): Prisma.InputJsonValue | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const diff = (details as Record<string, unknown>).diffJson;
  if (!Array.isArray(diff)) return undefined;
  return diff as unknown as Prisma.InputJsonValue;
}

export async function POST(request: NextRequest, context: { params: Promise<{ detectionId: string }> }) {
  try {
    const { user } = await requireCoach();
    const { detectionId } = await context.params;
    const payload = bodySchema.parse(await request.json());

    const detection = await getCoachDetectionOrThrow({ detectionId, coachId: user.id });
    const recommendation = detection.recommendations.find((row) => row.id === payload.recommendationId);

    if (!recommendation) {
      throw new ApiError(404, 'NOT_FOUND', 'Recommendation not found for this detection.');
    }

    const aiPlanDraft = payload.aiPlanDraftId
      ? await prisma.aiPlanDraft.findFirst({
          where: {
            id: payload.aiPlanDraftId,
            coachId: user.id,
            athleteId: detection.athleteId,
          },
          select: { id: true },
        })
      : await prisma.aiPlanDraft.findFirst({
          where: {
            coachId: user.id,
            athleteId: detection.athleteId,
          },
          orderBy: [{ updatedAt: 'desc' }],
          select: { id: true },
        });

    if (!aiPlanDraft) {
      throw new ApiError(
        400,
        'AI_PLAN_DRAFT_REQUIRED',
        'No AI draft plan available for this athlete. Create or publish an AI plan draft first.'
      );
    }

    const proposal = await prisma.planChangeProposal.create({
      data: {
        athleteId: detection.athleteId,
        coachId: user.id,
        draftPlanId: aiPlanDraft.id,
        status: 'PROPOSED',
        rationaleText: `Assistant recommendation: ${recommendation.title}`,
        proposalJson: {
          source: 'assistant_recommendation',
          sourceRefId: detection.id,
          recommendationId: recommendation.id,
          aggressiveness: payload.aggressiveness,
          recommendationType: recommendation.recommendationType,
          recommendationDetails: recommendation.details,
        } as Prisma.InputJsonValue,
        diffJson: tryDiffJson(recommendation.details),
      },
      select: {
        id: true,
        status: true,
        draftPlanId: true,
        rationaleText: true,
        diffJson: true,
        createdAt: true,
      },
    });

    await prisma.$transaction([
      prisma.assistantDetection.update({
        where: { id: detection.id },
        data: {
          state: AssistantDetectionState.ACTIONED,
        },
      }),
      prisma.assistantAction.create({
        data: {
          coachId: user.id,
          athleteId: detection.athleteId,
          detectionId: detection.id,
          actionType: AssistantActionType.APPLY_PLAN_CHANGE,
          actionPayload: {
            proposalId: proposal.id,
            recommendationId: recommendation.id,
            aiPlanDraftId: aiPlanDraft.id,
            aggressiveness: payload.aggressiveness,
          },
        },
      }),
    ]);

    return success({
      proposal,
      source: {
        detectionId: detection.id,
        recommendationId: recommendation.id,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
