import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { approvePlanChangeProposal } from '@/modules/ai-plan-builder/server/proposals';

export async function POST(_request: Request, context: { params: { athleteId: string; proposalId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const result = await approvePlanChangeProposal({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: context.params.proposalId,
    });

    return success({
      proposal: result.updatedProposal,
      audit: result.audit,
      draft: result.updatedDraft,
    });
  } catch (error) {
    return handleError(error);
  }
}
