import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { listReferencePlansForAthlete } from '@/modules/ai-plan-builder/server/draft-plan';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const referencePlans = await listReferencePlansForAthlete({
      coachId: user.id,
      athleteId: context.params.athleteId,
    });
    return success({ referencePlans });
  } catch (error) {
    return handleError(error);
  }
}

