import { requireCoach, assertCoachOwnsAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { ensureAthleteBrief } from '@/modules/ai-plan-builder/server/athlete-brief';

export async function POST(_request: Request, context: { params: { athleteId: string } }) {
  try {
    const { user } = await requireCoach();
    await assertCoachOwnsAthlete(context.params.athleteId, user.id);

    const generated = await ensureAthleteBrief({
      athleteId: context.params.athleteId,
      coachId: user.id,
    });

    return success({ brief: generated.brief ?? null });
  } catch (error) {
    return handleError(error);
  }
}
