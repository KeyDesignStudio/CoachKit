import { requireAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { athleteChangesQuerySchema, getAthleteAiPlanChanges } from '@/modules/ai-plan-builder/server/athlete-changes';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireAthlete();

    const url = new URL(request.url);
    const aiPlanDraftId = String(url.searchParams.get('aiPlanDraftId') ?? '').trim();
    const limitParam = Number(url.searchParams.get('limit') ?? '10');
    if (!aiPlanDraftId) throw new ApiError(400, 'VALIDATION_ERROR', 'aiPlanDraftId is required.');

    const parsed = athleteChangesQuerySchema.parse({ aiPlanDraftId, limit: Number.isFinite(limitParam) ? limitParam : 10 });

    const changes = await getAthleteAiPlanChanges({
      athleteId: user.id,
      aiPlanDraftId: parsed.aiPlanDraftId,
      limit: parsed.limit,
    });

    return success({ changes });
  } catch (error) {
    return handleError(error);
  }
}
