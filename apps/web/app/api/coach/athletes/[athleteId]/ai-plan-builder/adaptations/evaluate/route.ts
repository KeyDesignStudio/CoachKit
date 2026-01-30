import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { evaluateAdaptationTriggers, evaluateAdaptationTriggersSchema } from '@/modules/ai-plan-builder/server/adaptations';

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const body = evaluateAdaptationTriggersSchema.parse(await request.json());

    const result = await evaluateAdaptationTriggers({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: body.aiPlanDraftId,
      windowDays: body.windowDays,
    });

    return success({
      now: result.now.toISOString(),
      created: result.created,
      triggers: result.triggers,
    });
  } catch (error) {
    return handleError(error);
  }
}
