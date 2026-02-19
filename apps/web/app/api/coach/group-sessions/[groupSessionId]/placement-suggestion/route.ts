import { NextRequest } from 'next/server';
import { GroupVisibilityType } from '@prisma/client';
import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { notFound, ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { parseWeeklyRecurrenceRule } from '@/lib/recurrence';

export const dynamic = 'force-dynamic';

const dayTokenByIndex = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
type DayToken = (typeof dayTokenByIndex)[number];

const querySchema = z.object({
  lookbackDays: z.coerce.number().int().min(7).max(56).default(21),
});

type RouteParams = {
  params: {
    groupSessionId: string;
  };
};

type DayStats = {
  day: DayToken;
  plannedCount: number;
  completedCount: number;
  painCount: number;
  loadMinutes: number;
  score: number;
  complianceRate: number;
  painRate: number;
};

function isCompletedStatus(status: string) {
  return status === 'COMPLETED_MANUAL' || status === 'COMPLETED_SYNCED' || status === 'COMPLETED_SYNCED_DRAFT';
}

function mostCommonTime(times: string[], fallback: string) {
  if (!times.length) return fallback;
  const frequency = new Map<string, number>();
  for (const time of times) {
    frequency.set(time, (frequency.get(time) ?? 0) + 1);
  }
  return [...frequency.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? fallback;
}

function round(value: number, precision = 3) {
  const power = 10 ** precision;
  return Math.round(value * power) / power;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { user } = await requireCoach();
    const { lookbackDays } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));

    const groupSession = await prisma.groupSession.findFirst({
      where: { id: params.groupSessionId, coachId: user.id },
      include: { targets: true },
    });

    if (!groupSession) {
      throw notFound('Group session not found.');
    }

    const targetAthleteIds = await resolveTargetAthletes(groupSession, user.id);
    if (!targetAthleteIds.length) {
      throw new ApiError(400, 'NO_TARGET_ATHLETES', 'No athletes matched the group session targets.');
    }

    const start = new Date();
    start.setUTCDate(start.getUTCDate() - lookbackDays);
    start.setUTCHours(0, 0, 0, 0);

    const items = await prisma.calendarItem.findMany({
      where: {
        coachId: user.id,
        athleteId: { in: targetAthleteIds },
        date: { gte: start },
      },
      select: {
        date: true,
        plannedDurationMinutes: true,
        plannedStartTimeLocal: true,
        status: true,
        completedActivities: {
          orderBy: [{ createdAt: 'desc' }],
          take: 1,
          select: {
            durationMinutes: true,
            painFlag: true,
          },
        },
      },
    });

    const aggregate = new Map<DayToken, Omit<DayStats, 'day' | 'score' | 'complianceRate' | 'painRate'>>();
    const allStartTimes: string[] = [];
    for (const token of dayTokenByIndex) {
      aggregate.set(token, {
        plannedCount: 0,
        completedCount: 0,
        painCount: 0,
        loadMinutes: 0,
      });
    }

    for (const item of items) {
      const day = dayTokenByIndex[item.date.getUTCDay()];
      const dayStats = aggregate.get(day);
      if (!dayStats) continue;

      dayStats.plannedCount += 1;

      const completion = item.completedActivities[0] ?? null;
      const completed = completion != null || isCompletedStatus(item.status);
      if (completed) {
        dayStats.completedCount += 1;
      }
      if (completion?.painFlag) {
        dayStats.painCount += 1;
      }

      const load = Math.max(0, completion?.durationMinutes ?? item.plannedDurationMinutes ?? 0);
      dayStats.loadMinutes += load;

      if (item.plannedStartTimeLocal) {
        allStartTimes.push(item.plannedStartTimeLocal);
      }
    }

    const maxLoad = Math.max(
      1,
      ...dayTokenByIndex.map((token) => (aggregate.get(token)?.loadMinutes ?? 0) / Math.max(1, targetAthleteIds.length))
    );

    const dayStats: DayStats[] = dayTokenByIndex.map((day) => {
      const raw = aggregate.get(day)!;
      const avgLoadPerAthlete = raw.loadMinutes / Math.max(1, targetAthleteIds.length);
      const complianceRate = raw.plannedCount > 0 ? raw.completedCount / raw.plannedCount : 0.5;
      const painRate = raw.completedCount > 0 ? raw.painCount / raw.completedCount : 0;
      const loadPenalty = avgLoadPerAthlete / maxLoad;
      const dataPresence = Math.min(1, raw.plannedCount / Math.max(1, targetAthleteIds.length));
      const unknownPenalty = raw.plannedCount === 0 ? 0.25 : 0;

      const score = 0.45 * (1 - loadPenalty) + 0.25 * complianceRate + 0.2 * (1 - painRate) + 0.1 * dataPresence - unknownPenalty;
      return {
        day,
        plannedCount: raw.plannedCount,
        completedCount: raw.completedCount,
        painCount: raw.painCount,
        loadMinutes: raw.loadMinutes,
        score: round(score),
        complianceRate: round(complianceRate),
        painRate: round(painRate),
      };
    });

    const sorted = [...dayStats].sort((a, b) => b.score - a.score || a.day.localeCompare(b.day));
    const recommendedDays = sorted.slice(0, 2).map((item) => item.day);

    const fallbackDays = parseWeeklyRecurrenceRule(groupSession.recurrenceRule).byDayTokens;
    const selectedDays = recommendedDays.length ? recommendedDays : (fallbackDays as DayToken[]);
    const suggestedStartTimeLocal = mostCommonTime(allStartTimes, groupSession.startTimeLocal);

    const averageScore = dayStats.reduce((sum, day) => sum + day.score, 0) / dayStats.length;
    const topScore = sorted[0]?.score ?? 0;
    const confidence = topScore >= averageScore + 0.15 ? 'HIGH' : topScore >= averageScore + 0.07 ? 'MEDIUM' : 'LOW';

    return success({
      suggestion: {
        model: 'signal-placement-v1',
        confidence,
        selectedDays,
        suggestedStartTimeLocal,
        rationale:
          confidence === 'LOW'
            ? 'Limited contrast across weekdays. Suggested cadence keeps a conservative distribution.'
            : 'Suggested days reduce recent load pressure while favoring steadier completion and lower pain signals.',
      },
      metrics: {
        lookbackDays,
        targetAthleteCount: targetAthleteIds.length,
        weekday: dayStats,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

async function resolveTargetAthletes(
  groupSession: {
    id: string;
    coachId: string;
    visibilityType: GroupVisibilityType;
    targets: Array<{ athleteId: string | null; squadId: string | null }>;
  },
  coachId: string
) {
  if (groupSession.visibilityType === GroupVisibilityType.ALL) {
    const athletes = await prisma.athleteProfile.findMany({
      where: { coachId },
      select: { userId: true },
    });

    return athletes.map((athlete) => athlete.userId);
  }

  if (groupSession.visibilityType === GroupVisibilityType.SELECTED) {
    const athleteIds = groupSession.targets.map((target) => target.athleteId).filter((value): value is string => Boolean(value));

    if (!athleteIds.length) {
      throw new ApiError(400, 'INVALID_GROUP_SESSION_TARGETS', 'Group session has no selected athletes.');
    }

    const athletes = await prisma.athleteProfile.findMany({
      where: { coachId, userId: { in: athleteIds } },
      select: { userId: true },
    });

    if (athletes.length !== athleteIds.length) {
      throw new ApiError(400, 'INVALID_GROUP_SESSION_TARGETS', 'One or more selected athletes no longer exist.');
    }

    return athletes.map((athlete) => athlete.userId);
  }

  const squadIds = groupSession.targets.map((target) => target.squadId).filter((value): value is string => Boolean(value));

  if (!squadIds.length) {
    throw new ApiError(400, 'INVALID_GROUP_SESSION_TARGETS', 'Group session has no squad targets.');
  }

  const squadMembers = await prisma.squadMember.findMany({
    where: { squadId: { in: squadIds } },
    select: { athleteId: true },
  });

  const athleteIds = Array.from(new Set(squadMembers.map((member) => member.athleteId)));
  if (!athleteIds.length) {
    throw new ApiError(400, 'NO_TARGET_ATHLETES', 'No athletes belong to the targeted squads.');
  }

  return athleteIds;
}
