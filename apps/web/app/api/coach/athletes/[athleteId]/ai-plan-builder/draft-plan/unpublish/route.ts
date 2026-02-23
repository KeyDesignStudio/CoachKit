import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { unpublishAiDraftPlan, unpublishDraftPlanSchema } from '@/modules/ai-plan-builder/server/publish';

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const body = unpublishDraftPlanSchema.parse(await request.json().catch(() => ({})));
    const result = await unpublishAiDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: body.aiPlanDraftId,
    });

    return success(result);
  } catch (error) {
    return handleError(error);
  }
}
