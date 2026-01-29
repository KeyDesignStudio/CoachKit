import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { ackAthletePublish, athletePublishAckSchema } from '@/modules/ai-plan-builder/server/publish-ack';

export async function POST(request: Request) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireAthlete();

    const body = athletePublishAckSchema.parse(await request.json());

    const ack = await ackAthletePublish({
      athleteId: user.id,
      aiPlanDraftId: body.aiPlanDraftId,
      lastSeenPublishedHash: body.lastSeenPublishedHash,
    });

    return success({ ack });
  } catch (error) {
    return handleError(error);
  }
}
