import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { generatePlanChangeProposal, generateProposalSchema } from '@/modules/ai-plan-builder/server/proposals';

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const body = generateProposalSchema.parse(await request.json());

    const result = await generatePlanChangeProposal({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: body.aiPlanDraftId,
      triggerIds: body.triggerIds,
    });

    return success({ proposal: result.proposal });
  } catch (error) {
    return handleError(error);
  }
}
