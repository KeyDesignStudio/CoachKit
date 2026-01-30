import { requireCoach } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { approveAiProfile } from '@/modules/ai-plan-builder/server/profile';

export async function POST(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = (await request.json()) as { profileId?: string };

    const profileId = String(body?.profileId ?? '').trim();
    if (!profileId) {
      return failure('VALIDATION_ERROR', 'profileId is required.', 400);
    }

    const updated = await approveAiProfile({
      coachId: user.id,
      athleteId: context.params.athleteId,
      profileId,
    });

    return success({ profile: updated });
  } catch (error) {
    return handleError(error);
  }
}
