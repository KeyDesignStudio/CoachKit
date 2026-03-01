import { NextRequest } from 'next/server';
import { ChallengeStatus, Prisma } from '@prisma/client';
import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import {
  challengeRulesText,
  ensureCoachOwnsChallenge,
  formatChallengeScore,
  maybeCompleteChallenge,
  recomputeChallengeScores,
} from '@/lib/challenges/service';
import { parseParticipationConfig, parseRewardConfig, parseScoringConfig } from '@/lib/challenges/config';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(4000).optional().nullable(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional().nullable(),
    isOngoing: z.boolean().optional(),
    disciplineScope: z.array(z.string().trim().min(1).max(32)).max(16).optional(),
    scoringConfig: z.record(z.unknown()).optional(),
    participationConfig: z.record(z.unknown()).optional(),
    rewardConfig: z.record(z.unknown()).optional(),
    status: z.nativeEnum(ChallengeStatus).optional(),
    action: z.enum(['PUBLISH', 'END_EARLY', 'ARCHIVE', 'EXTEND_END_DATE', 'UNARCHIVE']).optional(),
    extendEndAt: z.coerce.date().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.action === 'EXTEND_END_DATE' && !input.extendEndAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'extendEndAt is required for EXTEND_END_DATE.',
        path: ['extendEndAt'],
      });
    }
  });

function toName(value: string | null | undefined) {
  return String(value ?? '').trim() || 'Athlete';
}

function scoreProgressPercent(params: {
  score: number;
  challengeType: string;
  targetCount: number | null;
  leaderScore: number;
}) {
  if (params.targetCount && params.targetCount > 0) {
    return Math.max(0, Math.min(100, (params.score / params.targetCount) * 100));
  }

  if (params.leaderScore <= 0) return 0;
  return Math.max(0, Math.min(100, (params.score / params.leaderScore) * 100));
}

export async function GET(_request: NextRequest, context: { params: { challengeId: string } }) {
  try {
    const { user } = await requireCoach();
    await maybeCompleteChallenge(context.params.challengeId);
    const challenge = await ensureCoachOwnsChallenge(context.params.challengeId, user.id);

    const [participants, eligibleMembers] = await Promise.all([
      prisma.challengeParticipant.findMany({
        where: { challengeId: challenge.id },
        select: {
          athleteId: true,
          joinedAt: true,
          score: true,
          rank: true,
          sessionsCount: true,
          lastContributingActivityAt: true,
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
      }),
      prisma.squadMember.findMany({
        where: { squadId: challenge.squadId },
        select: {
          athleteId: true,
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
        orderBy: { athleteId: 'asc' },
      }),
    ]);

    const participationConfig = parseParticipationConfig(challenge.participationConfig);
    const rewardConfig = parseRewardConfig(challenge.rewardConfig);
    const scoringConfig = parseScoringConfig(challenge.type, challenge.scoringConfig);

    const leaderboard = participants.filter((row) => row.rank != null);
    const leaderScore = leaderboard.length ? leaderboard[0].score : 0;

    const targetCount =
      challenge.type === 'FREQUENCY'
        ? Number((scoringConfig as unknown as { targetCount?: number | null }).targetCount ?? null) || null
        : null;

    const leaderboardRows = leaderboard.map((row) => ({
      rank: row.rank,
      athleteId: row.athleteId,
      athleteName: toName(row.athlete.user.name),
      score: row.score,
      scoreLabel: formatChallengeScore({
        score: row.score,
        type: challenge.type,
        scoringConfig: challenge.scoringConfig,
      }),
      sessions: row.sessionsCount,
      deltaToLeaderLabel: formatChallengeScore({
        score: Math.max(0, leaderScore - row.score),
        type: challenge.type,
        scoringConfig: challenge.scoringConfig,
      }),
      progressPercent: scoreProgressPercent({
        score: row.score,
        challengeType: challenge.type,
        targetCount,
        leaderScore,
      }),
      lastContributingActivityAt: row.lastContributingActivityAt,
    }));

    const joinedSet = new Set(participants.map((row) => row.athleteId));
    const participationPercent = eligibleMembers.length
      ? Math.round((participants.length / eligibleMembers.length) * 100)
      : 0;

    const totalSessionsLogged = participants.reduce((sum, row) => sum + row.sessionsCount, 0);
    const totalVolumeGenerated =
      challenge.type === 'VOLUME' ? participants.reduce((sum, row) => sum + row.score, 0) : 0;
    const avgSessionsPerAthlete = eligibleMembers.length ? totalSessionsLogged / eligibleMembers.length : 0;

    const durationMs =
      challenge.endAt && challenge.endAt.getTime() > challenge.startAt.getTime()
        ? challenge.endAt.getTime() - challenge.startAt.getTime()
        : 7 * 24 * 60 * 60 * 1000;
    const previousPeriodStart = new Date(challenge.startAt.getTime() - durationMs);
    const previousPeriodEnd = new Date(challenge.startAt.getTime() - 1);

    const previousSessions = await prisma.completedActivity.count({
      where: {
        athleteId: { in: eligibleMembers.map((row) => row.athleteId) },
        startTime: { gte: previousPeriodStart, lte: previousPeriodEnd },
      },
    });
    const previousAvgSessionsPerAthlete = eligibleMembers.length ? previousSessions / eligibleMembers.length : 0;

    const badges = await prisma.badgeAward.findMany({
      where: { challengeId: challenge.id },
      select: {
        athleteId: true,
        type: true,
        awardedAt: true,
      },
      orderBy: [{ awardedAt: 'desc' }],
    });

    return success({
      challenge: {
        ...challenge,
        rulesText: challengeRulesText(challenge),
        participationConfig,
        rewardConfig,
      },
      leaderboard: leaderboardRows,
      participants: eligibleMembers.map((row) => ({
        athleteId: row.athleteId,
        athleteName: toName(row.athlete.user.name),
        joined: joinedSet.has(row.athleteId),
      })),
      analytics: {
        participationPercent,
        totalSessionsLogged,
        totalVolumeGenerated,
        avgSessionsPerAthlete,
        previousAvgSessionsPerAthlete,
      },
      badges,
      featureFlags: {
        canRecalculate: challenge.status === ChallengeStatus.ACTIVE,
        canEdit: challenge.status === ChallengeStatus.DRAFT || challenge.status === ChallengeStatus.ACTIVE,
        canPublish: challenge.status === ChallengeStatus.DRAFT,
        canArchive: challenge.status !== ChallengeStatus.ARCHIVED,
        canEndEarly: challenge.status === ChallengeStatus.ACTIVE,
        canExtend: challenge.status === ChallengeStatus.ACTIVE,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: { challengeId: string } }) {
  try {
    const { user } = await requireCoach();
    const payload = updateSchema.parse(await request.json());
    const challenge = await ensureCoachOwnsChallenge(context.params.challengeId, user.id);

    if (payload.action === 'PUBLISH') {
      if (challenge.status !== ChallengeStatus.DRAFT) {
        throw new ApiError(409, 'INVALID_CHALLENGE_STATE', 'Only draft challenges can be published.');
      }

      const updated = await prisma.challenge.update({
        where: { id: challenge.id },
        data: {
          status: ChallengeStatus.ACTIVE,
          publishedAt: new Date(),
        },
        select: { id: true, status: true, publishedAt: true },
      });
      await recomputeChallengeScores(challenge.id, { reason: 'publish' });
      return success({ challenge: updated });
    }

    if (payload.action === 'END_EARLY') {
      if (challenge.status !== ChallengeStatus.ACTIVE) {
        throw new ApiError(409, 'INVALID_CHALLENGE_STATE', 'Only active challenges can end early.');
      }
      const now = new Date();
      await prisma.challenge.update({
        where: { id: challenge.id },
        data: {
          endAt: now,
          isOngoing: false,
        },
      });
      await maybeCompleteChallenge(challenge.id, now);
      return success({ ended: true });
    }

    if (payload.action === 'ARCHIVE') {
      const archived = await prisma.challenge.update({
        where: { id: challenge.id },
        data: { status: ChallengeStatus.ARCHIVED },
        select: { id: true, status: true },
      });
      return success({ challenge: archived });
    }

    if (payload.action === 'UNARCHIVE') {
      const status = challenge.completedAt ? ChallengeStatus.COMPLETED : ChallengeStatus.DRAFT;
      const unarchived = await prisma.challenge.update({
        where: { id: challenge.id },
        data: { status },
        select: { id: true, status: true },
      });
      return success({ challenge: unarchived });
    }

    if (payload.action === 'EXTEND_END_DATE') {
      if (challenge.status !== ChallengeStatus.ACTIVE) {
        throw new ApiError(409, 'INVALID_CHALLENGE_STATE', 'Only active challenges can be extended.');
      }
      const nextEnd = payload.extendEndAt as Date;
      if (nextEnd.getTime() <= Date.now()) {
        throw new ApiError(400, 'INVALID_END_DATE', 'Extended end date must be in the future.');
      }

      const updated = await prisma.challenge.update({
        where: { id: challenge.id },
        data: {
          endAt: nextEnd,
          isOngoing: false,
        },
        select: { id: true, endAt: true, isOngoing: true },
      });

      return success({ challenge: updated });
    }

    const nextScoringConfig = payload.scoringConfig ? parseScoringConfig(challenge.type, payload.scoringConfig) : challenge.scoringConfig;
    const nextParticipationConfig = payload.participationConfig
      ? parseParticipationConfig(payload.participationConfig)
      : parseParticipationConfig(challenge.participationConfig);
    const nextRewardConfig = payload.rewardConfig
      ? parseRewardConfig(payload.rewardConfig)
      : parseRewardConfig(challenge.rewardConfig);

    const updated = await prisma.challenge.update({
      where: { id: challenge.id },
      data: {
        title: payload.title,
        description: payload.description,
        startAt: payload.startAt,
        endAt: payload.isOngoing ? null : (payload.endAt ?? undefined),
        isOngoing: payload.isOngoing,
        disciplineScope: payload.disciplineScope?.map((value) => String(value).trim().toUpperCase()).filter(Boolean),
        scoringConfig: payload.scoringConfig
          ? (nextScoringConfig as unknown as Prisma.InputJsonValue)
          : undefined,
        participationConfig: payload.participationConfig
          ? (nextParticipationConfig as unknown as Prisma.InputJsonValue)
          : undefined,
        rewardConfig: payload.rewardConfig ? (nextRewardConfig as unknown as Prisma.InputJsonValue) : undefined,
        status: payload.status,
      },
      select: {
        id: true,
        title: true,
        status: true,
        startAt: true,
        endAt: true,
        isOngoing: true,
        updatedAt: true,
      },
    });

    if (challenge.status === ChallengeStatus.ACTIVE) {
      await recomputeChallengeScores(challenge.id, { reason: 'settings_update' });
    }

    return success({ challenge: updated });
  } catch (error) {
    return handleError(error);
  }
}
