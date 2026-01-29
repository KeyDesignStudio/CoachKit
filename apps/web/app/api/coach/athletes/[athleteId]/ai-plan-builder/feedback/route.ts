import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import {
  createAthleteSessionFeedback,
  createAthleteSessionFeedbackSchema,
  listAthleteSessionFeedback,
} from '@/modules/ai-plan-builder/server/feedback';

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const body = createAthleteSessionFeedbackSchema.parse(await request.json());

    const feedback = await createAthleteSessionFeedback({
      coachId: user.id,
      athleteId: context.params.athleteId,
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

export async function GET(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const url = new URL(request.url);
    const aiPlanDraftId = String(url.searchParams.get('aiPlanDraftId') ?? '').trim();
    const limit = Number(url.searchParams.get('limit') ?? '');
    const offset = Number(url.searchParams.get('offset') ?? '');

    if (!aiPlanDraftId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'aiPlanDraftId is required.');
    }

    const feedback = await listAthleteSessionFeedback({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });

    return success({ feedback });
  } catch (error) {
    return handleError(error);
  }
}
