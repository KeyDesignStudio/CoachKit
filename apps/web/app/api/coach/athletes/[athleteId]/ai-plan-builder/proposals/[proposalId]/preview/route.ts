import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getProposalPreview, proposalPreviewQuerySchema } from '@/modules/ai-plan-builder/server/proposal-preview';

export async function GET(request: Request, context: { params: { athleteId: string; proposalId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const url = new URL(request.url);
    const aiPlanDraftId = String(url.searchParams.get('aiPlanDraftId') ?? '').trim();
    if (!aiPlanDraftId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'aiPlanDraftId is required.');
    }
    proposalPreviewQuerySchema.parse({ aiPlanDraftId });

    const result = await getProposalPreview({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: context.params.proposalId,
      aiPlanDraftId,
    });

    return success({ preview: result.preview, applySafety: result.applySafety });
  } catch (error) {
    return handleError(error);
  }
}
