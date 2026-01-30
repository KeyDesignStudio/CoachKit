import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getLatestSubmittedIntake } from '@/modules/ai-plan-builder/server/intake';

export async function GET(_request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const intakeResponse = await getLatestSubmittedIntake({
      coachId: user.id,
      athleteId: context.params.athleteId,
    });

    return success({ intakeResponse });
  } catch (error) {
    return handleError(error);
  }
}
