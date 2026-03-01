import { NextRequest } from 'next/server';
import { AssistantActionType, AssistantDetectionState } from '@prisma/client';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { getCoachDetectionOrThrow } from '@/modules/assistant/server/detections';

export const dynamic = 'force-dynamic';

export async function POST(_: NextRequest, context: { params: Promise<{ detectionId: string }> }) {
  try {
    const { user } = await requireCoach();
    const { detectionId } = await context.params;

    const detection = await getCoachDetectionOrThrow({ detectionId, coachId: user.id });

    const updated = await prisma.assistantDetection.update({
      where: { id: detection.id },
      data: {
        state: AssistantDetectionState.ACTIONED,
      },
    });

    await prisma.assistantAction.create({
      data: {
        coachId: user.id,
        athleteId: detection.athleteId,
        detectionId: detection.id,
        actionType: AssistantActionType.APPLY_PLAN_CHANGE,
        actionPayload: {
          source: 'manual_mark_actioned',
        },
      },
    });

    return success({ detection: updated });
  } catch (error) {
    return handleError(error);
  }
}
