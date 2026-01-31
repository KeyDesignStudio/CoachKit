import { requireAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import {
  createAthleteSessionFeedbackAsAthlete,
  createAthleteSessionFeedbackSchema,
  listAthleteSessionFeedbackAsAthlete,
} from '@/modules/ai-plan-builder/server/feedback';

export async function POST(request: Request) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireAthlete();

    const body = createAthleteSessionFeedbackSchema.parse(await request.json());

    const feedback = await createAthleteSessionFeedbackAsAthlete({
      athleteId: user.id,
      aiPlanDraftId: body.aiPlanDraftId,
      draftSessionId: body.draftSessionId,
      completedStatus: body.completedStatus,
      rpe: body.rpe ?? null,
      feel: body.feel ?? null,
      sorenessFlag: body.sorenessFlag,
      sorenessNotes: body.sorenessNotes ?? null,
      sleepQuality: body.sleepQuality ?? null,
    });

    return success({ feedback });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET(request: Request) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireAthlete();

    const url = new URL(request.url);
    const aiPlanDraftId = String(url.searchParams.get('aiPlanDraftId') ?? '').trim();

    if (!aiPlanDraftId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'aiPlanDraftId is required.');
    }

    const feedback = await listAthleteSessionFeedbackAsAthlete({ athleteId: user.id, aiPlanDraftId });

    return success({ feedback });
  } catch (error) {
    return handleError(error);
  }
}
