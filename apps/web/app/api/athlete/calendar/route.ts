import { NextRequest } from 'next/server';
import { CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { isStravaTimeDebugEnabled } from '@/lib/debug';
import { createServerProfiler } from '@/lib/server-profiler';
import { getWeatherSummariesForRange } from '@/lib/weather-server';
import { addDaysToDayKey, getLocalDayKey, getTodayDayKey } from '@/lib/day-key';
import { getStravaCaloriesKcal } from '@/lib/strava-metrics';
import {
  getEffectiveStartUtcForCalendarItem,
  getEffectiveStartUtcFromCompletion,
  getUtcRangeForLocalDayKeyRange,
  isStoredStartInUtcRange,
} from '@/lib/calendar-local-day';
import { getGoalCountdown, type GoalCountdown } from '@/lib/goal-countdown';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' }),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' }),
});

const LEAN_CALENDAR_ITEMS = new Set(['1', 'true', 'yes']);
const ATHLETE_CALENDAR_CACHE_TTL_MS = 30_000;

type AthleteCalendarResponse = {
  items: any[];
  dayWeather?: Record<string, any>;
  goalCountdown?: GoalCountdown | null;
};

const athleteCalendarCache = new Map<
  string,
  {
    value: AthleteCalendarResponse;
    expiresAtMs: number;
  }
>();
const athleteCalendarInFlight = new Map<string, Promise<AthleteCalendarResponse>>();

const completedActivitiesSelect = {
  completedActivities: {
    orderBy: [{ startTime: 'desc' as const }],
    take: 5,
    where: {
      source: { in: [CompletionSource.MANUAL, CompletionSource.STRAVA] },
    },
    select: {
      id: true,
      painFlag: true,
      startTime: true,
      confirmedAt: true,
      source: true,
      durationMinutes: true,
      distanceKm: true,
      metricsJson: true,
      matchDayDiff: true,
    },
  },
};

const calendarItemLeanSelect = {
  id: true,
  athleteId: true,
  coachId: true,
  date: true,
  plannedStartTimeLocal: true,
  origin: true,
  planningStatus: true,
  sourceActivityId: true,
  discipline: true,
  subtype: true,
  title: true,
  status: true,
  plannedDurationMinutes: true,
  plannedDistanceKm: true,
  notes: true,
  workoutDetail: true,
  ...completedActivitiesSelect,
};

const calendarItemFullSelect = {
  ...calendarItemLeanSelect,
  athletePlanInstanceId: true,
  coachEdited: true,
  distanceMeters: true,
  intensityTarget: true,
  tags: true,
  equipment: true,
  workoutStructure: true,
  intensityType: true,
  intensityTargetJson: true,
  attachmentsJson: true,
  templateId: true,
  groupSessionId: true,
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
};

function buildAthleteCalendarCacheKey(params: {
  athleteId: string;
  from: string;
  to: string;
  lean: boolean;
  timezone: string;
  includeDebug: boolean;
}) {
  return [
    params.athleteId,
    params.from,
    params.to,
    params.lean ? 'lean' : 'full',
    params.timezone,
    params.includeDebug ? 'debug' : 'nodebug',
  ].join('|');
}

export async function GET(request: NextRequest) {
  try {
    const prof = createServerProfiler('athlete/calendar');
    prof.mark('start');
    const { user } = await requireAthlete();
    const includeDebug = isStravaTimeDebugEnabled();
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });
    const lean = LEAN_CALENDAR_ITEMS.has(String(searchParams.get('lean') ?? '').toLowerCase());
    const bypassCache = searchParams.has('t');

    const fromDate = parseDateOnly(params.from, 'from');
    const toDate = parseDateOnly(params.to, 'to');
    assertValidDateRange(fromDate, toDate);

    const athleteTimezone = user.timezone ?? 'Australia/Brisbane';
    const cacheKey = buildAthleteCalendarCacheKey({
      athleteId: user.id,
      from: params.from,
      to: params.to,
      lean,
      timezone: athleteTimezone,
      includeDebug,
    });
    const now = Date.now();

    if (!bypassCache) {
      const cached = athleteCalendarCache.get(cacheKey);
      if (cached && cached.expiresAtMs > now) {
        prof.mark('cache-hit');
        prof.done({ cacheHit: true, cachesBypassed: false, itemCount: cached.value.items.length });
        return success(cached.value, {
          headers: privateCacheHeaders({ maxAgeSeconds: 0 }),
        });
      }
    }

    const existing = !bypassCache ? athleteCalendarInFlight.get(cacheKey) : null;
    if (existing) {
      prof.mark('cache-inflight-hit');
      const value = await existing;
      prof.done({ cacheHit: true, cachesBypassed: false, inFlightHit: true, itemCount: value.items.length });
      return success(value, {
        headers: privateCacheHeaders({ maxAgeSeconds: 0 }),
      });
    }
    prof.mark('cache-miss');

    const computePromise = (async (): Promise<AthleteCalendarResponse> => {
      const utcRange = getUtcRangeForLocalDayKeyRange({
        fromDayKey: params.from,
        toDayKey: params.to,
        timeZone: athleteTimezone,
      });

      // Candidate fetch window: widen by a day on either side to account for timezone offsets
      // and date-only storage quirks.
      const candidateFromDate = parseDateOnly(addDaysToDayKey(params.from, -1), 'from');
      const candidateToDate = parseDateOnly(addDaysToDayKey(params.to, 1), 'to');

      const [athleteProfile, latestPublishedDraft, items] = await Promise.all([
        prisma.athleteProfile.findUnique({
          where: { userId: user.id },
          select: { coachId: true, defaultLat: true, defaultLon: true, eventName: true, eventDate: true, timelineWeeks: true },
        }),
        prisma.aiPlanDraft.findFirst({
          where: {
            athleteId: user.id,
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
            athleteId: user.id,
            deletedAt: null,
            date: {
              gte: candidateFromDate,
              lte: candidateToDate,
            },
          },
          orderBy: [{ date: 'asc' }, { plannedStartTimeLocal: 'asc' }],
          select: lean ? calendarItemLeanSelect : calendarItemFullSelect,
        }),
      ]);

      if (!athleteProfile) {
        return { items: [] };
      }
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
      const profileEventName = typeof athleteProfile.eventName === 'string' ? athleteProfile.eventName.trim() : '';

      const preparedItems = items.map((item: any) => {
        const completions = (item.completedActivities ?? []) as Array<{
          id: string;
          painFlag: boolean;
          startTime: Date;
          confirmedAt?: Date | null;
          source: string;
          durationMinutes?: number | null;
          distanceKm?: number | null;
          metricsJson?: any;
          matchDayDiff?: number | null;
        }>;

        const latestManual = completions.find((c) => c.source === CompletionSource.MANUAL) ?? null;
        const latestStrava = completions.find((c) => c.source === CompletionSource.STRAVA) ?? null;
        const metricsCompletion = latestStrava ?? latestManual;

        const effectiveStartUtc = getEffectiveStartUtcForCalendarItem({
          item,
          completion: metricsCompletion,
          timeZone: athleteTimezone,
        });

        return {
          item,
          latestManual,
          latestStrava,
          metricsCompletion,
          effectiveStartUtc,
        };
      });

      // Filter down to items whose effective start time falls within the requested local-day range.
      const filteredItems = preparedItems
        .filter(({ effectiveStartUtc }) => isStoredStartInUtcRange(effectiveStartUtc, utcRange))
        .sort((a, b) => a.effectiveStartUtc.getTime() - b.effectiveStartUtc.getTime());

      // Format items to include latestCompletedActivity.
      // We prefer STRAVA for metrics (duration/distance/calories) because manual completions
      // are often used for notes/pain flags on top of a synced activity.
      const formattedItems = filteredItems.map(({ item, latestManual, latestStrava, metricsCompletion, effectiveStartUtc }) => {
        const painFlag = Boolean(latestManual?.painFlag ?? latestStrava?.painFlag ?? false);
        const latestCompletedActivity = metricsCompletion
          ? {
              id: metricsCompletion.id,
              painFlag,
              source: metricsCompletion.source,
              confirmedAt: metricsCompletion.confirmedAt?.toISOString?.() ?? null,
              effectiveStartTimeUtc: getEffectiveStartUtcFromCompletion(metricsCompletion).toISOString(),
              durationMinutes: metricsCompletion.durationMinutes ?? null,
              distanceKm: metricsCompletion.distanceKm ?? null,
              caloriesKcal: getStravaCaloriesKcal(metricsCompletion.metricsJson?.strava),
              // DEV-ONLY DEBUG — Strava time diagnostics
              // Never enabled in production. Do not rely on this data.
              debug:
                includeDebug && metricsCompletion.source === CompletionSource.STRAVA
                  ? {
                      stravaTime: {
                        tzUsed: athleteTimezone,
                        stravaStartDateUtcRaw: metricsCompletion.metricsJson?.strava?.startDateUtc ?? null,
                        stravaStartDateLocalRaw: metricsCompletion.metricsJson?.strava?.startDateLocal ?? null,
                        storedStartTimeUtc: metricsCompletion.startTime?.toISOString?.() ?? null,
                      },
                    }
                  : undefined,
            }
          : null;

        const baseItem = lean
          ? {
              id: item.id,
              athleteId: item.athleteId,
              coachId: item.coachId,
              date: getLocalDayKey(effectiveStartUtc, athleteTimezone),
              plannedStartTimeLocal: item.plannedStartTimeLocal,
              origin: item.origin ?? null,
              planningStatus: item.planningStatus ?? null,
              sourceActivityId: item.sourceActivityId ?? null,
              discipline: item.discipline,
              subtype: item.subtype,
              title: item.title,
              status: item.status,
              plannedDurationMinutes: item.plannedDurationMinutes ?? null,
              plannedDistanceKm: item.plannedDistanceKm ?? null,
              notes: item.notes ?? null,
              workoutDetail: item.workoutDetail ?? null,
            }
          : {
              ...item,
              date: getLocalDayKey(effectiveStartUtc, athleteTimezone),
            };

        return {
          ...baseItem,
          // IMPORTANT: return a local-day key so the UI groups items by the athlete's timezone.
          latestCompletedActivity,
          completedActivities: undefined,
        };
      });

      let dayWeather: Record<string, any> | undefined;
      if (athleteProfile.defaultLat != null && athleteProfile.defaultLon != null) {
        try {
          const map = await getWeatherSummariesForRange({
            lat: athleteProfile.defaultLat,
            lon: athleteProfile.defaultLon,
            from: params.from,
            to: params.to,
            timezone: athleteTimezone,
          });

          if (Object.keys(map).length > 0) {
            dayWeather = map;
          }
        } catch {
          // Best-effort: calendar should still load.
        }
      }

      const setupJson = ((latestPublishedDraft?.setupJson as any) ?? {}) as Record<string, unknown>;
      const fallbackEventDate =
        (typeof setupJson.completionDate === 'string' && setupJson.completionDate.trim()) ||
        (typeof setupJson.eventDate === 'string' && setupJson.eventDate.trim()) ||
        null;
      const fallbackWeeksToEvent = Number(setupJson.weeksToEvent);

      const goalCountdown = getGoalCountdown({
        eventName: profileEventName || fallbackEventName || 'Goal event',
        eventDate: athleteProfile.eventDate ?? fallbackEventDate,
        timelineWeeks:
          athleteProfile.timelineWeeks ??
          (Number.isFinite(fallbackWeeksToEvent) && fallbackWeeksToEvent > 0 ? fallbackWeeksToEvent : null),
        todayDayKey: getTodayDayKey(athleteTimezone),
      });

      return { items: formattedItems, dayWeather, goalCountdown };
    })();

    if (!bypassCache) {
      athleteCalendarInFlight.set(cacheKey, computePromise);
    }

    try {
      const value = await computePromise;
      if (!bypassCache) {
        athleteCalendarCache.set(cacheKey, {
          value,
          expiresAtMs: now + ATHLETE_CALENDAR_CACHE_TTL_MS,
        });
      }
      prof.mark('computed');
      prof.done({
        cacheHit: false,
        cachesBypassed: bypassCache,
        itemCount: value.items.length,
        hasWeather: Boolean(value.dayWeather && Object.keys(value.dayWeather).length > 0),
      });
      return success(value, {
        headers: privateCacheHeaders({ maxAgeSeconds: 0 }),
      });
    } finally {
      if (!bypassCache) {
        athleteCalendarInFlight.delete(cacheKey);
      }
    }
  } catch (error) {
    return handleError(error);
  }
}
