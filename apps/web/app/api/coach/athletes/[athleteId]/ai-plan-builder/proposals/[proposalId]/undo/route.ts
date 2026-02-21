import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { createUndoProposalFromAppliedProposal } from '@/modules/ai-plan-builder/server/proposals';
import { getProposalPreview } from '@/modules/ai-plan-builder/server/proposal-preview';

export async function POST(_request: Request, context: { params: { athleteId: string; proposalId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const created = await createUndoProposalFromAppliedProposal({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: context.params.proposalId,
    });

    const preview = await getProposalPreview({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: String(created.proposal.id),
      aiPlanDraftId: String(created.proposal.draftPlanId),
    });

    return success({
      proposal: created.proposal,
      preview: preview.preview,
      applySafety: preview.applySafety,
    });
  } catch (error) {
    return handleError(error);
  }
}
