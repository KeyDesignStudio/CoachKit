import { ChallengeBadgeType, ChallengeStatus, ChallengeType, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import {
  challengeCreateSchema,
  challengeRulesSummary,
  parseParticipationConfig,
  parseRewardConfig,
  parseScoringConfig,
  type FrequencyScoringConfig,
  type PerformanceScoringConfig,
  type VolumeScoringConfig,
} from '@/lib/challenges/config';
import { ApiError, forbidden, notFound } from '@/lib/errors';

type ChallengeWithConfig = {
  id: string;
  coachId: string;
  squadId: string;
  status: ChallengeStatus;
  type: ChallengeType;
  startAt: Date;
  endAt: Date | null;
  isOngoing: boolean;
  disciplineScope: string[];
  scoringConfig: unknown;
  participationConfig: unknown;
  rewardConfig: unknown;
  title: string;
};

type ScoreRow = {
  athleteId: string;
  score: number;
  rankingValue: number;
  sessionsCount: number;
  lastContributingActivityAt: Date | null;
};

export type ChallengeScoreRowForRanking = ScoreRow;

type CompletionActivityRow = {
  athleteId: string;
  startTime: Date;
  durationMinutes: number;
  distanceKm: number | null;
  metricsJson: Prisma.JsonValue;
  calendarItem: {
    discipline: string;
  } | null;
};

const MAX_CHALLENGE_DURATION_DAYS = 365;

function logChallengeEvent(event: string, payload: Record<string, unknown>) {
  console.info('[challenge:event]', { event, ...payload });
}

function normalizeDiscipline(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase();
}

function getActivityDiscipline(activity: CompletionActivityRow): string {
  if (activity.calendarItem?.discipline) return normalizeDiscipline(activity.calendarItem.discipline);
  const metrics = (activity.metricsJson ?? {}) as Record<string, unknown>;
  const strava = (metrics.strava ?? {}) as Record<string, unknown>;
  const sportType = normalizeDiscipline(String(strava.sportType ?? strava.type ?? ''));
  if (sportType.includes('RUN')) return 'RUN';
  if (sportType.includes('RIDE') || sportType.includes('BIKE') || sportType.includes('CYCLE')) return 'BIKE';
  if (sportType.includes('SWIM')) return 'SWIM';
  return sportType;
}

function isIndoorActivity(activity: CompletionActivityRow): boolean {
  const metrics = (activity.metricsJson ?? {}) as Record<string, unknown>;
  const strava = (metrics.strava ?? {}) as Record<string, unknown>;
  const candidates = [strava.trainer, strava.indoor, strava.isVirtual];
  return candidates.some((value) => value === true || value === 'true' || value === 1);
}

function readElevationMeters(activity: CompletionActivityRow): number {
  const metrics = (activity.metricsJson ?? {}) as Record<string, unknown>;
  const strava = (metrics.strava ?? {}) as Record<string, unknown>;
  const direct = Number(strava.totalElevationGain ?? strava.elevationGainMeters ?? strava.elevGain);
  return Number.isFinite(direct) && direct > 0 ? direct : 0;
}

function readAverageWatts(activity: CompletionActivityRow): number {
  const metrics = (activity.metricsJson ?? {}) as Record<string, unknown>;
  const strava = (metrics.strava ?? {}) as Record<string, unknown>;
  const value = Number(strava.averageWatts ?? strava.weightedAverageWatts ?? strava.avgWatts);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function qualifiesByDiscipline(scope: string[], activity: CompletionActivityRow): boolean {
  if (!scope.length) return true;
  const discipline = getActivityDiscipline(activity);
  if (!discipline) return false;
  return scope.includes(discipline);
}

function hasStarted(challenge: ChallengeWithConfig, now = new Date()) {
  return challenge.startAt.getTime() <= now.getTime();
}

function getScoreWindow(challenge: ChallengeWithConfig, now = new Date()): { from: Date; to: Date } {
  const to = challenge.endAt ? new Date(Math.min(challenge.endAt.getTime(), now.getTime())) : now;
  return { from: challenge.startAt, to };
}

function getDurationDays(startAt: Date, endAt: Date | null, isOngoing: boolean): number | null {
  if (isOngoing || !endAt) return null;
  const ms = endAt.getTime() - startAt.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function assertChallengeDurationValid(startAt: Date, endAt: Date | null, isOngoing: boolean) {
  const days = getDurationDays(startAt, endAt, isOngoing);
  if (days != null && days > MAX_CHALLENGE_DURATION_DAYS) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', `Challenge cannot exceed ${MAX_CHALLENGE_DURATION_DAYS} days.`);
  }
}

function computeScoreRow(params: {
  challenge: ChallengeWithConfig;
  activities: CompletionActivityRow[];
}): Omit<ScoreRow, 'athleteId'> {
  const { challenge, activities } = params;
  const scoringConfig = parseScoringConfig(challenge.type, challenge.scoringConfig);

  if (challenge.type === ChallengeType.VOLUME) {
    const config = scoringConfig as VolumeScoringConfig;
    const qualifying = activities.filter((activity) => {
      if (config.minSessionDurationMinutes && activity.durationMinutes < config.minSessionDurationMinutes) return false;
      if (!config.includeIndoor && isIndoorActivity(activity)) return false;
      if (!qualifiesByDiscipline(challenge.disciplineScope, activity)) return false;
      return true;
    });

    const score =
      config.metric === 'distance'
        ? qualifying.reduce((sum, activity) => sum + (activity.distanceKm ?? 0) * 1000, 0)
        : config.metric === 'time'
          ? qualifying.reduce((sum, activity) => sum + Math.max(0, activity.durationMinutes) * 60, 0)
          : qualifying.reduce((sum, activity) => sum + readElevationMeters(activity), 0);

    const last = qualifying.reduce<Date | null>((latest, activity) => {
      if (!latest || activity.startTime.getTime() > latest.getTime()) return activity.startTime;
      return latest;
    }, null);

    return {
      score,
      rankingValue: score,
      sessionsCount: qualifying.length,
      lastContributingActivityAt: last,
    };
  }

  if (challenge.type === ChallengeType.FREQUENCY) {
    const config = scoringConfig as FrequencyScoringConfig;
    const qualifying = activities.filter((activity) => {
      if (config.minSessionDurationMinutes && activity.durationMinutes < config.minSessionDurationMinutes) return false;
      if (!qualifiesByDiscipline(challenge.disciplineScope, activity)) return false;
      return true;
    });

    const score = qualifying.length;
    const last = qualifying.reduce<Date | null>((latest, activity) => {
      if (!latest || activity.startTime.getTime() > latest.getTime()) return activity.startTime;
      return latest;
    }, null);

    return {
      score,
      rankingValue: score,
      sessionsCount: qualifying.length,
      lastContributingActivityAt: last,
    };
  }

  if (challenge.type === ChallengeType.PERFORMANCE) {
    const config = scoringConfig as PerformanceScoringConfig;
    const qualifying = activities.filter((activity) => qualifiesByDiscipline(challenge.disciplineScope, activity));
    const withSpeed = qualifying
      .map((activity) => {
        const meters = Math.max(0, (activity.distanceKm ?? 0) * 1000);
        const seconds = Math.max(1, activity.durationMinutes * 60);
        return {
          activity,
          meters,
          speedMps: meters > 0 ? meters / seconds : 0,
        };
      })
      .filter((entry) => entry.speedMps > 0);

    const rankingValue =
      config.metric === 'highest_average_power'
        ? qualifying.reduce((max, activity) => Math.max(max, readAverageWatts(activity)), 0)
        : config.metric === 'fastest_5km'
          ? withSpeed.filter((entry) => entry.meters >= 5000).reduce((max, entry) => Math.max(max, entry.speedMps), 0)
          : withSpeed.reduce((max, entry) => Math.max(max, entry.speedMps), 0);

    const scoringSessions =
      config.metric === 'highest_average_power'
        ? qualifying.filter((activity) => readAverageWatts(activity) > 0)
        : config.metric === 'fastest_5km'
          ? withSpeed.filter((entry) => entry.meters >= 5000).map((entry) => entry.activity)
          : withSpeed.map((entry) => entry.activity);

    const last = scoringSessions.reduce<Date | null>((latest, activity) => {
      if (!latest || activity.startTime.getTime() > latest.getTime()) return activity.startTime;
      return latest;
    }, null);

    return {
      score: rankingValue,
      rankingValue,
      sessionsCount: scoringSessions.length,
      lastContributingActivityAt: last,
    };
  }

  const qualifying = activities.filter((activity) => qualifiesByDiscipline(challenge.disciplineScope, activity));
  const score = qualifying.reduce((sum, activity) => {
    const metrics = (activity.metricsJson ?? {}) as Record<string, unknown>;
    const points = Number((metrics.challenge ?? {}) && (metrics.challenge as Record<string, unknown>).points);
    return sum + (Number.isFinite(points) ? points : 0);
  }, 0);

  const last = qualifying.reduce<Date | null>((latest, activity) => {
    if (!latest || activity.startTime.getTime() > latest.getTime()) return activity.startTime;
    return latest;
  }, null);

  return {
    score,
    rankingValue: score,
    sessionsCount: qualifying.length,
    lastContributingActivityAt: last,
  };
}

function sortScoreRows(rows: ScoreRow[]) {
  rows.sort((a, b) => {
    if (b.rankingValue !== a.rankingValue) return b.rankingValue - a.rankingValue;

    const aTime = a.lastContributingActivityAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bTime = b.lastContributingActivityAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;

    return a.athleteId.localeCompare(b.athleteId);
  });

  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function rankChallengeScoreRows(rows: ChallengeScoreRowForRanking[]) {
  return sortScoreRows(rows.map((row) => ({ ...row })));
}

export async function ensureCoachOwnsChallenge(challengeId: string, coachId: string) {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      coachId: true,
      squadId: true,
      status: true,
      type: true,
      title: true,
      description: true,
      startAt: true,
      endAt: true,
      isOngoing: true,
      disciplineScope: true,
      scoringConfig: true,
      participationConfig: true,
      rewardConfig: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      completedAt: true,
      squad: { select: { id: true, name: true } },
    },
  });

  if (!challenge) throw notFound('Challenge not found.');
  if (challenge.coachId !== coachId) throw forbidden('You cannot access this challenge.');
  return challenge;
}

export async function createChallenge(input: unknown, coachId: string) {
  const payload = challengeCreateSchema.parse(input);
  assertChallengeDurationValid(payload.startAt, payload.endAt ?? null, payload.isOngoing);

  const squad = await prisma.squad.findFirst({ where: { id: payload.squadId, coachId }, select: { id: true } });
  if (!squad) throw forbidden('You can only create challenges in your own squads.');

  const scoringConfig = parseScoringConfig(payload.type, payload.scoringConfig);
  const participationConfig = parseParticipationConfig(payload.participationConfig);
  const rewardConfig = parseRewardConfig(payload.rewardConfig);

  const challenge = await prisma.challenge.create({
    data: {
      coachId,
      squadId: payload.squadId,
      title: payload.title,
      description: payload.description ?? null,
      type: payload.type,
      status: payload.status,
      startAt: payload.startAt,
      endAt: payload.isOngoing ? null : (payload.endAt ?? null),
      isOngoing: payload.isOngoing,
      disciplineScope: payload.disciplineScope.map((value) => normalizeDiscipline(value)).filter(Boolean),
      scoringConfig: scoringConfig as unknown as Prisma.InputJsonValue,
      participationConfig: participationConfig as unknown as Prisma.InputJsonValue,
      rewardConfig: rewardConfig as unknown as Prisma.InputJsonValue,
      publishedAt: payload.status === ChallengeStatus.ACTIVE ? new Date() : null,
    },
    select: {
      id: true,
      title: true,
      status: true,
      squadId: true,
      type: true,
      startAt: true,
      endAt: true,
      isOngoing: true,
      disciplineScope: true,
      scoringConfig: true,
      participationConfig: true,
      rewardConfig: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      completedAt: true,
    },
  });

  if (challenge.status === ChallengeStatus.ACTIVE) {
    await recomputeChallengeScores(challenge.id, { reason: 'publish' });
    logChallengeEvent('challenges_published', { challengeId: challenge.id, coachId, squadId: challenge.squadId });
  }

  logChallengeEvent('challenges_created', { challengeId: challenge.id, coachId, squadId: challenge.squadId, notifySquad: payload.notifySquad });

  return challenge;
}

export async function recomputeChallengeScores(challengeId: string, options?: { reason?: string; now?: Date }) {
  const now = options?.now ?? new Date();

  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      coachId: true,
      squadId: true,
      status: true,
      type: true,
      startAt: true,
      endAt: true,
      isOngoing: true,
      disciplineScope: true,
      scoringConfig: true,
      participationConfig: true,
      rewardConfig: true,
      title: true,
    },
  });

  if (!challenge) throw notFound('Challenge not found.');

  if (challenge.status !== ChallengeStatus.ACTIVE) {
    return {
      challengeId,
      updatedParticipants: 0,
      skipped: 'not_active' as const,
    };
  }

  if (!hasStarted(challenge, now)) {
    return {
      challengeId,
      updatedParticipants: 0,
      skipped: 'not_started' as const,
    };
  }

  const participationConfig = parseParticipationConfig(challenge.participationConfig);

  const eligibleMembers = await prisma.squadMember.findMany({
    where: { squadId: challenge.squadId },
    select: { athleteId: true },
  });
  const eligibleAthleteIds = Array.from(new Set(eligibleMembers.map((member) => member.athleteId))).sort();

  if (participationConfig.autoJoin && eligibleAthleteIds.length) {
    await prisma.challengeParticipant.createMany({
      data: eligibleAthleteIds.map((athleteId) => ({ challengeId: challenge.id, athleteId })),
      skipDuplicates: true,
    });
  }

  const participants = await prisma.challengeParticipant.findMany({
    where: { challengeId: challenge.id },
    select: { id: true, athleteId: true, joinedAt: true },
  });

  const participantAthleteIds = Array.from(
    new Set(
      participants
        .filter((participant) => {
          if (eligibleAthleteIds.length && !eligibleAthleteIds.includes(participant.athleteId)) return false;
          if (!participationConfig.allowLateJoin && participant.joinedAt.getTime() > challenge.startAt.getTime()) return false;
          return true;
        })
        .map((participant) => participant.athleteId)
    )
  );

  if (!participantAthleteIds.length) {
    return {
      challengeId,
      updatedParticipants: 0,
      skipped: 'no_participants' as const,
    };
  }

  const scoreWindow = getScoreWindow(challenge, now);
  const activities = await prisma.completedActivity.findMany({
    where: {
      athleteId: { in: participantAthleteIds },
      startTime: { gte: scoreWindow.from, lte: scoreWindow.to },
    },
    select: {
      athleteId: true,
      startTime: true,
      durationMinutes: true,
      distanceKm: true,
      metricsJson: true,
      calendarItem: { select: { discipline: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  const byAthlete = new Map<string, CompletionActivityRow[]>();
  for (const athleteId of participantAthleteIds) byAthlete.set(athleteId, []);
  for (const activity of activities) {
    const list = byAthlete.get(activity.athleteId);
    if (!list) continue;
    list.push(activity);
  }

  const rows: ScoreRow[] = participantAthleteIds.map((athleteId) => {
    const computed = computeScoreRow({ challenge, activities: byAthlete.get(athleteId) ?? [] });
    return {
      athleteId,
      score: computed.score,
      rankingValue: computed.rankingValue,
      sessionsCount: computed.sessionsCount,
      lastContributingActivityAt: computed.lastContributingActivityAt,
    };
  });

  const ranked = sortScoreRows(rows);

  await prisma.$transaction(
    ranked.map((row) =>
      prisma.challengeParticipant.updateMany({
        where: { challengeId: challenge.id, athleteId: row.athleteId },
        data: {
          score: row.score,
          sessionsCount: row.sessionsCount,
          lastContributingActivityAt: row.lastContributingActivityAt,
          rank: row.rank,
        },
      })
    )
  );

  logChallengeEvent('challenge_recomputed', {
    challengeId,
    reason: options?.reason ?? 'unknown',
    participants: ranked.length,
  });

  return {
    challengeId,
    updatedParticipants: ranked.length,
    skipped: null,
  };
}

export async function duplicateChallenge(challengeId: string, coachId: string) {
  const source = await ensureCoachOwnsChallenge(challengeId, coachId);

  const duplicated = await prisma.challenge.create({
    data: {
      coachId,
      squadId: source.squadId,
      seriesId: null,
      title: `${source.title} (Copy)`,
      description: source.description ?? null,
      status: ChallengeStatus.DRAFT,
      startAt: source.startAt,
      endAt: source.endAt,
      isOngoing: source.isOngoing,
      disciplineScope: source.disciplineScope,
      type: source.type,
      scoringConfig: source.scoringConfig as Prisma.InputJsonValue,
      participationConfig: source.participationConfig as Prisma.InputJsonValue,
      rewardConfig: source.rewardConfig as Prisma.InputJsonValue,
    },
    select: { id: true, title: true, status: true, createdAt: true },
  });

  return duplicated;
}

export async function maybeCompleteChallenge(challengeId: string, now = new Date()) {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      status: true,
      isOngoing: true,
      endAt: true,
      rewardConfig: true,
    },
  });

  if (!challenge) return null;
  if (challenge.status !== ChallengeStatus.ACTIVE) return null;
  if (challenge.isOngoing || !challenge.endAt) return null;
  if (challenge.endAt.getTime() > now.getTime()) return null;

  await recomputeChallengeScores(challenge.id, { reason: 'completion', now: challenge.endAt });

  const rewardConfig = parseRewardConfig(challenge.rewardConfig);
  const participants = await prisma.challengeParticipant.findMany({
    where: { challengeId: challenge.id },
    select: { athleteId: true, rank: true, sessionsCount: true },
    orderBy: [{ rank: 'asc' }, { athleteId: 'asc' }],
  });

  await prisma.$transaction(async (tx) => {
    await tx.challenge.update({
      where: { id: challenge.id },
      data: {
        status: ChallengeStatus.COMPLETED,
        completedAt: now,
      },
    });

    if (rewardConfig.participationBadge) {
      const participationIds = participants.filter((row) => row.sessionsCount > 0).map((row) => row.athleteId);
      if (participationIds.length) {
        await tx.badgeAward.createMany({
          data: participationIds.map((athleteId) => ({
            athleteId,
            challengeId: challenge.id,
            type: ChallengeBadgeType.PARTICIPATION,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (rewardConfig.winnerBadges) {
      const top = participants.filter((row) => typeof row.rank === 'number' && row.rank! <= 3);
      const awardTypeForRank: Record<number, ChallengeBadgeType> = {
        1: ChallengeBadgeType.GOLD,
        2: ChallengeBadgeType.SILVER,
        3: ChallengeBadgeType.BRONZE,
      };
      if (top.length) {
        await tx.badgeAward.createMany({
          data: top.map((row) => ({
            athleteId: row.athleteId,
            challengeId: challenge.id,
            type: awardTypeForRank[row.rank as 1 | 2 | 3],
          })),
          skipDuplicates: true,
        });
      }
    }
  });

  return challenge.id;
}

export async function completeDueChallenges(now = new Date()) {
  const due = await prisma.challenge.findMany({
    where: {
      status: ChallengeStatus.ACTIVE,
      isOngoing: false,
      endAt: { not: null, lte: now },
    },
    select: { id: true },
  });

  let completed = 0;
  for (const row of due) {
    const result = await maybeCompleteChallenge(row.id, now);
    if (result) completed += 1;
  }

  return { due: due.length, completed };
}

export async function recomputeChallengesForAthleteActivity(params: {
  athleteId: string;
  activityStartTime: Date;
}) {
  const memberships = await prisma.squadMember.findMany({
    where: { athleteId: params.athleteId },
    select: { squadId: true },
  });

  const squadIds = Array.from(new Set(memberships.map((membership) => membership.squadId)));
  if (!squadIds.length) return { touched: 0 };

  const relevant = await prisma.challenge.findMany({
    where: {
      status: ChallengeStatus.ACTIVE,
      squadId: { in: squadIds },
      startAt: { lte: params.activityStartTime },
      OR: [{ isOngoing: true }, { endAt: null }, { endAt: { gte: params.activityStartTime } }],
    },
    select: { id: true },
  });

  for (const challenge of relevant) {
    try {
      await recomputeChallengeScores(challenge.id, { reason: 'activity_ingestion' });
    } catch (error) {
      console.error('[challenge] recompute failed after activity ingest', {
        challengeId: challenge.id,
        athleteId: params.athleteId,
        error,
      });
    }
  }

  return { touched: relevant.length };
}

export function challengeScoreUnit(challenge: {
  type: ChallengeType;
  scoringConfig: unknown;
}): string {
  const parsed = parseScoringConfig(challenge.type, challenge.scoringConfig);

  if (challenge.type === ChallengeType.VOLUME) {
    const metric = (parsed as VolumeScoringConfig).metric;
    if (metric === 'distance') return 'm';
    if (metric === 'time') return 'sec';
    return 'm';
  }

  if (challenge.type === ChallengeType.FREQUENCY) return 'sessions';

  if (challenge.type === ChallengeType.PERFORMANCE) {
    const metric = (parsed as PerformanceScoringConfig).metric;
    if (metric === 'highest_average_power') return 'W';
    return 'm/s';
  }

  return 'pts';
}

export function formatChallengeScore(params: { score: number; type: ChallengeType; scoringConfig: unknown }): string {
  const score = Number.isFinite(params.score) ? params.score : 0;
  const config = parseScoringConfig(params.type, params.scoringConfig);

  if (params.type === ChallengeType.VOLUME) {
    const metric = (config as VolumeScoringConfig).metric;
    if (metric === 'distance') return `${(score / 1000).toFixed(1)} km`;
    if (metric === 'time') {
      const mins = Math.round(score / 60);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    return `${Math.round(score)} m`;
  }

  if (params.type === ChallengeType.FREQUENCY) {
    return `${Math.round(score)} sessions`;
  }

  if (params.type === ChallengeType.PERFORMANCE) {
    const metric = (config as PerformanceScoringConfig).metric;
    if (metric === 'highest_average_power') return `${Math.round(score)} W`;
    return `${score.toFixed(2)} m/s`;
  }

  return `${Math.round(score)} pts`;
}

export function mapChallengeWindowLabel(challenge: {
  startAt: Date;
  endAt: Date | null;
  isOngoing: boolean;
}) {
  if (challenge.isOngoing || !challenge.endAt) return 'Ongoing';
  return `${challenge.startAt.toISOString().slice(0, 10)} to ${challenge.endAt.toISOString().slice(0, 10)}`;
}

export function challengeRulesText(challenge: {
  type: ChallengeType;
  scoringConfig: unknown;
}) {
  return challengeRulesSummary(challenge.type, challenge.scoringConfig);
}
