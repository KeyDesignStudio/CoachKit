import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getPerformanceModelPreview } from '@/modules/ai-plan-builder/server/performance-model';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const { searchParams } = new URL(request.url);
    const aiPlanDraftIdRaw = searchParams.get('aiPlanDraftId');

    const data = await getPerformanceModelPreview({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: aiPlanDraftIdRaw ? String(aiPlanDraftIdRaw).trim() : null,
    });

    return success(data);
  } catch (error) {
    return handleError(error);
  }
}

