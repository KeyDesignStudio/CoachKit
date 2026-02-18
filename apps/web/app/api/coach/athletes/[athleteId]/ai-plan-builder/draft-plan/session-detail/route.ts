import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { getOrGenerateDraftSessionDetail } from '@/modules/ai-plan-builder/server/draft-plan';

const querySchema = z.object({
  draftPlanId: z.string().min(1),
  sessionId: z.string().min(1),
});

export async function GET(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      draftPlanId: searchParams.get('draftPlanId') ?? '',
      sessionId: searchParams.get('sessionId') ?? '',
    });

    const detail = await getOrGenerateDraftSessionDetail({
      coachId: user.id,
      athleteId: context.params.athleteId,
      draftPlanId: query.draftPlanId,
      sessionId: query.sessionId,
    });

    return success(detail, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
