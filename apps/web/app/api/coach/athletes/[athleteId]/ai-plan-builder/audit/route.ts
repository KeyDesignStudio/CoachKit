import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { failure, handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { createPlanChangeAudit, listPlanChangeAudits } from '@/modules/ai-plan-builder/server/audit';

export async function GET(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const url = new URL(request.url);
    const aiPlanDraftId = String(url.searchParams.get('aiPlanDraftId') ?? '').trim();
    const limit = Number(url.searchParams.get('limit') ?? '');
    if (!aiPlanDraftId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'aiPlanDraftId is required.');
    }
    const audits = await listPlanChangeAudits({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return success({ audits });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = (await request.json()) as {
      eventType?: string;
      proposalId?: string;
      changeSummaryText?: string;
      diffJson?: unknown;
    };

    const eventType = String(body?.eventType ?? '').trim();
    if (!eventType) {
      return failure('VALIDATION_ERROR', 'eventType is required.', 400);
    }

    const audit = await createPlanChangeAudit({
      coachId: user.id,
      athleteId: context.params.athleteId,
      eventType,
      proposalId: body?.proposalId,
      changeSummaryText: body?.changeSummaryText,
      diffJson: body?.diffJson,
    });

    return success({ audit });
  } catch (error) {
    return handleError(error);
  }
}
