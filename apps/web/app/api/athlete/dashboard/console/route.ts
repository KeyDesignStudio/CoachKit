import { NextRequest } from 'next/server';
import { CalendarItemStatus, Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { addDaysToDayKey, getLocalDayKey } from '@/lib/day-key';
import { getAthleteRangeSummary } from '@/lib/calendar/range-summary';
import { getEffectiveStartUtcForCalendarItem, getUtcRangeForLocalDayKeyRange, isStoredStartInUtcRange } from '@/lib/calendar-local-day';
import { getStravaCaloriesKcal, getStravaKilojoules } from '@/lib/strava-metrics';
import { createServerProfiler } from '@/lib/server-profiler';
import { getStravaVitalsComparisonForAthlete, type StravaVitalsComparison } from '@/lib/strava-vitals';
import { getGoalCountdown, type GoalCountdown } from '@/lib/goal-countdown';
import { computePercentDelta } from '@/lib/trend-delta';

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
  rangeSummaryComparison: {
    previousFromDayKey: string;
    previousToDayKey: string;
    totals: {
      completedMinutes: number;
      completedDistanceKm: number;
    };
    deltas: {
      completedMinutesPct: number | null;
      completedDistanceKmPct: number | null;
    };
  } | null;
  nextUp: Array<{
    id: string;
    date: string;
    title: string;
    discipline: string;
    plannedStartTimeLocal: string | null;
  }>;
  stravaVitals: StravaVitalsComparison;
  goalCountdown: GoalCountdown | null;
  todayTraining: {
    completedToday: number;
    scheduledToday: number;
    completedTitles: string[];
    scheduledTitles: string[];
  };
  greetingTraining: {
    yesterday: DayTrainingSnapshot;
    today: DayTrainingSnapshot;
    tomorrow: DayTrainingSnapshot;
  };
};

type SessionGreetingInfo = {
  title: string;
  plannedStartTimeLocal: string | null;
};

type DayTrainingSnapshot = {
  completedCount: number;
  plannedCount: number;
  completed: SessionGreetingInfo[];
  planned: SessionGreetingInfo[];
};

const COMPLETED_STATUSES: CalendarItemStatus[] = [
  CalendarItemStatus.COMPLETED_MANUAL,
  CalendarItemStatus.COMPLETED_SYNCED,
  CalendarItemStatus.COMPLETED_SYNCED_DRAFT,
];

const SUMMARY_COMPLETED_STATUS_SQL = Prisma.join([
  Prisma.sql`${CalendarItemStatus.COMPLETED_MANUAL}::"CalendarItemStatus"`,
  Prisma.sql`${CalendarItemStatus.COMPLETED_SYNCED}::"CalendarItemStatus"`,
]);

const ATHLETE_DASHBOARD_CACHE_TTL_MS = 30_000;
const athleteDashboardCache = new Map<
  string,
  {
    value: AthleteDashboardResponse;
    expiresAtMs: number;
  }
>();
const athleteDashboardInFlight = new Map<string, Promise<AthleteDashboardResponse>>();

function readDraftText(draft: unknown, key: string): string | null {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  const value = (draft as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

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

function dayDiffInclusive(fromDayKey: string, toDayKey: string): number {
  const from = parseDateOnly(fromDayKey, 'from').getTime();
  const to = parseDateOnly(toDayKey, 'to').getTime();
  return Math.max(1, Math.floor((to - from) / (24 * 60 * 60 * 1000)) + 1);
}

function shiftDayKey(dayKey: string, days: number): string {
  return addDaysToDayKey(dayKey, days);
}

type AthleteCompletedTotalsRow = {
  completedMinutes: number | null;
  completedDistanceKm: number | null;
};

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function getAthleteCompletedComparisonTotals(params: {
  athleteId: string;
  timezone: string;
  fromUtc: Date;
  toUtcExclusive: Date;
  discipline: string | null;
}) {
  const rows = await prisma.$queryRaw<AthleteCompletedTotalsRow[]>(Prisma.sql`
    WITH latest_completion AS (
      SELECT DISTINCT ON (ca."calendarItemId")
        ca."calendarItemId",
        ca."startTime",
        ca."durationMinutes",
        ca."distanceKm",
        ca."metricsJson",
        ca."matchDayDiff",
        ca."createdAt"
      FROM "CompletedActivity" ca
      WHERE ca."calendarItemId" IS NOT NULL
      ORDER BY ca."calendarItemId", ca."startTime" DESC, ca."createdAt" DESC
    ),
    scoped_items AS (
      SELECT
        COALESCE(
          CASE
            WHEN lc."startTime" IS NULL THEN NULL
            ELSE COALESCE(
              NULLIF(lc."metricsJson"->'strava'->>'startDateUtc', '')::timestamptz,
              lc."startTime"
            ) + COALESCE(lc."matchDayDiff", 0) * INTERVAL '1 day'
          END,
          ((to_char(ci."date" AT TIME ZONE 'UTC', 'YYYY-MM-DD') || ' ' || COALESCE(NULLIF(ci."plannedStartTimeLocal", ''), '00:00'))::timestamp AT TIME ZONE ${params.timezone})
        ) AS "effectiveStartUtc",
        COALESCE(NULLIF(lc."durationMinutes", 0), NULLIF(ci."plannedDurationMinutes", 0), 0) AS "completedMinutes",
        COALESCE(NULLIF(lc."distanceKm", 0), NULLIF(ci."plannedDistanceKm", 0), 0) AS "completedDistanceKm"
      FROM "CalendarItem" ci
      LEFT JOIN latest_completion lc ON lc."calendarItemId" = ci."id"
      WHERE ci."athleteId" = ${params.athleteId}
        AND ci."deletedAt" IS NULL
        ${params.discipline ? Prisma.sql`AND ci."discipline" = ${params.discipline}` : Prisma.empty}
        AND ci."status" IN (${SUMMARY_COMPLETED_STATUS_SQL})
    )
    SELECT
      COALESCE(SUM("completedMinutes"), 0)::int AS "completedMinutes",
      COALESCE(SUM("completedDistanceKm"), 0)::double precision AS "completedDistanceKm"
    FROM scoped_items
    WHERE "effectiveStartUtc" >= ${params.fromUtc}
      AND "effectiveStartUtc" < ${params.toUtcExclusive}
  `);

  return rows[0] ?? { completedMinutes: 0, completedDistanceKm: 0 };
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
    const comparisonWindowDays = dayDiffInclusive(params.fromKey, params.toKey);
    const previousToKey = shiftDayKey(params.fromKey, -1);
    const previousFromKey = shiftDayKey(previousToKey, -(comparisonWindowDays - 1));
    const yesterdayKey = addDaysToDayKey(params.todayKey, -1);
    const tomorrowKey = addDaysToDayKey(params.todayKey, 1);
    const earliestRelevantKey = params.fromKey < yesterdayKey ? params.fromKey : yesterdayKey;
    const latestRelevantKey = params.toKey > tomorrowKey ? params.toKey : tomorrowKey;
    const candidateFromDate = parseDateOnly(addDaysToDayKey(earliestRelevantKey, -1), 'from');
    const candidateToDate = parseDateOnly(addDaysToDayKey(latestRelevantKey, 1), 'to');
    const rangeFilter = { date: { gte: candidateFromDate, lte: candidateToDate } };
    const disciplineFilter = params.discipline ? { discipline: params.discipline } : {};
    const utcRange = getUtcRangeForLocalDayKeyRange({
      fromDayKey: params.fromKey,
      toDayKey: params.toKey,
      timeZone: params.timezone,
    });
    const previousUtcRange = getUtcRangeForLocalDayKeyRange({
      fromDayKey: previousFromKey,
      toDayKey: previousToKey,
      timeZone: params.timezone,
    });

    const [athleteProfile, latestPublishedDraft, latestSubmittedIntake, items, previousComparisonTotals, stravaVitals] = await Promise.all([
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
      prisma.athleteIntakeResponse.findFirst({
        where: {
          athleteId: params.athleteId,
          submittedAt: { not: null },
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          draftJson: true,
          submittedAt: true,
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
              source: true,
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
      getAthleteCompletedComparisonTotals({
        athleteId: params.athleteId,
        timezone: params.timezone,
        fromUtc: previousUtcRange.startUtc,
        toUtcExclusive: previousUtcRange.endUtc,
        discipline: params.discipline,
      }),
      getStravaVitalsComparisonForAthlete(params.athleteId, {
        from: parseDateOnly(params.fromKey, 'from'),
        to: parseDateOnly(params.toKey, 'to'),
        includeLoadModel: params.includeLoadModel,
      }),
    ]);
    const setupJson = ((latestPublishedDraft?.setupJson as any) ?? {}) as Record<string, unknown>;
    const requestContext = (setupJson.requestContext as Record<string, unknown> | null) ?? null;
    const intakeDraftJson = ((latestSubmittedIntake?.draftJson as any) ?? {}) as Record<string, unknown>;
    const fallbackEventDate =
      (typeof setupJson.completionDate === 'string' && setupJson.completionDate.trim()) ||
      (typeof setupJson.eventDate === 'string' && setupJson.eventDate.trim()) ||
      null;
    const fallbackEventNameFromIntake = readDraftText(intakeDraftJson, 'event_name');
    const fallbackEventDateFromIntake = readDraftText(intakeDraftJson, 'event_date') ?? readDraftText(intakeDraftJson, 'completion_date');
    const fallbackStartDate =
      (typeof requestContext?.blockStartDate === 'string' && requestContext.blockStartDate.trim()) ||
      (typeof requestContext?.startDate === 'string' && requestContext.startDate.trim()) ||
      (typeof setupJson.startDate === 'string' && setupJson.startDate.trim()) ||
      (typeof setupJson.blockStartDate === 'string' && setupJson.blockStartDate.trim()) ||
      null;
    const fallbackWeeksToEvent = Number(setupJson.weeksToEvent);

    const goalCountdown = getGoalCountdown({
      eventName: athleteProfile?.eventName ?? fallbackEventNameFromIntake ?? 'Goal event',
      eventDate: athleteProfile?.eventDate ?? fallbackEventDateFromIntake ?? fallbackEventDate,
      blockStartDate: fallbackStartDate,
      timelineWeeks:
        athleteProfile?.timelineWeeks ??
        (Number.isFinite(fallbackWeeksToEvent) && fallbackWeeksToEvent > 0 ? fallbackWeeksToEvent : null),
      todayDayKey: params.todayKey,
    });

    const mappedItems = items.map((item) => {
      const completion = item.completedActivities?.[0] ?? null;
      const stravaMetrics = (completion?.metricsJson as any)?.strava ?? null;
      const effectiveStartUtc = getEffectiveStartUtcForCalendarItem({
        item,
        completion,
        timeZone: params.timezone ?? 'UTC',
      });
      return { item, completion, effectiveStartUtc, stravaMetrics };
    });
    const filteredItems = mappedItems.filter(({ effectiveStartUtc }) => isStoredStartInUtcRange(effectiveStartUtc, utcRange));
    const currentItems = filteredItems.map(({ item }) => item);

    const asGreetingTitle = (item: (typeof items)[number]) => String(item.title ?? item.discipline ?? 'training session').trim();
    const asGreetingSession = (item: (typeof items)[number]): SessionGreetingInfo => ({
      title: asGreetingTitle(item),
      plannedStartTimeLocal: item.plannedStartTimeLocal,
    });
    const itemsByLocalDayKey = new Map<string, Array<(typeof items)[number]>>();
    for (const item of items) {
      const dayKey = getLocalDayKey(item.date, params.timezone);
      const existing = itemsByLocalDayKey.get(dayKey) ?? [];
      existing.push(item);
      itemsByLocalDayKey.set(dayKey, existing);
    }
    const buildDaySnapshot = (dayKey: string): DayTrainingSnapshot => {
      const dayItems = itemsByLocalDayKey.get(dayKey) ?? [];
      const completed = dayItems.filter((item) => COMPLETED_STATUSES.includes(item.status)).map(asGreetingSession);
      const planned = dayItems.filter((item) => item.status === CalendarItemStatus.PLANNED).map(asGreetingSession);
      return {
        completedCount: completed.length,
        plannedCount: planned.length,
        completed: completed.slice(0, 3),
        planned: planned.slice(0, 3),
      };
    };

    const asSummaryItem = ({ item, completion, effectiveStartUtc, stravaMetrics }: (typeof filteredItems)[number]) => ({
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
    });
    const rangeSummary = getAthleteRangeSummary({
      items: filteredItems.map((item) => asSummaryItem(item)),
      timeZone: params.timezone,
      fromDayKey: params.fromKey,
      toDayKey: params.toKey,
      todayDayKey: params.todayKey,
      weightKg: null,
    });

    const pendingConfirmationCount = currentItems.filter((item) => item.status === CalendarItemStatus.COMPLETED_SYNCED_DRAFT).length;

    const painFlagWorkouts = currentItems.filter((item) => item.completedActivities?.[0]?.painFlag).length;

    const nextUp = currentItems
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

    const todayItems = currentItems.filter((item) => getLocalDayKey(item.date, params.timezone) === params.todayKey);
    const completedTodayItems = todayItems.filter((item) => COMPLETED_STATUSES.includes(item.status));
    const scheduledTodayItems = todayItems.filter((item) => item.status === CalendarItemStatus.PLANNED);
    const asTitle = (item: (typeof todayItems)[number]) => String(item.title ?? item.discipline ?? 'session').trim();

    return {
      attention: {
        pendingConfirmation: pendingConfirmationCount,
        workoutsMissed: rangeSummary.totals.workoutsMissed,
        painFlagWorkouts,
      },
      rangeSummary,
      rangeSummaryComparison: {
        previousFromDayKey: previousFromKey,
        previousToDayKey: previousToKey,
        totals: {
          completedMinutes: toFiniteNumber(previousComparisonTotals.completedMinutes),
          completedDistanceKm: toFiniteNumber(previousComparisonTotals.completedDistanceKm),
        },
        deltas: {
          completedMinutesPct: computePercentDelta(
            rangeSummary.totals.completedMinutes,
            toFiniteNumber(previousComparisonTotals.completedMinutes)
          ),
          completedDistanceKmPct: computePercentDelta(
            rangeSummary.totals.completedDistanceKm,
            toFiniteNumber(previousComparisonTotals.completedDistanceKm)
          ),
        },
      },
      nextUp,
      stravaVitals,
      goalCountdown,
      todayTraining: {
        completedToday: completedTodayItems.length,
        scheduledToday: scheduledTodayItems.length,
        completedTitles: completedTodayItems.map(asTitle).slice(0, 3),
        scheduledTitles: scheduledTodayItems.map(asTitle).slice(0, 3),
      },
      greetingTraining: {
        yesterday: buildDaySnapshot(yesterdayKey),
        today: buildDaySnapshot(params.todayKey),
        tomorrow: buildDaySnapshot(tomorrowKey),
      },
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
        headers: privateCacheHeaders({ maxAgeSeconds: 30, staleWhileRevalidateSeconds: 60 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
