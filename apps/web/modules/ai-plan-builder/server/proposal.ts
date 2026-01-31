import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';

export const createProposalSchema = z.object({
  proposalJson: z.unknown(),
  draftPlanId: z.string().min(1).optional(),
  targetPlanRef: z.string().min(1).optional(),
});

export async function createPlanChangeProposal(params: {
  coachId: string;
  athleteId: string;
  proposalJson: unknown;
  draftPlanId?: string;
  targetPlanRef?: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  if (params.draftPlanId) {
    const draft = await prisma.aiPlanDraft.findUnique({
      where: { id: params.draftPlanId },
      select: { id: true, athleteId: true, coachId: true },
    });

    if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
      throw new ApiError(400, 'INVALID_DRAFT_PLAN', 'draftPlanId must belong to the same athlete/coach.');
    }
  }

  return prisma.planChangeProposal.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      status: 'DRAFT',
      proposalJson: params.proposalJson as Prisma.InputJsonValue,
      draftPlanId: params.draftPlanId ?? null,
      targetPlanRef: params.targetPlanRef ?? null,
    },
  });
}
