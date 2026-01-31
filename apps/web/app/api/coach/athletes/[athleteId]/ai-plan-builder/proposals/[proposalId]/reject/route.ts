import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { rejectPlanChangeProposal } from '@/modules/ai-plan-builder/server/proposals';

export async function POST(_request: Request, context: { params: { athleteId: string; proposalId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const proposal = await rejectPlanChangeProposal({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: context.params.proposalId,
    });

    return success({ proposal });
  } catch (error) {
    return handleError(error);
  }
}
