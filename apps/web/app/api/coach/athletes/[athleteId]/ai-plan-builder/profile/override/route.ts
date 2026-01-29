import { requireCoach } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { updateAiProfileCoachOverrides } from '@/modules/ai-plan-builder/server/profile';

export async function PATCH(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = (await request.json()) as { profileId?: string; coachOverridesJson?: unknown };

    const profileId = String(body?.profileId ?? '').trim();
    if (!profileId) {
      return failure('VALIDATION_ERROR', 'profileId is required.', 400);
    }

    const updated = await updateAiProfileCoachOverrides({
      coachId: user.id,
      athleteId: context.params.athleteId,
      profileId,
      coachOverridesJson: body?.coachOverridesJson ?? {},
    });

    return success({ profile: updated });
  } catch (error) {
    return handleError(error);
  }
}
