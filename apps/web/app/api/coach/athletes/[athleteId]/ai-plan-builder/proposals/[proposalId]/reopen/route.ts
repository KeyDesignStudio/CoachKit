import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getProposalPreview } from '@/modules/ai-plan-builder/server/proposal-preview';
import { reopenPlanChangeProposalAsNew } from '@/modules/ai-plan-builder/server/proposals';

const reopenSchema = z.object({
  aiPlanDraftId: z.string().min(1),
});

export async function POST(request: Request, context: { params: { athleteId: string; proposalId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = reopenSchema.parse(await request.json().catch(() => ({})));

    const created = await reopenPlanChangeProposalAsNew({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: context.params.proposalId,
      aiPlanDraftId: body.aiPlanDraftId,
    });

    const preview = await getProposalPreview({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: String(created.proposal.id),
      aiPlanDraftId: body.aiPlanDraftId,
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
