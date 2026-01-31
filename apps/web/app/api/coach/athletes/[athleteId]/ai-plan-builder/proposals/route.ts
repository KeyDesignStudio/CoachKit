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
    const limit = Number(url.searchParams.get('limit') ?? '');
    const offset = Number(url.searchParams.get('offset') ?? '');
    if (!aiPlanDraftId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'aiPlanDraftId is required.');
    }

    const proposals = await listPlanChangeProposals({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });

    return success({ proposals });
  } catch (error) {
    return handleError(error);
  }
}
