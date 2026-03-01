import { NextRequest } from 'next/server';
import { ChallengeStatus } from '@prisma/client';
import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { createChallenge, challengeRulesText, formatChallengeScore, mapChallengeWindowLabel } from '@/lib/challenges/service';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  status: z.nativeEnum(ChallengeStatus).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));

    const challenges = await prisma.challenge.findMany({
      where: {
        coachId: user.id,
        ...(query.status ? { status: query.status } : {}),
      },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        startAt: true,
        endAt: true,
        isOngoing: true,
        disciplineScope: true,
        scoringConfig: true,
        participants: {
          select: {
            athleteId: true,
            rank: true,
            score: true,
            athlete: {
              select: {
                user: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: [{ rank: 'asc' }, { athleteId: 'asc' }],
          take: 3,
        },
        _count: {
          select: {
            participants: true,
          },
        },
        squad: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    const data = challenges.map((challenge) => ({
      ...challenge,
      dateRangeLabel: mapChallengeWindowLabel(challenge),
      rulesText: challengeRulesText(challenge),
      top3: challenge.participants.map((row) => ({
        athleteId: row.athleteId,
        athleteName: row.athlete.user.name ?? 'Athlete',
        rank: row.rank,
        scoreLabel: formatChallengeScore({
          score: row.score,
          type: challenge.type,
          scoringConfig: challenge.scoringConfig,
        }),
      })),
      participationCount: challenge._count.participants,
    }));

    return success({ challenges: data });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const payload = await request.json();
    const challenge = await createChallenge(payload, user.id);
    return success({ challenge }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
