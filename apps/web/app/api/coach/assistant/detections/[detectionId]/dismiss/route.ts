import { NextRequest } from 'next/server';
import { AssistantActionType, AssistantDetectionState } from '@prisma/client';
import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { getCoachDetectionOrThrow } from '@/modules/assistant/server/detections';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  reason: z.string().trim().min(1).max(300),
});

export async function POST(request: NextRequest, context: { params: Promise<{ detectionId: string }> }) {
  try {
    const { user } = await requireCoach();
    const { detectionId } = await context.params;
    const payload = bodySchema.parse(await request.json());

    const detection = await getCoachDetectionOrThrow({ detectionId, coachId: user.id });

    const updated = await prisma.assistantDetection.update({
      where: { id: detection.id },
      data: {
        state: AssistantDetectionState.DISMISSED,
        dismissReason: payload.reason,
      },
    });

    await prisma.assistantAction.create({
      data: {
        coachId: user.id,
        athleteId: detection.athleteId,
        detectionId: detection.id,
        actionType: AssistantActionType.DISMISS,
        actionPayload: {
          reason: payload.reason,
        },
      },
    });

    return success({ detection: updated });
  } catch (error) {
    return handleError(error);
  }
}
