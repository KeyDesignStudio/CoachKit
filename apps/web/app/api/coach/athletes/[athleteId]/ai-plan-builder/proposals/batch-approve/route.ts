import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { batchApproveSafeProposals, batchApproveSchema } from '@/modules/ai-plan-builder/server/proposals';

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const body = batchApproveSchema.parse(await request.json().catch(() => ({})));

    const result = await batchApproveSafeProposals({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: body.aiPlanDraftId,
      proposalIds: body.proposalIds,
      maxHours: body.maxHours,
    });

    return success({ batch: result });
  } catch (error) {
    return handleError(error);
  }
}
