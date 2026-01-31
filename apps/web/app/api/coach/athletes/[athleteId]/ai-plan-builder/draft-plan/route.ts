import { requireCoach } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import {
  createAiDraftPlan,
  generateAiDraftPlanV1,
  generateDraftPlanV1Schema,
  updateAiDraftPlan,
  updateDraftPlanV1Schema,
} from '@/modules/ai-plan-builder/server/draft-plan';

export async function POST(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = (await request.json().catch(() => ({}))) as { planJson?: unknown; setup?: unknown };

    // Tranche 2: deterministic generation.
    if (body?.setup !== undefined) {
      const { setup } = generateDraftPlanV1Schema.parse({ setup: body.setup });

      const draftPlan = await generateAiDraftPlanV1({
        coachId: user.id,
        athleteId: context.params.athleteId,
        setup,
      });

      return success({ draftPlan }, { status: 201 });
    }

    // Tranche 1: allow explicit planJson draft creation (kept for backwards compatibility).
    if (body?.planJson === undefined) {
      return failure('VALIDATION_ERROR', 'setup or planJson is required.', 400);
    }

    const draftPlan = await createAiDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      planJson: body.planJson,
    });

    return success({ draftPlan });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const payload = updateDraftPlanV1Schema.parse(await request.json().catch(() => ({})));

    const draftPlan = await updateAiDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      draftPlanId: payload.draftPlanId,
      weekLocks: payload.weekLocks,
      sessionEdits: payload.sessionEdits,
    });

    return success({ draftPlan });
  } catch (error) {
    return handleError(error);
  }
}
