import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getLatestAiDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';

export async function GET(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const { searchParams } = new URL(request.url);
    const includeDetails = searchParams.get('includeDetails') === '1';

    const draftPlan = await getLatestAiDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      includeDetails,
    });

    return success({ draftPlan });
  } catch (error) {
    return handleError(error);
  }
}
