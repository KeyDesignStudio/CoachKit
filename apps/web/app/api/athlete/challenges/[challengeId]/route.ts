import { NextRequest } from 'next/server';

import { requireAthlete } from '@/lib/auth';
import { forbidden, notFound } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { challengeRulesText, formatChallengeScore, maybeCompleteChallenge } from '@/lib/challenges/service';
import { parseParticipationConfig, parseScoringConfig } from '@/lib/challenges/config';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function toName(value: string | null | undefined) {
  return String(value ?? '').trim() || 'Athlete';
}

export async function GET(_request: NextRequest, context: { params: { challengeId: string } }) {
  try {
    const { user } = await requireAthlete();
    await maybeCompleteChallenge(context.params.challengeId);

    const challenge = await prisma.challenge.findUnique({
      where: { id: context.params.challengeId },
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        status: true,
        squadId: true,
        startAt: true,
        endAt: true,
        isOngoing: true,
        scoringConfig: true,
        participationConfig: true,
        rewardConfig: true,
      },
    });

    if (!challenge) throw notFound('Challenge not found.');

    const membership = await prisma.squadMember.findUnique({
      where: {
        squadId_athleteId: {
          squadId: challenge.squadId,
          athleteId: user.id,
        },
      },
      select: { athleteId: true },
    });

    if (!membership) throw forbidden('You cannot view this challenge.');

    const participationConfig = parseParticipationConfig(challenge.participationConfig);
    const you = await prisma.challengeParticipant.findUnique({
      where: {
        challengeId_athleteId: {
          challengeId: challenge.id,
          athleteId: user.id,
        },
      },
      select: {
        athleteId: true,
        rank: true,
        score: true,
        sessionsCount: true,
        joinedAt: true,
      },
    });

    const leaderboard = await prisma.challengeParticipant.findMany({
      where: {
        challengeId: challenge.id,
        rank: { not: null },
      },
      select: {
        athleteId: true,
        rank: true,
        score: true,
        sessionsCount: true,
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
      take: 100,
    });

    const top10 = leaderboard.slice(0, 10);
    const top10Ids = new Set(top10.map((row) => row.athleteId));
    const includeSelf = you && !top10Ids.has(you.athleteId);

    const fullLeaderboard = includeSelf
      ? [
          ...top10,
          {
            athleteId: you.athleteId,
            rank: you.rank,
            score: you.score,
            sessionsCount: you.sessionsCount,
            athlete: {
              user: {
                name: 'You',
              },
            },
          },
        ]
      : top10;

    const leaderScore = leaderboard[0]?.score ?? 0;
    const parsedScoring = parseScoringConfig(challenge.type, challenge.scoringConfig);
    const targetCount =
      challenge.type === 'FREQUENCY'
        ? Number((parsedScoring as { targetCount?: number | null }).targetCount ?? null) || null
        : null;

    const youProgressPercent = you
      ? targetCount && targetCount > 0
        ? Math.max(0, Math.min(100, (you.score / targetCount) * 100))
        : leaderScore > 0
          ? Math.max(0, Math.min(100, (you.score / leaderScore) * 100))
          : 0
      : 0;

    const latestBadges = await prisma.badgeAward.findMany({
      where: {
        athleteId: user.id,
        challengeId: challenge.id,
      },
      select: {
        type: true,
        awardedAt: true,
      },
      orderBy: { awardedAt: 'desc' },
    });

    return success({
      challenge: {
        ...challenge,
        rulesText: challengeRulesText(challenge),
        participationConfig,
      },
      you: you
        ? {
            rank: you.rank,
            score: you.score,
            scoreLabel: formatChallengeScore({
              score: you.score,
              type: challenge.type,
              scoringConfig: challenge.scoringConfig,
            }),
            sessionsCount: you.sessionsCount,
            progressPercent: youProgressPercent,
            deltaToLeaderLabel: formatChallengeScore({
              score: Math.max(0, leaderScore - you.score),
              type: challenge.type,
              scoringConfig: challenge.scoringConfig,
            }),
            joinedAt: you.joinedAt,
          }
        : null,
      leaderboard: fullLeaderboard.map((row) => ({
        rank: row.rank,
        athleteId: row.athleteId,
        athleteName: toName(row.athlete.user.name),
        score: row.score,
        sessionsCount: row.sessionsCount,
        scoreLabel: formatChallengeScore({
          score: row.score,
          type: challenge.type,
          scoringConfig: challenge.scoringConfig,
        }),
      })),
      badges: latestBadges,
      canJoin: !participationConfig.autoJoin && !you,
      joined: Boolean(you),
    });
  } catch (error) {
    return handleError(error);
  }
}
