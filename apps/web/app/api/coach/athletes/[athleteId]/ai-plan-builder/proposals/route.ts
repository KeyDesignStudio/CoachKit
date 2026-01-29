import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { listPlanChangeProposals } from '@/modules/ai-plan-builder/server/proposals';

export async function GET(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const url = new URL(request.url);
    const aiPlanDraftId = String(url.searchParams.get('aiPlanDraftId') ?? '').trim();
    if (!aiPlanDraftId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'aiPlanDraftId is required.');
    }

    const proposals = await listPlanChangeProposals({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId,
    });

    return success({ proposals });
  } catch (error) {
    return handleError(error);
  }
}
