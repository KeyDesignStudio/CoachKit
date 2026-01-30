import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { publishAiDraftPlan, publishDraftPlanSchema } from '@/modules/ai-plan-builder/server/publish';

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const body = publishDraftPlanSchema.parse(await request.json().catch(() => ({})));

    const result = await publishAiDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: body.aiPlanDraftId,
    });

    return success({ draftPlan: result.draft, publish: { published: result.published, summaryText: result.summaryText, hash: result.hash } });
  } catch (error) {
    return handleError(error);
  }
}
