import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import {
  createIntakeDraft,
  intakeDraftSchema,
  updateIntakeDraft,
} from '@/modules/ai-plan-builder/server/intake';

export async function POST(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const { draftJson } = intakeDraftSchema.parse(await request.json().catch(() => ({})));

    const created = await createIntakeDraft({
      coachId: user.id,
      athleteId: context.params.athleteId,
    });

    // Optional initial draft payload.
    const updated = draftJson !== undefined
      ? await updateIntakeDraft({
          coachId: user.id,
          athleteId: context.params.athleteId,
          intakeResponseId: created.id,
          draftJson,
        })
      : created;

    return success({ intakeResponse: updated });
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

    const payload = z
      .object({ intakeResponseId: z.string().min(1), draftJson: z.unknown() })
      .parse(await request.json());

    const updated = await updateIntakeDraft({
      coachId: user.id,
      athleteId: context.params.athleteId,
      intakeResponseId: payload.intakeResponseId,
      draftJson: payload.draftJson,
    });

    return success({ intakeResponse: updated });
  } catch (error) {
    return handleError(error);
  }
}
