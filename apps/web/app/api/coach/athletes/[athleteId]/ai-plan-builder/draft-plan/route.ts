import { requireCoach } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { createAiDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';

export async function POST(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = (await request.json()) as { planJson?: unknown };

    if (body?.planJson === undefined) {
      return failure('VALIDATION_ERROR', 'planJson is required.', 400);
    }

    const draft = await createAiDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      planJson: body.planJson,
    });

    return success({ draftPlan: draft });
  } catch (error) {
    return handleError(error);
  }
}
