import { NextRequest } from 'next/server';
import { ChallengeStatus } from '@prisma/client';

import { requireAthlete } from '@/lib/auth';
import { ApiError, forbidden, notFound } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { parseParticipationConfig } from '@/lib/challenges/config';
import { recomputeChallengeScores } from '@/lib/challenges/service';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, context: { params: { challengeId: string } }) {
  try {
    const { user } = await requireAthlete();

    const challenge = await prisma.challenge.findUnique({
      where: { id: context.params.challengeId },
      select: {
        id: true,
        squadId: true,
        status: true,
        startAt: true,
        endAt: true,
        isOngoing: true,
        participationConfig: true,
      },
    });

    if (!challenge) throw notFound('Challenge not found.');
    if (challenge.status !== ChallengeStatus.ACTIVE) {
      throw new ApiError(409, 'CHALLENGE_NOT_ACTIVE', 'Only active challenges can be joined.');
    }

    const membership = await prisma.squadMember.findUnique({
      where: {
        squadId_athleteId: {
          squadId: challenge.squadId,
          athleteId: user.id,
        },
      },
      select: { athleteId: true },
    });

    if (!membership) throw forbidden('You cannot join this challenge.');

    const participationConfig = parseParticipationConfig(challenge.participationConfig);
    if (participationConfig.autoJoin) {
      throw new ApiError(409, 'AUTO_JOIN_ENABLED', 'This challenge auto-enrolls athletes.');
    }

    if (!participationConfig.allowLateJoin && challenge.startAt.getTime() < Date.now()) {
      throw new ApiError(409, 'LATE_JOIN_DISABLED', 'Late joining is disabled for this challenge.');
    }

    await prisma.challengeParticipant.upsert({
      where: {
        challengeId_athleteId: {
          challengeId: challenge.id,
          athleteId: user.id,
        },
      },
      update: {},
      create: {
        challengeId: challenge.id,
        athleteId: user.id,
      },
    });

    await recomputeChallengeScores(challenge.id, { reason: 'athlete_join' });

    return success({ joined: true });
  } catch (error) {
    return handleError(error);
  }
}
