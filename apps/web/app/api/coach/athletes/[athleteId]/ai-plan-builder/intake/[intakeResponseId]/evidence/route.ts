import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { listEvidenceForIntake } from '@/modules/ai-plan-builder/server/intake';

export async function GET(
  _request: Request,
  context: { params: { athleteId: string; intakeResponseId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const evidence = await listEvidenceForIntake({
      coachId: user.id,
      athleteId: context.params.athleteId,
      intakeResponseId: context.params.intakeResponseId,
    });

    return success({ evidence });
  } catch (error) {
    return handleError(error);
  }
}
