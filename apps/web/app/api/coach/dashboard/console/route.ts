import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { createServerProfiler } from '@/lib/server-profiler';
import { getStravaVitalsComparisonForAthletes, type StravaVitalsComparison } from '@/lib/strava-vitals';
import { getTodayDayKey } from '@/lib/day-key';
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
  athleteId: z.string().optional().nullable(),
  athleteIds: z.string().optional().nullable(),
  discipline: z.string().optional().nullable(),
  inboxOffset: z.string().optional().nullable(),
  inboxLimit: z.string().optional().nullable(),
  includeLoadModel: z
    .enum(['1', 'true', 'TRUE'])
    .optional()
    .nullable(),
});

const COMPLETED_STATUSES: CalendarItemStatus[] = [
  CalendarItemStatus.COMPLETED_MANUAL,
  CalendarItemStatus.COMPLETED_SYNCED,
  CalendarItemStatus.COMPLETED_SYNCED_DRAFT,
];

const REVIEWABLE_STATUSES: CalendarItemStatus[] = [...COMPLETED_STATUSES, CalendarItemStatus.SKIPPED];

function minutesOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function distanceOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

type ReviewItem = {
  id: string;
  title: string;
  date: string;
  actionAt: string;
  discipline: string;
  plannedStartTimeLocal: string | null;
  plannedDurationMinutes: number | null;
  plannedDistanceKm: number | null;
  workoutDetail: string | null;
  status: string;
  latestCompletedActivity: {
    id: string;
    durationMinutes: number | null;
    distanceKm: number | null;
    painFlag: boolean;
    startTime: string;
  } | null;
  athlete: {
    id: string;
    name: string | null;
  } | null;
  hasAthleteComment: boolean;
  commentCount: number;
};

function getInboxPriority(item: ReviewItem): number {
  const painFlag = item.latestCompletedActivity?.painFlag ?? false;
  const hasComment = item.hasAthleteComment;
  const isSkipped = item.status === 'SKIPPED';

  if (painFlag && hasComment) return 1;
  if (painFlag) return 2;
  if (hasComment) return 3;
  if (isSkipped) return 4;
  return 5;
}

type DashboardAggregates = {
  athletes: Array<{ id: string; name: string | null; disciplines: string[] }>;
  kpis: {
    workoutsCompleted: number;
    workoutsSkipped: number;
    totalTrainingMinutes: number;
    totalDistanceKm: number;
  };
  attention: {
    painFlagWorkouts: number;
    athleteCommentWorkouts: number;
    skippedWorkouts: number;
    awaitingCoachReview: number;
  };
  disciplineLoad: Array<{ discipline: string; totalMinutes: number; totalDistanceKm: number }>;
  stravaVitals: StravaVitalsComparison;
  goalCountdowns: Array<{
    athleteId: string;
    athleteName: string | null;
    goalCountdown: GoalCountdown;
  }>;
  selectedGoalCountdown: {
    athleteId: string;
    athleteName: string | null;
    goalCountdown: GoalCountdown;
  } | null;
  meta: {
    completedItemCount: number;
  };
};

type DashboardReviewInboxPage = {
  items: ReviewItem[];
  hasMore: boolean;
};

const DASHBOARD_AGG_CACHE_TTL_MS = 30_000;
const dashboardAggregateCache = new Map<
  string,
  {
    value: DashboardAggregates;
    expiresAtMs: number;
  }
>();
const dashboardAggregateInFlight = new Map<string, Promise<DashboardAggregates>>();
const DASHBOARD_INBOX_CACHE_TTL_MS = 15_000;
const dashboardInboxCache = new Map<
  string,
  {
    value: DashboardReviewInboxPage;
    expiresAtMs: number;
  }
>();
const dashboardInboxInFlight = new Map<string, Promise<DashboardReviewInboxPage>>();

function buildDashboardAggregateCacheKey(params: {
  coachId: string;
  from: string | null;
  to: string | null;
  athleteScopeKey: string;
  discipline: string | null;
  includeLoadModel: boolean;
}) {
  return [
    params.coachId,
    params.from ?? '',
    params.to ?? '',
    params.athleteScopeKey,
    params.discipline ?? '',
    params.includeLoadModel ? '1' : '0',
  ].join('|');
}

function buildDashboardInboxCacheKey(params: {
  coachId: string;
  from: string | null;
  to: string | null;
  athleteScopeKey: string;
  discipline: string | null;
  inboxOffset: number;
  inboxLimit: number;
}) {
  return [
    params.coachId,
    params.from ?? '',
    params.to ?? '',
    params.athleteScopeKey,
    params.discipline ?? '',
    String(params.inboxOffset),
    String(params.inboxLimit),
  ].join('|');
}

async function getDashboardAggregates(params: {
  coachId: string;
  rangeFilter: Record<string, unknown>;
  athleteFilter: Record<string, unknown>;
  selectedAthleteIds: string[];
  fromDate: Date | null;
  toDate: Date | null;
  disciplineFilter: Record<string, unknown>;
  includeLoadModel: boolean;
  cacheKey: string;
  bypassCache: boolean;
  profiler?: ReturnType<typeof createServerProfiler>;
}) {
  const now = Date.now();
  if (!params.bypassCache) {
    const cached = dashboardAggregateCache.get(params.cacheKey);
    if (cached && cached.expiresAtMs > now) {
      params.profiler?.mark('aggregate:cache-hit');
      return { value: cached.value, cacheHit: true as const };
    }
  }

  const existing = !params.bypassCache ? dashboardAggregateInFlight.get(params.cacheKey) : null;
  if (existing) {
    params.profiler?.mark('aggregate:inflight-hit');
    return { value: await existing, cacheHit: true as const };
  }

  params.profiler?.mark('aggregate:cache-miss');
  const promise = (async () => {
    const athletes = await prisma.athleteProfile.findMany({
      where: { coachId: params.coachId },
      select: {
        userId: true,
        disciplines: true,
        eventName: true,
        eventDate: true,
        timelineWeeks: true,
        user: { select: { id: true, name: true, timezone: true } },
      },
      orderBy: [{ user: { name: 'asc' } }],
    });
    const athleteIds = athletes.map((a) => a.userId);
    const latestPublishedDrafts = athleteIds.length
      ? await prisma.aiPlanDraft.findMany({
          where: {
            athleteId: { in: athleteIds },
            visibilityStatus: 'PUBLISHED',
          },
          select: {
            athleteId: true,
            setupJson: true,
            publishedAt: true,
            createdAt: true,
          },
          orderBy: [{ athleteId: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        })
      : [];
    const latestPublishedSetupByAthlete = new Map<string, Record<string, unknown>>();
    for (const row of latestPublishedDrafts) {
      if (!latestPublishedSetupByAthlete.has(row.athleteId)) {
        latestPublishedSetupByAthlete.set(row.athleteId, ((row.setupJson as any) ?? {}) as Record<string, unknown>);
      }
    }

    const athleteRows = athletes.map((a) => ({
      id: a.userId,
      name: a.user.name,
      disciplines: a.disciplines,
    }));

    const targetAthleteIdsForVitals = params.selectedAthleteIds.length > 0 ? params.selectedAthleteIds : athleteRows.map((row) => row.id);
    const targetAthleteIdsForGoals = new Set(targetAthleteIdsForVitals);
    const goalCountdowns = athletes
      .filter((athlete) => targetAthleteIdsForGoals.has(athlete.userId))
      .map((athlete) => {
        const setupJson = latestPublishedSetupByAthlete.get(athlete.userId) ?? {};
        const requestContext = (setupJson.requestContext as Record<string, unknown> | null) ?? null;
        const fallbackEventName =
          (typeof requestContext?.eventName === 'string' && requestContext.eventName.trim()) ||
          (typeof setupJson.eventName === 'string' && setupJson.eventName.trim()) ||
          null;
        const fallbackEventDate =
          (typeof setupJson.completionDate === 'string' && setupJson.completionDate.trim()) ||
          (typeof setupJson.eventDate === 'string' && setupJson.eventDate.trim()) ||
          null;
        const fallbackStartDate =
          (typeof setupJson.startDate === 'string' && setupJson.startDate.trim()) ||
          (typeof setupJson.blockStartDate === 'string' && setupJson.blockStartDate.trim()) ||
          null;
        const fallbackWeeksToEvent = Number(setupJson.weeksToEvent);
        const profileEventName = typeof athlete.eventName === 'string' ? athlete.eventName.trim() : '';

        return {
          athleteId: athlete.userId,
          athleteName: athlete.user.name,
          goalCountdown: getGoalCountdown({
            eventName: profileEventName || fallbackEventName || 'Goal event',
            eventDate: athlete.eventDate ?? fallbackEventDate,
            blockStartDate: fallbackStartDate,
            timelineWeeks:
              athlete.timelineWeeks ??
              (Number.isFinite(fallbackWeeksToEvent) && fallbackWeeksToEvent > 0 ? fallbackWeeksToEvent : null),
            todayDayKey: getTodayDayKey(athlete.user.timezone ?? 'UTC'),
          }),
        };
      })
      .sort((a, b) => {
        const ad = a.goalCountdown.daysRemaining;
        const bd = b.goalCountdown.daysRemaining;
        if (ad == null && bd == null) return (a.athleteName ?? '').localeCompare(b.athleteName ?? '');
        if (ad == null) return 1;
        if (bd == null) return -1;
        return ad - bd;
      });
    const selectedGoalCountdown = goalCountdowns.length === 1 ? goalCountdowns[0] : null;

    const [completedCount, skippedCount, completedItems, painFlagCount, athleteCommentWorkoutCount, awaitingReviewCount, stravaVitals] =
      await Promise.all([
        prisma.calendarItem.count({
          where: {
            coachId: params.coachId,
            deletedAt: null,
            ...params.rangeFilter,
            ...params.athleteFilter,
            ...params.disciplineFilter,
            status: { in: COMPLETED_STATUSES },
          },
        }),
        prisma.calendarItem.count({
          where: {
            coachId: params.coachId,
            deletedAt: null,
            ...params.rangeFilter,
            ...params.athleteFilter,
            ...params.disciplineFilter,
            status: CalendarItemStatus.SKIPPED,
          },
        }),
        prisma.calendarItem.findMany({
          where: {
            coachId: params.coachId,
            deletedAt: null,
            ...params.rangeFilter,
            ...params.athleteFilter,
            ...params.disciplineFilter,
            status: { in: COMPLETED_STATUSES },
          },
          select: {
            discipline: true,
            completedActivities: {
              orderBy: [{ startTime: 'desc' as const }],
              take: 1,
              select: { durationMinutes: true, distanceKm: true },
            },
          },
        }),
        prisma.calendarItem.count({
          where: {
            coachId: params.coachId,
            deletedAt: null,
            ...params.rangeFilter,
            ...params.athleteFilter,
            ...params.disciplineFilter,
            completedActivities: { some: { painFlag: true } },
          },
        }),
        prisma.calendarItem.count({
          where: {
            coachId: params.coachId,
            deletedAt: null,
            ...params.rangeFilter,
            ...params.athleteFilter,
            ...params.disciplineFilter,
            comments: { some: { author: { role: 'ATHLETE' } } },
          },
        }),
        prisma.calendarItem.count({
          where: {
            coachId: params.coachId,
            deletedAt: null,
            ...params.rangeFilter,
            ...params.athleteFilter,
            ...params.disciplineFilter,
            status: { in: REVIEWABLE_STATUSES },
            reviewedAt: null,
          },
        }),
        getStravaVitalsComparisonForAthletes(targetAthleteIdsForVitals, {
          windowDays: params.fromDate && params.toDate ? undefined : 90,
          from: params.fromDate ?? undefined,
          to: params.toDate ?? undefined,
          includeLoadModel: params.includeLoadModel,
        }),
      ]);

    let totalMinutes = 0;
    let totalDistanceKm = 0;
    const disciplineTotals = new Map<string, { totalMinutes: number; totalDistanceKm: number }>();

    completedItems.forEach((item) => {
      const latest = item.completedActivities?.[0];
      const m = minutesOrZero(latest?.durationMinutes);
      const d = distanceOrZero(latest?.distanceKm);

      totalMinutes += m;
      totalDistanceKm += d;

      const key = (item.discipline || 'OTHER').toUpperCase();
      const prev = disciplineTotals.get(key) ?? { totalMinutes: 0, totalDistanceKm: 0 };
      prev.totalMinutes += m;
      prev.totalDistanceKm += d;
      disciplineTotals.set(key, prev);
    });

    const disciplines = ['BIKE', 'RUN', 'SWIM', 'OTHER'] as const;
    const disciplineLoad = disciplines.map((disc) => {
      const v = disciplineTotals.get(disc) ?? { totalMinutes: 0, totalDistanceKm: 0 };
      return { discipline: disc, totalMinutes: v.totalMinutes, totalDistanceKm: v.totalDistanceKm };
    });

    return {
      athletes: athleteRows,
      kpis: {
        workoutsCompleted: completedCount,
        workoutsSkipped: skippedCount,
        totalTrainingMinutes: totalMinutes,
        totalDistanceKm,
      },
      attention: {
        painFlagWorkouts: painFlagCount,
        athleteCommentWorkouts: athleteCommentWorkoutCount,
        skippedWorkouts: skippedCount,
        awaitingCoachReview: awaitingReviewCount,
      },
      disciplineLoad,
      stravaVitals,
      goalCountdowns,
      selectedGoalCountdown,
      meta: {
        completedItemCount: completedItems.length,
      },
    } satisfies DashboardAggregates;
  })();

  if (!params.bypassCache) {
    dashboardAggregateInFlight.set(params.cacheKey, promise);
  }

  try {
    const value = await promise;
    if (!params.bypassCache) {
      dashboardAggregateCache.set(params.cacheKey, {
        value,
        expiresAtMs: now + DASHBOARD_AGG_CACHE_TTL_MS,
      });
    }
    params.profiler?.mark('aggregate:computed');
    return { value, cacheHit: false as const };
  } finally {
    if (!params.bypassCache) {
      dashboardAggregateInFlight.delete(params.cacheKey);
    }
  }
}

async function getDashboardReviewInbox(params: {
  coachId: string;
  rangeFilter: Record<string, unknown>;
  athleteFilter: Record<string, unknown>;
  disciplineFilter: Record<string, unknown>;
  inboxOffset: number;
  inboxLimit: number;
  cacheKey: string;
  bypassCache: boolean;
  profiler?: ReturnType<typeof createServerProfiler>;
}) {
  const now = Date.now();
  if (!params.bypassCache) {
    const cached = dashboardInboxCache.get(params.cacheKey);
    if (cached && cached.expiresAtMs > now) {
      params.profiler?.mark('inbox:cache-hit');
      return { value: cached.value, cacheHit: true as const };
    }
  }

  const existing = !params.bypassCache ? dashboardInboxInFlight.get(params.cacheKey) : null;
  if (existing) {
    params.profiler?.mark('inbox:inflight-hit');
    return { value: await existing, cacheHit: true as const };
  }

  params.profiler?.mark('inbox:cache-miss');
  const promise = (async () => {
    const inboxItems = await prisma.calendarItem.findMany({
      where: {
        coachId: params.coachId,
        deletedAt: null,
        ...params.rangeFilter,
        ...params.athleteFilter,
        ...params.disciplineFilter,
        status: { in: REVIEWABLE_STATUSES },
        reviewedAt: null,
      },
      skip: params.inboxOffset,
      take: params.inboxLimit + 1,
      orderBy: [{ actionAt: 'desc' }, { updatedAt: 'desc' }, { date: 'desc' }],
      select: {
        id: true,
        date: true,
        actionAt: true,
        plannedStartTimeLocal: true,
        discipline: true,
        title: true,
        plannedDurationMinutes: true,
        plannedDistanceKm: true,
        workoutDetail: true,
        status: true,
        updatedAt: true,
        athlete: {
          select: {
            user: { select: { id: true, name: true } },
          },
        },
        completedActivities: {
          orderBy: [{ startTime: 'desc' as const }],
          take: 1,
          select: {
            id: true,
            durationMinutes: true,
            distanceKm: true,
            painFlag: true,
            startTime: true,
          },
        },
        comments: {
          where: {
            author: {
              role: 'ATHLETE',
            },
          },
          take: 1,
          select: {
            id: true,
          },
        },
      },
    });

    const hasMoreInboxItems = inboxItems.length > params.inboxLimit;
    const pageItems = hasMoreInboxItems ? inboxItems.slice(0, params.inboxLimit) : inboxItems;

    const formattedInbox: ReviewItem[] = pageItems.map((item: any) => {
      const hasAthleteComment = (item.comments?.length ?? 0) > 0;
      const latestCompletedActivity = item.completedActivities?.[0] ?? null;
      const persisted = item.actionAt ? new Date(item.actionAt) : null;
      const fallback = latestCompletedActivity?.startTime ? new Date(latestCompletedActivity.startTime) : new Date(item.updatedAt);
      const actionAt = persisted && !Number.isNaN(persisted.getTime()) ? persisted : fallback;

      return {
        id: item.id,
        date: item.date,
        actionAt: actionAt.toISOString(),
        plannedStartTimeLocal: item.plannedStartTimeLocal,
        discipline: item.discipline,
        title: item.title,
        plannedDurationMinutes: item.plannedDurationMinutes,
        plannedDistanceKm: item.plannedDistanceKm,
        workoutDetail: item.workoutDetail,
        status: item.status,
        athlete: item.athlete?.user ?? null,
        latestCompletedActivity,
        hasAthleteComment,
        commentCount: item.comments?.length ?? 0,
      };
    });

    formattedInbox.sort((a, b) => {
      const ap = getInboxPriority(a);
      const bp = getInboxPriority(b);
      if (ap !== bp) return ap - bp;
      return new Date(b.actionAt).getTime() - new Date(a.actionAt).getTime();
    });

    return {
      items: formattedInbox,
      hasMore: hasMoreInboxItems,
    } satisfies DashboardReviewInboxPage;
  })();

  if (!params.bypassCache) {
    dashboardInboxInFlight.set(params.cacheKey, promise);
  }

  try {
    const value = await promise;
    if (!params.bypassCache) {
      dashboardInboxCache.set(params.cacheKey, {
        value,
        expiresAtMs: now + DASHBOARD_INBOX_CACHE_TTL_MS,
      });
    }
    params.profiler?.mark('inbox:computed');
    return { value, cacheHit: false as const };
  } finally {
    if (!params.bypassCache) {
      dashboardInboxInFlight.delete(params.cacheKey);
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const prof = createServerProfiler('coach/dashboard/console');
    prof.mark('start');
    const { user } = await requireCoach();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      athleteId: searchParams.get('athleteId'),
      athleteIds: searchParams.get('athleteIds'),
      discipline: searchParams.get('discipline'),
      inboxOffset: searchParams.get('inboxOffset'),
      inboxLimit: searchParams.get('inboxLimit'),
      includeLoadModel: searchParams.get('includeLoadModel'),
    });

    const fromDate = params.from ? parseDateOnly(params.from, 'from') : null;
    const toDate = params.to ? parseDateOnly(params.to, 'to') : null;
    if (fromDate && toDate) {
      assertValidDateRange(fromDate, toDate);
    }

    const parsedAthleteIds = new Set<string>();
    const singleAthleteId = (params.athleteId ?? '').trim();
    if (singleAthleteId) parsedAthleteIds.add(singleAthleteId);
    const multiAthleteIds = (params.athleteIds ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    multiAthleteIds.forEach((id) => parsedAthleteIds.add(id));
    const selectedAthleteIds = Array.from(parsedAthleteIds);
    const athleteScopeKey = selectedAthleteIds.slice().sort().join(',') || 'all';
    const discipline = (params.discipline ?? '').trim().toUpperCase() || null;
    const includeLoadModel = Boolean(params.includeLoadModel);
    const parsedInboxOffset = Number(params.inboxOffset ?? '0');
    const parsedInboxLimit = Number(params.inboxLimit ?? '25');
    const inboxOffset = Number.isFinite(parsedInboxOffset) && parsedInboxOffset >= 0 ? Math.floor(parsedInboxOffset) : 0;
    const inboxLimit = Number.isFinite(parsedInboxLimit)
      ? Math.min(100, Math.max(1, Math.floor(parsedInboxLimit)))
      : 25;

    const rangeFilter = fromDate && toDate ? { date: { gte: fromDate, lte: toDate } } : {};
    const athleteFilter =
      selectedAthleteIds.length > 0 ? { athleteId: { in: selectedAthleteIds } } : {};
    const disciplineFilter = discipline ? { discipline } : {};
    const bypassCaches = searchParams.has('t');
    const aggregateCacheKey = buildDashboardAggregateCacheKey({
      coachId: user.id,
      from: params.from ?? null,
      to: params.to ?? null,
      athleteScopeKey,
      discipline,
      includeLoadModel,
    });
    const inboxCacheKey = buildDashboardInboxCacheKey({
      coachId: user.id,
      from: params.from ?? null,
      to: params.to ?? null,
      athleteScopeKey,
      discipline,
      inboxOffset,
      inboxLimit,
    });
    prof.mark('auth+parse');

    const aggregates = await getDashboardAggregates({
      coachId: user.id,
      rangeFilter,
      athleteFilter,
      selectedAthleteIds,
      fromDate,
      toDate,
      disciplineFilter,
      includeLoadModel,
      cacheKey: aggregateCacheKey,
      bypassCache: bypassCaches,
      profiler: prof,
    });
    prof.mark('kpis');

    const inboxPage = await getDashboardReviewInbox({
      coachId: user.id,
      rangeFilter,
      athleteFilter,
      disciplineFilter,
      inboxOffset,
      inboxLimit,
      cacheKey: inboxCacheKey,
      bypassCache: bypassCaches,
      profiler: prof,
    });

    prof.mark('format');
    prof.done({
      athleteCount: aggregates.value.athletes.length,
      completedItemCount: aggregates.value.meta.completedItemCount,
      inboxItemCount: inboxPage.value.items.length,
      inboxHasMore: inboxPage.value.hasMore,
      aggregateCacheHit: aggregates.cacheHit,
      inboxCacheHit: inboxPage.cacheHit,
      cachesBypassed: bypassCaches,
    });

    return success(
      {
        athletes: aggregates.value.athletes,
        kpis: aggregates.value.kpis,
        attention: aggregates.value.attention,
        disciplineLoad: aggregates.value.disciplineLoad,
        stravaVitals: aggregates.value.stravaVitals,
        goalCountdowns: aggregates.value.goalCountdowns,
        selectedGoalCountdown: aggregates.value.selectedGoalCountdown,
        reviewInbox: inboxPage.value.items,
        reviewInboxPage: {
          offset: inboxOffset,
          limit: inboxLimit,
          hasMore: inboxPage.value.hasMore,
        },
      },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
