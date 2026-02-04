import { handleError, success, failure } from '@/lib/http';
import { requireAthlete } from '@/lib/auth';

import { createAthleteIntakeSubmission, athleteIntakeSubmissionSchema, requireAthleteCoachId } from '@/modules/ai-plan-builder/server/athlete-intake';
import { ensureAthleteBrief } from '@/modules/ai-plan-builder/server/athlete-brief';

export async function POST(request: Request) {
  try {
    const { user } = await requireAthlete();
    const body = await request.json().catch(() => ({}));
    const payload = athleteIntakeSubmissionSchema.safeParse(body);

    if (!payload.success) {
      return failure('VALIDATION_ERROR', 'Invalid intake payload.', 400, undefined, {
        diagnostics: payload.error.flatten(),
      });
    }

    const coachId = await requireAthleteCoachId(user.id);

    const submission = await createAthleteIntakeSubmission({
      athleteId: user.id,
      coachId,
      payload: payload.data,
    });

    const brief = await ensureAthleteBrief({ athleteId: user.id, coachId });

    return success({ submission, brief: brief.brief });
  } catch (error) {
    return handleError(error);
  }
}
