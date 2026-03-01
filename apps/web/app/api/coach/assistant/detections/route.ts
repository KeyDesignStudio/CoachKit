import { NextRequest } from 'next/server';
import { AssistantLlmOutputType } from '@prisma/client';
import { z } from 'zod';

import { assertCoachOwnsAthlete, requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { assistantListStateSchema, mapListWhereState, toDetectionCard } from '@/modules/assistant/server/detections';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  state: assistantListStateSchema.optional(),
  athleteId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const { searchParams } = new URL(request.url);

    const query = querySchema.parse({
      state: searchParams.get('state') ?? undefined,
      athleteId: searchParams.get('athleteId') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
    });

    if (query.athleteId) {
      await assertCoachOwnsAthlete(query.athleteId, user.id);
    }

    const where = {
      coachId: user.id,
      ...(query.athleteId ? { athleteId: query.athleteId } : {}),
      ...mapListWhereState(query.state),
    };

    const detections = await prisma.assistantDetection.findMany({
      where,
      orderBy: [{ detectedAt: 'desc' }, { createdAt: 'desc' }],
      skip: query.offset,
      take: query.limit,
      include: {
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
            key: true,
            name: true,
            category: true,
          },
        },
        llmOutputs: {
          where: {
            outputType: AssistantLlmOutputType.COACH_SUMMARY,
          },
          orderBy: [{ createdAt: 'desc' }],
          take: 1,
          select: {
            outputType: true,
            content: true,
          },
        },
      },
    });

    const total = await prisma.assistantDetection.count({ where });

    return success({
      items: detections.map(toDetectionCard),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  } catch (error) {
    return handleError(error);
  }
}
