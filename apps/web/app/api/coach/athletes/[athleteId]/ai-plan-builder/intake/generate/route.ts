import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { generateSubmittedIntakeFromProfile } from '@/modules/ai-plan-builder/server/intake';

export async function POST(_request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const result = await generateSubmittedIntakeFromProfile({
      coachId: user.id,
      athleteId: context.params.athleteId,
    });

    return success(result);
  } catch (error) {
    return handleError(error);
  }
}
