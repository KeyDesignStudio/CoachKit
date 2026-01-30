import { requireCoach } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { createPlanChangeProposal } from '@/modules/ai-plan-builder/server/proposal';

export async function POST(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = (await request.json()) as {
      proposalJson?: unknown;
      draftPlanId?: string;
      targetPlanRef?: string;
    };

    if (body?.proposalJson === undefined) {
      return failure('VALIDATION_ERROR', 'proposalJson is required.', 400);
    }

    const proposal = await createPlanChangeProposal({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalJson: body.proposalJson,
      draftPlanId: body.draftPlanId,
      targetPlanRef: body.targetPlanRef,
    });

    return success({ proposal });
  } catch (error) {
    return handleError(error);
  }
}
