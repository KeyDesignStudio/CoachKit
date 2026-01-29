import { requireCoach } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { createPlanChangeAudit } from '@/modules/ai-plan-builder/server/audit';

export async function POST(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = (await request.json()) as { eventType?: string; proposalId?: string; diffJson?: unknown };

    const eventType = String(body?.eventType ?? '').trim();
    if (!eventType) {
      return failure('VALIDATION_ERROR', 'eventType is required.', 400);
    }

    const audit = await createPlanChangeAudit({
      coachId: user.id,
      athleteId: context.params.athleteId,
      eventType,
      proposalId: body?.proposalId,
      diffJson: body?.diffJson,
    });

    return success({ audit });
  } catch (error) {
    return handleError(error);
  }
}
