import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import {
  updatePlanChangeProposalDiff,
  updateProposalDiffSchema,
} from '@/modules/ai-plan-builder/server/proposals';

export async function PATCH(request: Request, context: { params: { athleteId: string; proposalId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const body = updateProposalDiffSchema.parse(await request.json());

    const proposal = await updatePlanChangeProposalDiff({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: context.params.proposalId,
      diffJson: body.diffJson,
    });

    return success({ proposal });
  } catch (error) {
    return handleError(error);
  }
}
