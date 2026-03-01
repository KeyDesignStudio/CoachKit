import { NextRequest } from 'next/server';
import { ChallengeStatus } from '@prisma/client';
import { z } from 'zod';

import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { formatChallengeScore, mapChallengeWindowLabel, challengeRulesText, maybeCompleteChallenge } from '@/lib/challenges/service';
import { parseParticipationConfig } from '@/lib/challenges/config';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  status: z.nativeEnum(ChallengeStatus).optional(),
});

function toName(value: string | null | undefined) {
  return String(value ?? '').trim() || 'Athlete';
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));

    const memberships = await prisma.squadMember.findMany({
      where: { athleteId: user.id },
      select: { squadId: true },
    });
    const squadIds = Array.from(new Set(memberships.map((row) => row.squadId)));
    if (!squadIds.length) return success({ challenges: [] });

    const challenges = await prisma.challenge.findMany({
      where: {
        squadId: { in: squadIds },
        ...(query.status
          ? { status: query.status }
          : {
              status: {
                in: [ChallengeStatus.ACTIVE, ChallengeStatus.COMPLETED],
              },
            }),
      },
      select: {
        id: true,
        squadId: true,
        title: true,
        type: true,
        status: true,
        startAt: true,
        endAt: true,
        isOngoing: true,
        scoringConfig: true,
        participationConfig: true,
        rewardConfig: true,
        participants: {
          where: { athleteId: user.id },
          select: {
            rank: true,
            score: true,
            sessionsCount: true,
            joinedAt: true,
          },
          take: 1,
        },
        _count: {
          select: {
            participants: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { startAt: 'desc' }],
    });

    const challengeIds = challenges.map((challenge) => challenge.id);
    for (const challengeId of challengeIds) {
      await maybeCompleteChallenge(challengeId);
    }

    const leaders = await prisma.challengeParticipant.findMany({
      where: {
        challengeId: { in: challengeIds },
        rank: { in: [1, 2, 3] },
      },
      select: {
        challengeId: true,
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
      orderBy: [{ challengeId: 'asc' }, { rank: 'asc' }],
    });

    const leadersByChallenge = new Map<string, typeof leaders>();
    for (const row of leaders) {
      const list = leadersByChallenge.get(row.challengeId) ?? [];
      list.push(row);
      leadersByChallenge.set(row.challengeId, list);
    }

    const data = challenges.map((challenge) => {
      const you = challenge.participants[0] ?? null;
      const participationConfig = parseParticipationConfig(challenge.participationConfig);
      return {
        id: challenge.id,
        title: challenge.title,
        type: challenge.type,
        status: challenge.status,
        startAt: challenge.startAt,
        dateRangeLabel: mapChallengeWindowLabel(challenge),
        rulesText: challengeRulesText(challenge),
        participantCount: challenge._count.participants,
        joined: Boolean(you),
        canJoin: !participationConfig.autoJoin,
        yourRank: you?.rank ?? null,
        yourScoreLabel: you
          ? formatChallengeScore({
              score: you.score,
              type: challenge.type,
              scoringConfig: challenge.scoringConfig,
            })
          : null,
        yourSessions: you?.sessionsCount ?? 0,
        top3: (leadersByChallenge.get(challenge.id) ?? []).map((row) => ({
          rank: row.rank,
          athleteName: toName(row.athlete.user.name),
          scoreLabel: formatChallengeScore({
            score: row.score,
            type: challenge.type,
            scoringConfig: challenge.scoringConfig,
          }),
        })),
      };
    });

    return success({ challenges: data });
  } catch (error) {
    return handleError(error);
  }
}
