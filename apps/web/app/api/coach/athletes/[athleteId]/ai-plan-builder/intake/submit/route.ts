import { requireCoach } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { submitIntake } from '@/modules/ai-plan-builder/server/intake';

export async function POST(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = (await request.json()) as { intakeResponseId?: string };

    const intakeResponseId = String(body?.intakeResponseId ?? '').trim();
    if (!intakeResponseId) {
      return failure('VALIDATION_ERROR', 'intakeResponseId is required.', 400);
    }

    const result = await submitIntake({
      coachId: user.id,
      athleteId: context.params.athleteId,
      intakeResponseId,
    });

    return success(result);
  } catch (error) {
    return handleError(error);
  }
}
