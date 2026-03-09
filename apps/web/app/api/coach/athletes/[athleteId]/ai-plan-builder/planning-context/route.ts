import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getCoachPlanningContext } from '@/modules/ai-plan-builder/server/planning-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const planningContext = await getCoachPlanningContext({
      coachId: user.id,
      athleteId: context.params.athleteId,
    });
    return success({ planningContext });
  } catch (error) {
    return handleError(error);
  }
}
