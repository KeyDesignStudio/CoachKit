import { handleError, success, failure } from '@/lib/http';
import { requireAthlete } from '@/lib/auth';

import {
  createAthleteIntakeSubmission,
  athleteIntakeSubmissionSchema,
  flattenIntakeAnswers,
  requireAthleteCoachId,
} from '@/modules/ai-plan-builder/server/athlete-intake';
import { ensureAthleteBrief } from '@/modules/ai-plan-builder/server/athlete-brief';
import {
  createSubmittedIntake,
  getOpenIntakeDraft,
  submitIntake,
  updateIntakeDraft,
} from '@/modules/ai-plan-builder/server/intake';

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

    const questionMap = flattenIntakeAnswers(payload.data);
    const openDraft = await getOpenIntakeDraft({ athleteId: user.id, coachId });
    if (openDraft) {
      await updateIntakeDraft({
        coachId,
        athleteId: user.id,
        intakeResponseId: openDraft.id,
        draftJson: questionMap,
      });
      await submitIntake({
        coachId,
        athleteId: user.id,
        intakeResponseId: openDraft.id,
      });
    } else {
      await createSubmittedIntake({
        coachId,
        athleteId: user.id,
        source: 'athlete_initiated',
        draftJson: questionMap,
      });
    }

    const brief = await ensureAthleteBrief({ athleteId: user.id, coachId });

    return success({ submission, brief: brief.brief });
  } catch (error) {
    return handleError(error);
  }
}
