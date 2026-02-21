import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { applySafeQueuedRecommendations } from '@/modules/ai-plan-builder/server/proposals';

const applySafeSchema = z.object({
  aiPlanDraftId: z.string().min(1),
  maxHours: z.number().int().min(1).max(168).optional(),
  maxToApply: z.number().int().min(1).max(25).optional(),
});

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = applySafeSchema.parse(await request.json().catch(() => ({})));

    const result = await applySafeQueuedRecommendations({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: body.aiPlanDraftId,
      maxHours: body.maxHours,
      maxToApply: body.maxToApply,
    });

    return success(result);
  } catch (error) {
    return handleError(error);
  }
}
