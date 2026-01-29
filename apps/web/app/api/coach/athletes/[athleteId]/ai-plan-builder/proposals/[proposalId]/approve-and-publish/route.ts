import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { approveAndPublishPlanChangeProposal } from '@/modules/ai-plan-builder/server/approve-and-publish';
import { z } from 'zod';

const schema = z.object({
  aiPlanDraftId: z.string().min(1),
});

export async function POST(request: Request, context: { params: { athleteId: string; proposalId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const body = schema.parse(await request.json().catch(() => ({})));

    const result = await approveAndPublishPlanChangeProposal({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: context.params.proposalId,
      aiPlanDraftId: body.aiPlanDraftId,
    });

    return success({
      appliedProposalId: String(context.params.proposalId),
      approval: { proposal: result.approval.proposal, audit: result.approval.audit, draft: result.approval.draft },
      publish: result.publish,
    });
  } catch (error) {
    return handleError(error);
  }
}
