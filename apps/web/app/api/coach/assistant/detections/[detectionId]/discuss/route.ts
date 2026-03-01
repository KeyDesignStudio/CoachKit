import { NextRequest } from 'next/server';
import { AssistantActionType, AssistantLlmOutputType, type Prisma } from '@prisma/client';

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

    const existingContext = detection.llmOutputs.find((row) => row.outputType === AssistantLlmOutputType.CHATBOT_CONTEXT_PACK);

    const contextPack = {
      version: 'assistant_context_pack_v1',
      detection: {
        detectionId: detection.id,
        patternKey: detection.patternDefinition.key,
        patternName: detection.patternDefinition.name,
        severity: detection.severity,
        confidenceScore: detection.confidenceScore,
        periodStart: detection.periodStart.toISOString(),
        periodEnd: detection.periodEnd.toISOString(),
        evidence: detection.evidence,
      },
      athlete: {
        athleteId: detection.athleteId,
        athleteName: detection.athlete.user?.name ?? 'Athlete',
      },
      recommendations: detection.recommendations.map((row) => ({
        id: row.id,
        type: row.recommendationType,
        title: row.title,
        details: row.details,
      })),
    };

    const thread = await prisma.messageThread.upsert({
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

    const persistedContext =
      existingContext ??
      (await prisma.assistantLlmOutput.create({
        data: {
          detectionId: detection.id,
          outputType: AssistantLlmOutputType.CHATBOT_CONTEXT_PACK,
          content: JSON.stringify(contextPack),
          promptVersion: 'assistant_chat_context_pack_v1',
          model: null,
          tokenUsage: {
            generatedBy: 'deterministic_scaffold',
          } as Prisma.InputJsonValue,
        },
      }));

    await prisma.assistantAction.create({
      data: {
        coachId: user.id,
        athleteId: detection.athleteId,
        detectionId: detection.id,
        actionType: AssistantActionType.OPEN_CHAT,
        actionPayload: {
          threadId: thread.id,
          contextOutputId: persistedContext.id,
        },
      },
    });

    return success({
      threadId: thread.id,
      contextOutputId: persistedContext.id,
      contextPack,
      entrypoint: `/coach/notifications?threadId=${encodeURIComponent(thread.id)}`,
    });
  } catch (error) {
    return handleError(error);
  }
}
