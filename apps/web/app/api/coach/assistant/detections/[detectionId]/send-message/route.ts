import { NextRequest } from 'next/server';
import { AssistantActionType, AssistantDetectionState } from '@prisma/client';
import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { getCoachDetectionOrThrow } from '@/modules/assistant/server/detections';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  message: z.string().trim().min(1).max(3000),
  subject: z.string().trim().max(300).optional(),
  recommendationId: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ detectionId: string }> }) {
  try {
    const { user } = await requireCoach();
    const { detectionId } = await context.params;
    const payload = bodySchema.parse(await request.json());

    const detection = await getCoachDetectionOrThrow({ detectionId, coachId: user.id });

    const bodyText = payload.subject ? `Subject: ${payload.subject}\n\n${payload.message}` : payload.message;
    const now = new Date();

    const { thread, message } = await prisma.$transaction(async (tx) => {
      const threadRow = await tx.messageThread.upsert({
        where: {
          coachId_athleteId: {
            coachId: user.id,
            athleteId: detection.athleteId,
          },
        },
        create: {
          coachId: user.id,
          athleteId: detection.athleteId,
        },
        update: {},
        select: { id: true },
      });

      const messageRow = await tx.message.create({
        data: {
          threadId: threadRow.id,
          senderUserId: user.id,
          senderRole: 'COACH',
          body: bodyText,
          coachReadAt: now,
        },
        select: {
          id: true,
          createdAt: true,
        },
      });

      await tx.assistantAction.create({
        data: {
          coachId: user.id,
          athleteId: detection.athleteId,
          detectionId: detection.id,
          actionType: AssistantActionType.SEND_MESSAGE,
          actionPayload: {
            messageId: messageRow.id,
            threadId: threadRow.id,
            recommendationId: payload.recommendationId ?? null,
          },
        },
      });

      await tx.assistantDetection.update({
        where: { id: detection.id },
        data: {
          state: AssistantDetectionState.ACTIONED,
        },
      });

      return { thread: threadRow, message: messageRow };
    });

    return success({
      sent: true,
      threadId: thread.id,
      message,
    });
  } catch (error) {
    return handleError(error);
  }
}
