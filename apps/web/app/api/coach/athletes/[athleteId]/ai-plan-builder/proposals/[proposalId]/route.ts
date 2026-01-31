import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getPlanChangeProposal } from '@/modules/ai-plan-builder/server/proposals';

export async function GET(_request: Request, context: { params: { athleteId: string; proposalId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const proposal = await getPlanChangeProposal({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: context.params.proposalId,
    });

    return success({ proposal });
  } catch (error) {
    return handleError(error);
  }
}
