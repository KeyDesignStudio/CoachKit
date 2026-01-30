import { requireAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getAthletePublishStatus } from '@/modules/ai-plan-builder/server/publish-ack';

export async function GET(request: Request) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireAthlete();

    const url = new URL(request.url);
    const aiPlanDraftId = String(url.searchParams.get('aiPlanDraftId') ?? '').trim();

    if (!aiPlanDraftId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'aiPlanDraftId is required.');
    }

    const status = await getAthletePublishStatus({ athleteId: user.id, aiPlanDraftId });

    return success({ publishStatus: status });
  } catch (error) {
    return handleError(error);
  }
}
