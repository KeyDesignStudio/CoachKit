import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { generateSubmittedIntakeFromProfile } from '@/modules/ai-plan-builder/server/intake';
import { approveAiProfile, extractAiProfileFromIntake } from '@/modules/ai-plan-builder/server/profile';

export async function POST(_request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const result = await generateSubmittedIntakeFromProfile({
      coachId: user.id,
      athleteId: context.params.athleteId,
    });

    let profile: unknown = null;
    try {
      const extracted = await extractAiProfileFromIntake({
        coachId: user.id,
        athleteId: context.params.athleteId,
        intakeResponseId: String(result.intakeResponse.id),
      });

      profile = await approveAiProfile({
        coachId: user.id,
        athleteId: context.params.athleteId,
        profileId: String(extracted.profile.id),
      });
    } catch {
      // Best-effort: allow intake generation to succeed even if summary extraction fails.
      profile = null;
    }

    return success({ ...result, profile });
  } catch (error) {
    return handleError(error);
  }
}
