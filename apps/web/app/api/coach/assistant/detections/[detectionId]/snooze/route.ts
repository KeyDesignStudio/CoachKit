import { NextRequest } from 'next/server';
import { AssistantActionType, AssistantDetectionState } from '@prisma/client';
import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { addDays, getCoachDetectionOrThrow } from '@/modules/assistant/server/detections';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  days: z.union([z.literal(7), z.literal(14), z.literal(30)]).default(7),
});

export async function POST(request: NextRequest, context: { params: Promise<{ detectionId: string }> }) {
  try {
    const { user } = await requireCoach();
    const { detectionId } = await context.params;
    const payload = bodySchema.parse(await request.json());

    const detection = await getCoachDetectionOrThrow({ detectionId, coachId: user.id });
    const snoozedUntil = addDays(new Date(), payload.days);

    const updated = await prisma.assistantDetection.update({
      where: { id: detection.id },
      data: {
        state: AssistantDetectionState.SNOOZED,
        snoozedUntil,
      },
    });

    await prisma.assistantAction.create({
      data: {
        coachId: user.id,
        athleteId: detection.athleteId,
        detectionId: detection.id,
        actionType: AssistantActionType.SNOOZE,
        actionPayload: {
          days: payload.days,
          snoozedUntil: snoozedUntil.toISOString(),
        },
      },
    });

    return success({ detection: updated });
  } catch (error) {
    return handleError(error);
  }
}
