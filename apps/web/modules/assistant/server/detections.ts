import { AssistantDetectionState, AssistantLlmOutputType, type Prisma } from '@prisma/client';
import { z } from 'zod';

import { notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

export const assistantListStateSchema = z.enum([
  'NEW',
  'VIEWED',
  'DISMISSED',
  'SNOOZED',
  'ACTIONED',
  'NEEDS_ATTENTION',
]);

export const detectionDetailInclude = {
  athlete: {
    select: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  patternDefinition: {
    select: {
      id: true,
      key: true,
      name: true,
      category: true,
      version: true,
    },
  },
  recommendations: {
    orderBy: [{ createdAt: 'asc' as const }],
  },
  llmOutputs: {
    orderBy: [{ createdAt: 'desc' as const }],
  },
  actions: {
    orderBy: [{ createdAt: 'desc' as const }],
    take: 50,
  },
} as const satisfies Prisma.AssistantDetectionInclude;

export async function getCoachDetectionOrThrow(params: { detectionId: string; coachId: string }) {
  const detection = await prisma.assistantDetection.findFirst({
    where: {
      id: params.detectionId,
      coachId: params.coachId,
    },
    include: detectionDetailInclude,
  });

  if (!detection) {
    throw notFound('Detection not found for this coach.');
  }

  return detection;
}

export function mapListWhereState(state?: z.infer<typeof assistantListStateSchema>) {
  if (!state) return {};
  if (state === 'NEEDS_ATTENTION') {
    return {
      state: {
        in: [AssistantDetectionState.NEW, AssistantDetectionState.VIEWED] as AssistantDetectionState[],
      },
    } satisfies Prisma.AssistantDetectionWhereInput;
  }
  return {
    state: state as AssistantDetectionState,
  } satisfies Prisma.AssistantDetectionWhereInput;
}

export function toDetectionCard(detection: any) {
  const summary =
    detection.llmOutputs.find((row: any) => row.outputType === AssistantLlmOutputType.COACH_SUMMARY)?.content?.trim() ||
    'Assistant detected a repeatable pattern and prepared recommended actions.';

  return {
    id: detection.id,
    athleteId: detection.athleteId,
    athleteName: detection.athlete.user?.name ?? 'Athlete',
    detectedAt: detection.detectedAt,
    title: detection.patternDefinition.name,
    patternKey: detection.patternDefinition.key,
    category: detection.patternDefinition.category,
    summary,
    severity: detection.severity,
    confidenceScore: detection.confidenceScore,
    state: detection.state,
    snoozedUntil: detection.snoozedUntil,
  };
}

export function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}
