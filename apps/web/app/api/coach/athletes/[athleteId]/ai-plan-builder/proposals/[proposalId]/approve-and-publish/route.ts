import { randomUUID } from 'crypto';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { approveAndPublishPlanChangeProposal } from '@/modules/ai-plan-builder/server/approve-and-publish';
import { z } from 'zod';

export const runtime = 'nodejs';

const schema = z.object({
  aiPlanDraftId: z.string().min(1),
});

export async function POST(request: Request, context: { params: { athleteId: string; proposalId: string } }) {
  const requestId = request.headers.get('x-request-id') ?? request.headers.get('x-vercel-id') ?? randomUUID();
  let rawBody: unknown = {};

  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    rawBody = await request.json().catch(() => ({}));
    const body = schema.parse(rawBody);

    const result = await approveAndPublishPlanChangeProposal({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: context.params.proposalId,
      aiPlanDraftId: body.aiPlanDraftId,
      requestId,
    });

    return success({
      appliedProposalId: String(context.params.proposalId),
      approval: { proposal: result.approval.proposal, audit: result.approval.audit, draft: result.approval.draft },
      publish: result.publish,
      materialisation: result.materialisation,
    });
  } catch (error) {
    try {
      const prismaCode =
        typeof (error as any)?.code === 'string' && /^P\d{4}$/.test((error as any).code) ? (error as any).code : null;

      console.error('APB_APPROVE_AND_PUBLISH_FAILED', {
        requestId,
        athleteId: context.params.athleteId,
        proposalId: context.params.proposalId,
        aiPlanDraftId: typeof (rawBody as any)?.aiPlanDraftId === 'string' ? (rawBody as any).aiPlanDraftId : null,
        prismaCode,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { value: error },
      });
    } catch (logError) {
      console.error('APB_APPROVE_AND_PUBLISH_LOG_FAILED', { requestId, logError });
    }

    return handleError(error, {
      requestId,
      where:
        'POST /api/coach/athletes/[athleteId]/ai-plan-builder/proposals/[proposalId]/approve-and-publish',
    });
  }
}
