import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { addDaysToDayKey, getLocalDayKey } from '@/lib/day-key';
import { getAthleteRangeSummary } from '@/lib/calendar/range-summary';
import { getStoredStartUtcFromCalendarItem, getUtcRangeForLocalDayKeyRange, isStoredStartInUtcRange } from '@/lib/calendar-local-day';
import { getStravaCaloriesKcal, getStravaKilojoules } from '@/lib/strava-metrics';
import { createServerProfiler } from '@/lib/server-profiler';
import { getStravaVitalsComparisonForAthlete, type StravaVitalsComparison } from '@/lib/strava-vitals';
import { getGoalCountdown, type GoalCountdown } from '@/lib/goal-countdown';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' })
    .optional()
    .nullable(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' })
    .optional()
    .nullable(),
  discipline: z.string().optional().nullable(),
  includeLoadModel: z
    .enum(['1', 'true', 'TRUE'])
    .optional()
    .nullable(),
});

type AthleteDashboardResponse = {
  attention: {
    pendingConfirmation: number;
    workoutsMissed: number;
    painFlagWorkouts: number;
  };
  rangeSummary: ReturnType<typeof getAthleteRangeSummary>;
  nextUp: Array<{
    id: string;
    date: string;
    title: string;
    discipline: string;
    plannedStartTimeLocal: string | null;
  }>;
  stravaVitals: StravaVitalsComparison;
  goalCountdown: GoalCountdown | null;
};

const ATHLETE_DASHBOARD_CACHE_TTL_MS = 30_000;
const athleteDashboardCache = new Map<
  string,
  {
    value: AthleteDashboardResponse;
    expiresAtMs: number;
  }
>();
const athleteDashboardInFlight = new Map<string, Promise<AthleteDashboardResponse>>();

function buildAthleteDashboardCacheKey(params: {
  athleteId: string;
  fromKey: string;
  toKey: string;
  discipline: string | null;
  todayKey: string;
  timezone: string;
  includeLoadModel: boolean;
}) {
  return [
    params.athleteId,
    params.fromKey,
    params.toKey,
    params.discipline ?? '',
    params.todayKey,
    params.timezone,
    params.includeLoadModel ? '1' : '0',
  ].join('|');
}

async function getAthleteDashboardData(params: {
  athleteId: string;
  timezone: string;
  todayKey: string;
  fromKey: string;
  toKey: string;
  discipline: string | null;
  includeLoadModel: boolean;
  bypassCache: boolean;
  profiler?: ReturnType<typeof createServerProfiler>;
}) {
  const cacheKey = buildAthleteDashboardCacheKey({
    athleteId: params.athleteId,
    fromKey: params.fromKey,
    toKey: params.toKey,
    discipline: params.discipline,
    todayKey: params.todayKey,
    timezone: params.timezone,
    includeLoadModel: params.includeLoadModel,
  });
  const now = Date.now();

  if (!params.bypassCache) {
    const cached = athleteDashboardCache.get(cacheKey);
    if (cached && cached.expiresAtMs > now) {
      params.profiler?.mark('dashboard:cache-hit');
      return { value: cached.value, cacheHit: true as const };
    }
  }

  const existing = !params.bypassCache ? athleteDashboardInFlight.get(cacheKey) : null;
  if (existing) {
    params.profiler?.mark('dashboard:inflight-hit');
    return { value: await existing, cacheHit: true as const };
  }

  params.profiler?.mark('dashboard:cache-miss');
  const promise = (async () => {
    const candidateFromDate = parseDateOnly(addDaysToDayKey(params.fromKey, -1), 'from');
    const candidateToDate = parseDateOnly(addDaysToDayKey(params.toKey, 1), 'to');
    const rangeFilter = { date: { gte: candidateFromDate, lte: candidateToDate } };
    const disciplineFilter = params.discipline ? { discipline: params.discipline } : {};
    const utcRange = getUtcRangeForLocalDayKeyRange({
      fromDayKey: params.fromKey,
      toDayKey: params.toKey,
      timeZone: params.timezone,
    });

    const [athleteProfile, latestPublishedDraft, items, stravaVitals] = await Promise.all([
      prisma.athleteProfile.findUnique({
        where: { userId: params.athleteId },
        select: {
          eventName: true,
          eventDate: true,
          timelineWeeks: true,
        },
      }),
      prisma.aiPlanDraft.findFirst({
        where: {
          athleteId: params.athleteId,
          visibilityStatus: 'PUBLISHED',
        },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          setupJson: true,
          publishedAt: true,
        },
      }),
      prisma.calendarItem.findMany({
        where: {
          athleteId: params.athleteId,
          deletedAt: null,
          ...rangeFilter,
          ...disciplineFilter,
        },
        select: {
          id: true,
          date: true,
          discipline: true,
          status: true,
          title: true,
          plannedDurationMinutes: true,
          plannedDistanceKm: true,
          plannedStartTimeLocal: true,
          completedActivities: {
            orderBy: [{ startTime: 'desc' as const }],
            take: 1,
            select: {
              startTime: true,
              durationMinutes: true,
              distanceKm: true,
              confirmedAt: true,
              painFlag: true,
              metricsJson: true,
              matchDayDiff: true,
            },
          },
        },
        orderBy: [{ date: 'asc' as const }],
      }),
      getStravaVitalsComparisonForAthlete(params.athleteId, {
        from: parseDateOnly(params.fromKey, 'from'),
        to: parseDateOnly(params.toKey, 'to'),
        includeLoadModel: params.includeLoadModel,
      }),
    ]);
    const setupJson = ((latestPublishedDraft?.setupJson as any) ?? {}) as Record<string, unknown>;
    const requestContext = (setupJson.requestContext as Record<string, unknown> | null) ?? null;
    const fallbackEventName =
      (typeof requestContext?.eventName === 'string' && requestContext.eventName.trim()) ||
      (typeof setupJson.eventName === 'string' && setupJson.eventName.trim()) ||
      null;
    const fallbackEventDate =
      (typeof setupJson.completionDate === 'string' && setupJson.completionDate.trim()) ||
      (typeof setupJson.eventDate === 'string' && setupJson.eventDate.trim()) ||
      null;
    const fallbackWeeksToEvent = Number(setupJson.weeksToEvent);
    const profileEventName = typeof athleteProfile?.eventName === 'string' ? athleteProfile.eventName.trim() : '';

    const goalCountdown = athleteProfile
      ? getGoalCountdown({
          eventName: profileEventName || fallbackEventName || 'Goal event',
          eventDate: athleteProfile.eventDate ?? fallbackEventDate,
          timelineWeeks:
            athleteProfile.timelineWeeks ??
            (Number.isFinite(fallbackWeeksToEvent) && fallbackWeeksToEvent > 0 ? fallbackWeeksToEvent : null),
          todayDayKey: params.todayKey,
        })
      : null;

    const filteredItems = items
      .map((item) => {
        const completion = item.completedActivities?.[0] ?? null;
        const stravaMetrics = (completion?.metricsJson as any)?.strava ?? null;
        const completionStartUtc = completion
          ? (() => {
              const raw = stravaMetrics?.startDateUtc ?? null;
              const parsed = raw ? new Date(raw) : null;
              const base = parsed && !Number.isNaN(parsed.getTime()) ? parsed : completion.startTime;
              if (typeof completion.matchDayDiff === 'number' && completion.matchDayDiff !== 0) {
                return new Date(base.getTime() + completion.matchDayDiff * 24 * 60 * 60 * 1000);
              }
              return base;
            })()
          : null;
        const effectiveStartUtc = completionStartUtc ?? getStoredStartUtcFromCalendarItem(item, params.timezone ?? 'UTC');
        return { item, completion, effectiveStartUtc, stravaMetrics };
      })
      .filter(({ effectiveStartUtc }) => isStoredStartInUtcRange(effectiveStartUtc, utcRange));

    const rangeSummary = getAthleteRangeSummary({
      items: filteredItems.map(({ item, completion, effectiveStartUtc, stravaMetrics }) => ({
        id: item.id,
        date: effectiveStartUtc.toISOString(),
        discipline: item.discipline,
        status: item.status,
        title: item.title,
        plannedDurationMinutes: item.plannedDurationMinutes,
        plannedDistanceKm: item.plannedDistanceKm,
        latestCompletedActivity: completion
          ? {
              durationMinutes: completion.durationMinutes,
              distanceKm: completion.distanceKm,
              caloriesKcal: getStravaCaloriesKcal(stravaMetrics),
              kilojoules: getStravaKilojoules(stravaMetrics),
              confirmedAt: completion.confirmedAt ? completion.confirmedAt.toISOString() : null,
            }
          : null,
      })),
      timeZone: params.timezone,
      fromDayKey: params.fromKey,
      toDayKey: params.toKey,
      todayDayKey: params.todayKey,
      weightKg: null,
    });

    const pendingConfirmationCount = filteredItems
      .map(({ item }) => item)
      .filter((item) => item.status === CalendarItemStatus.COMPLETED_SYNCED_DRAFT).length;

    const painFlagWorkouts = filteredItems.map(({ item }) => item).filter((item) => item.completedActivities?.[0]?.painFlag).length;

    const nextUp = filteredItems
      .map(({ item }) => item)
      .filter((item) => item.status === CalendarItemStatus.PLANNED)
      .filter((item) => getLocalDayKey(item.date, params.timezone) >= params.todayKey)
      .sort((a, b) => {
        const dayA = a.date.getTime();
        const dayB = b.date.getTime();
        if (dayA !== dayB) return dayA - dayB;
        const timeA = a.plannedStartTimeLocal ?? '99:99';
        const timeB = b.plannedStartTimeLocal ?? '99:99';
        return timeA.localeCompare(timeB);
      })
      .slice(0, 3)
      .map((item) => ({
        id: item.id,
        date: item.date.toISOString().slice(0, 10),
        title: item.title,
        discipline: item.discipline,
        plannedStartTimeLocal: item.plannedStartTimeLocal,
      }));

    return {
      attention: {
        pendingConfirmation: pendingConfirmationCount,
        workoutsMissed: rangeSummary.totals.workoutsMissed,
        painFlagWorkouts,
      },
      rangeSummary,
      nextUp,
      stravaVitals,
      goalCountdown,
    } satisfies AthleteDashboardResponse;
  })();

  if (!params.bypassCache) {
    athleteDashboardInFlight.set(cacheKey, promise);
  }

  try {
    const value = await promise;
    if (!params.bypassCache) {
      athleteDashboardCache.set(cacheKey, {
        value,
        expiresAtMs: now + ATHLETE_DASHBOARD_CACHE_TTL_MS,
      });
    }
    params.profiler?.mark('dashboard:computed');
    return { value, cacheHit: false as const };
  } finally {
    if (!params.bypassCache) {
      athleteDashboardInFlight.delete(cacheKey);
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const prof = createServerProfiler('athlete/dashboard/console');
    prof.mark('start');
    const { user } = await requireAthlete();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      discipline: searchParams.get('discipline'),
      includeLoadModel: searchParams.get('includeLoadModel'),
    });

    const todayKey = getZonedDateKeyForNow(user.timezone);
    const fromKey = (params.from ?? '').trim() || todayKey;
    const toKey = (params.to ?? '').trim() || todayKey;

    const fromDate = parseDateOnly(fromKey, 'from');
    const toDate = parseDateOnly(toKey, 'to');
    assertValidDateRange(fromDate, toDate);

    const discipline = (params.discipline ?? '').trim().toUpperCase() || null;
    const includeLoadModel = Boolean(params.includeLoadModel);
    const bypassCache = searchParams.has('t');
    const dashboard = await getAthleteDashboardData({
      athleteId: user.id,
      timezone: user.timezone,
      todayKey,
      fromKey,
      toKey,
      discipline,
      includeLoadModel,
      bypassCache,
      profiler: prof,
    });

    prof.mark('format');
    prof.done({
      cacheHit: dashboard.cacheHit,
      cachesBypassed: bypassCache,
      nextUpCount: dashboard.value.nextUp.length,
    });

    return success(
      dashboard.value,
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
