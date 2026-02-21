import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { applyAiAgentAdjustmentsToDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';
import { parseAgentAdjustRequest } from '@/modules/ai-plan-builder/server/agent-command';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const payload = parseAgentAdjustRequest(await request.json().catch(() => ({})));

    const result = await applyAiAgentAdjustmentsToDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      draftPlanId: payload.draftPlanId,
      scope: payload.scope,
      instruction: payload.instruction,
      weekIndex: payload.weekIndex,
      sessionId: payload.sessionId,
    });

    return success(result);
  } catch (error) {
    return handleError(error);
  }
}
