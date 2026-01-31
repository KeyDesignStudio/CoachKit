import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getLatestAiProfile } from '@/modules/ai-plan-builder/server/profile';

export async function GET(_request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const profile = await getLatestAiProfile({
      coachId: user.id,
      athleteId: context.params.athleteId,
    });

    return success({ profile });
  } catch (error) {
    return handleError(error);
  }
}
