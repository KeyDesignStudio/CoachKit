import { requireCoach, assertCoachOwnsAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { getLatestAthleteBriefJson } from '@/modules/ai-plan-builder/server/athlete-brief';
import { getLatestAthleteIntakeSubmission } from '@/modules/ai-plan-builder/server/athlete-intake';
import { ensureAthleteBrief } from '@/modules/ai-plan-builder/server/athlete-brief';

export async function GET(_request: Request, context: { params: { athleteId: string } }) {
  try {
    const { user } = await requireCoach();
    await assertCoachOwnsAthlete(context.params.athleteId, user.id);

    const latestIntake = await getLatestAthleteIntakeSubmission({
      athleteId: context.params.athleteId,
      coachId: user.id,
    });

    if (!latestIntake) {
      return success({ brief: null });
    }

    const existing = await getLatestAthleteBriefJson({
      athleteId: context.params.athleteId,
      coachId: user.id,
    });

    if (existing) {
      return success({ brief: existing });
    }

    const intakePayload = (latestIntake.answersJson ?? {}) as any;
    const generated = await ensureAthleteBrief({
      athleteId: context.params.athleteId,
      coachId: user.id,
      intake: intakePayload,
    });

    return success({ brief: generated.brief });
  } catch (error) {
    return handleError(error);
  }
}
