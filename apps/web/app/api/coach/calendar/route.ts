import { NextRequest } from 'next/server';
import { CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { forbidden } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { isStravaTimeDebugEnabled } from '@/lib/debug';
import { createServerProfiler } from '@/lib/server-profiler';
import { getWeatherSummariesForRange } from '@/lib/weather-server';
import { addDaysToDayKey, getLocalDayKey } from '@/lib/day-key';
import { getStravaCaloriesKcal } from '@/lib/strava-metrics';
import {
  getEffectiveStartUtcForCalendarItem,
  getEffectiveStartUtcFromCompletion,
  getUtcRangeForLocalDayKeyRange,
  isStoredStartInUtcRange,
} from '@/lib/calendar-local-day';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  athleteId: z.string().trim().optional().nullable(),
  athleteIds: z.string().trim().optional().nullable(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' }),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' }),
})
.superRefine((value, ctx) => {
  const single = (value.athleteId ?? '').trim();
  const multi = (value.athleteIds ?? '').trim();
  if (!single && !multi) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'athleteId or athleteIds is required.',
      path: ['athleteId'],
    });
  }
});

const COMPLETIONS_TAKE = 5;
const LEAN_CALENDAR_ITEMS = new Set(['1', 'true', 'yes']);
const completionSources: CompletionSource[] = [CompletionSource.MANUAL, CompletionSource.STRAVA];
const ATHLETE_ACCESS_CACHE_TTL_MS = 30_000;
const COACH_CALENDAR_CACHE_TTL_MS = 30_000;

type CoachAthleteAccess = {
  userId: string;
  defaultLat: number | null;
  defaultLon: number | null;
  timezone: string;
};

type CoachCalendarResponse = {
  items: any[];
  athleteTimezone: string;
  dayWeather?: Record<string, any>;
};

type CoachCalendarComputed = {
  payload: CoachCalendarResponse;
  meta: {
    itemCount: number;
    athleteCount: number;
    athleteAccessCacheHit: boolean;
    hasWeather: boolean;
  };
};

const coachAthleteAccessCache = new Map<
  string,
  {
    value: CoachAthleteAccess[];
    expiresAtMs: number;
  }
>();
const coachAthleteAccessInFlight = new Map<string, Promise<CoachAthleteAccess[]>>();
const coachCalendarResponseCache = new Map<
  string,
  {
    value: CoachCalendarResponse;
    meta: CoachCalendarComputed['meta'];
    expiresAtMs: number;
  }
>();
const coachCalendarResponseInFlight = new Map<string, Promise<CoachCalendarComputed>>();

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
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  completedActivities: {
    orderBy: [{ startTime: 'desc' as const }],
    take: COMPLETIONS_TAKE,
    where: {
      source: { in: completionSources },
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

const calendarItemFullSelect = {
  ...calendarItemLeanSelect,
  plannedDurationMinutes: true,
  plannedDistanceKm: true,
  distanceMeters: true,
  intensityTarget: true,
  tags: true,
  equipment: true,
  workoutStructure: true,
  notes: true,
  intensityType: true,
  intensityTargetJson: true,
  workoutDetail: true,
  attachmentsJson: true,
  templateId: true,
  groupSessionId: true,
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
};

function buildLeanCalendarItem(params: {
  item: any;
  effectiveDayKey: string;
  latestCompletedActivity: {
    painFlag: boolean;
    source: string;
    confirmedAt: string | null;
    effectiveStartTimeUtc: string;
    durationMinutes: number | null;
    distanceKm: number | null;
    caloriesKcal: number | null;
  } | null;
}) {
  const { item, effectiveDayKey, latestCompletedActivity } = params;

  return {
    id: item.id,
    athleteId: item.athleteId,
    coachId: item.coachId,
    date: effectiveDayKey,
    plannedStartTimeLocal: item.plannedStartTimeLocal,
    discipline: item.discipline,
    subtype: item.subtype,
    title: item.title,
    status: item.status,
    reviewedAt: item.reviewedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.origin ? { origin: item.origin } : {}),
    ...(item.planningStatus ? { planningStatus: item.planningStatus } : {}),
    ...(item.sourceActivityId ? { sourceActivityId: item.sourceActivityId } : {}),
    ...(typeof item.plannedDurationMinutes === 'number' ? { plannedDurationMinutes: item.plannedDurationMinutes } : {}),
    ...(typeof item.plannedDistanceKm === 'number' ? { plannedDistanceKm: item.plannedDistanceKm } : {}),
    ...(typeof item.distanceMeters === 'number' ? { distanceMeters: item.distanceMeters } : {}),
    ...(item.intensityTarget ? { intensityTarget: item.intensityTarget } : {}),
    ...(Array.isArray(item.tags) && item.tags.length > 0 ? { tags: item.tags } : {}),
    ...(Array.isArray(item.equipment) && item.equipment.length > 0 ? { equipment: item.equipment } : {}),
    ...(item.workoutStructure != null ? { workoutStructure: item.workoutStructure } : {}),
    ...(item.notes ? { notes: item.notes } : {}),
    ...(item.workoutDetail ? { workoutDetail: item.workoutDetail } : {}),
    ...(latestCompletedActivity ? { latestCompletedActivity } : {}),
  };
}

function buildCoachAthleteAccessCacheKey(params: { coachId: string; athleteIds: string[] }) {
  return [params.coachId, ...params.athleteIds].join('|');
}

function buildCoachCalendarResponseCacheKey(params: {
  coachId: string;
  athleteIds: string[];
  from: string;
  to: string;
  lean: boolean;
  includeDebug: boolean;
}) {
  return [
    params.coachId,
    ...params.athleteIds,
    params.from,
    params.to,
    params.lean ? 'lean' : 'full',
    params.includeDebug ? 'debug' : 'nodebug',
  ].join('|');
}

async function getCoachAthleteAccess(params: {
  coachId: string;
  athleteIds: string[];
  bypassCache: boolean;
  profiler?: ReturnType<typeof createServerProfiler>;
}) {
  const cacheKey = buildCoachAthleteAccessCacheKey(params);
  const now = Date.now();

  if (!params.bypassCache) {
    const cached = coachAthleteAccessCache.get(cacheKey);
    if (cached && cached.expiresAtMs > now) {
      params.profiler?.mark('athlete-access:cache-hit');
      return { value: cached.value, cacheHit: true as const };
    }
  }

  const existing = !params.bypassCache ? coachAthleteAccessInFlight.get(cacheKey) : null;
  if (existing) {
    params.profiler?.mark('athlete-access:inflight-hit');
    return { value: await existing, cacheHit: true as const };
  }

  params.profiler?.mark('athlete-access:cache-miss');
  const promise = prisma.athleteProfile
    .findMany({
      where: {
        coachId: params.coachId,
        userId: { in: params.athleteIds },
      },
      select: {
        userId: true,
        defaultLat: true,
        defaultLon: true,
        user: {
          select: {
            timezone: true,
          },
        },
      },
    })
    .then((rows) =>
      rows.map((athlete) => ({
        userId: athlete.userId,
        defaultLat: athlete.defaultLat,
        defaultLon: athlete.defaultLon,
        timezone: athlete.user.timezone ?? 'Australia/Brisbane',
      }))
    );

  if (!params.bypassCache) {
    coachAthleteAccessInFlight.set(cacheKey, promise);
  }

  try {
    const value = await promise;
    if (!params.bypassCache) {
      coachAthleteAccessCache.set(cacheKey, {
        value,
        expiresAtMs: now + ATHLETE_ACCESS_CACHE_TTL_MS,
      });
    }
    params.profiler?.mark('athlete-access:loaded');
    return { value, cacheHit: false as const };
  } finally {
    if (!params.bypassCache) {
      coachAthleteAccessInFlight.delete(cacheKey);
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const prof = createServerProfiler('coach/calendar');
    prof.mark('start');
    const { user } = await requireCoach();
    const includeDebug = isStravaTimeDebugEnabled();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      athleteId: searchParams.get('athleteId'),
      athleteIds: searchParams.get('athleteIds'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });
    const lean = LEAN_CALENDAR_ITEMS.has(String(searchParams.get('lean') ?? '').toLowerCase());
    const bypassCaches = searchParams.has('t');

    const parsedAthleteIds = new Set<string>();
    const singleAthleteId = (params.athleteId ?? '').trim();
    if (singleAthleteId) parsedAthleteIds.add(singleAthleteId);
    const multiAthleteIds = (params.athleteIds ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    multiAthleteIds.forEach((id) => parsedAthleteIds.add(id));

    const athleteIds = Array.from(parsedAthleteIds);
    if (athleteIds.length === 0) {
      throw forbidden('Athlete access required.');
    }

    const fromDate = parseDateOnly(params.from, 'from');
    const toDate = parseDateOnly(params.to, 'to');
    assertValidDateRange(fromDate, toDate);

    const cacheAthleteIds = athleteIds;
    const responseCacheKey = buildCoachCalendarResponseCacheKey({
      coachId: user.id,
      athleteIds: cacheAthleteIds,
      from: params.from,
      to: params.to,
      lean,
      includeDebug,
    });
    const now = Date.now();

    if (!bypassCaches) {
      const cached = coachCalendarResponseCache.get(responseCacheKey);
      if (cached && cached.expiresAtMs > now) {
        prof.mark('response:cache-hit');
        prof.done({
          ...cached.meta,
          responseCacheHit: true,
          responseInFlightHit: false,
          cachesBypassed: false,
        });
        return success(cached.value, {
          headers: privateCacheHeaders({ maxAgeSeconds: 0 }),
        });
      }
    }

    const existing = !bypassCaches ? coachCalendarResponseInFlight.get(responseCacheKey) : null;
    if (existing) {
      prof.mark('response:inflight-hit');
      const computed = await existing;
      prof.done({
        ...computed.meta,
        responseCacheHit: true,
        responseInFlightHit: true,
        cachesBypassed: false,
      });
      return success(computed.payload, {
        headers: privateCacheHeaders({ maxAgeSeconds: 0 }),
      });
    }

    const computePromise = (async (): Promise<CoachCalendarComputed> => {
      // Widen the candidate window: we store `CalendarItem.date` as UTC-midnight date-only,
      // which can differ from athlete-local day boundaries.
      const candidateFromDate = parseDateOnly(addDaysToDayKey(params.from, -1), 'from');
      const candidateToDate = parseDateOnly(addDaysToDayKey(params.to, 1), 'to');

      const athleteAccess = await getCoachAthleteAccess({
        coachId: user.id,
        athleteIds,
        bypassCache: bypassCaches,
        profiler: prof,
      });
      const athletes = athleteAccess.value;

      if (athletes.length !== athleteIds.length) {
        throw forbidden('Athlete access required.');
      }

      const athleteById = new Map(athletes.map((athlete) => [athlete.userId, athlete] as const));
      const timezoneByAthleteId = new Map(
        athletes.map((athlete) => [athlete.userId, athlete.timezone ?? 'Australia/Brisbane'] as const)
      );
      const utcRangeByAthleteId = new Map(
        athleteIds.map((athleteId) => [
          athleteId,
          getUtcRangeForLocalDayKeyRange({
            fromDayKey: params.from,
            toDayKey: params.to,
            timeZone: timezoneByAthleteId.get(athleteId) ?? 'Australia/Brisbane',
          }),
        ])
      );
      const primaryAthleteTimezone = timezoneByAthleteId.get(athleteIds[0]) ?? 'Australia/Brisbane';

      prof.mark('auth+parse');

      const items = await prisma.calendarItem.findMany({
        where: {
          athleteId: { in: athleteIds },
          coachId: user.id,
          deletedAt: null,
          date: {
            gte: candidateFromDate,
            lte: candidateToDate,
          },
        },
        orderBy: [{ date: 'asc' }, { plannedStartTimeLocal: 'asc' }],
        select: lean ? calendarItemLeanSelect : calendarItemFullSelect,
      });

      prof.mark('db');

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
        const itemTimezone = timezoneByAthleteId.get(item.athleteId) ?? 'Australia/Brisbane';
        const effectiveStartUtc = getEffectiveStartUtcForCalendarItem({
          item,
          completion: metricsCompletion,
          timeZone: itemTimezone,
        });

        return { item, latestManual, latestStrava, metricsCompletion, effectiveStartUtc, itemTimezone };
      });

      const filteredItems = preparedItems
        .filter(({ item, effectiveStartUtc }) => {
          const utcRange = utcRangeByAthleteId.get(item.athleteId);
          return utcRange ? isStoredStartInUtcRange(effectiveStartUtc, utcRange) : false;
        })
        .sort((a, b) => a.effectiveStartUtc.getTime() - b.effectiveStartUtc.getTime());

      // Format items to include latestCompletedActivity.
      // Prefer STRAVA for metrics (duration/distance/calories) because manual completions
      // are often used for notes/pain flags on top of a synced activity.
      const formattedItems = filteredItems.map(
        ({ item, latestManual, latestStrava, metricsCompletion, effectiveStartUtc, itemTimezone }) => {
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
                          tzUsed: itemTimezone,
                          stravaStartDateUtcRaw: metricsCompletion.metricsJson?.strava?.startDateUtc ?? null,
                          stravaStartDateLocalRaw: metricsCompletion.metricsJson?.strava?.startDateLocal ?? null,
                          storedStartTimeUtc: metricsCompletion.startTime?.toISOString?.() ?? null,
                        },
                      }
                    : undefined,
              }
            : null;

          const effectiveDayKey = getLocalDayKey(effectiveStartUtc, itemTimezone);
          if (lean) {
            return buildLeanCalendarItem({
              item,
              effectiveDayKey,
              latestCompletedActivity,
            });
          }

          return {
            id: item.id,
            athleteId: item.athleteId,
            coachId: item.coachId,
            date: effectiveDayKey,
            plannedStartTimeLocal: item.plannedStartTimeLocal,
            origin: item.origin ?? null,
            planningStatus: item.planningStatus ?? null,
            sourceActivityId: item.sourceActivityId ?? null,
            discipline: item.discipline,
            subtype: item.subtype,
            title: item.title,
            plannedDurationMinutes: item.plannedDurationMinutes ?? null,
            plannedDistanceKm: item.plannedDistanceKm ?? null,
            distanceMeters: item.distanceMeters ?? null,
            intensityTarget: item.intensityTarget ?? null,
            tags: item.tags ?? [],
            equipment: item.equipment ?? [],
            workoutStructure: item.workoutStructure ?? null,
            notes: item.notes ?? null,
            intensityType: item.intensityType ?? null,
            intensityTargetJson: item.intensityTargetJson ?? null,
            workoutDetail: item.workoutDetail ?? null,
            attachmentsJson: item.attachmentsJson ?? null,
            status: item.status,
            templateId: item.templateId ?? null,
            groupSessionId: item.groupSessionId ?? null,
            reviewedAt: item.reviewedAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            template: item.template ?? null,
            groupSession: item.groupSession ?? null,
            latestCompletedActivity,
          };
        }
      );

      let dayWeather: Record<string, any> | undefined;
      if (athleteIds.length === 1) {
        const athlete = athleteById.get(athleteIds[0]);
        const athleteTimezone = timezoneByAthleteId.get(athleteIds[0]) ?? primaryAthleteTimezone;
        if (athlete?.defaultLat != null && athlete?.defaultLon != null) {
          try {
            const map = await getWeatherSummariesForRange({
              lat: athlete.defaultLat,
              lon: athlete.defaultLon,
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
      }

      return {
        payload: { items: formattedItems, athleteTimezone: primaryAthleteTimezone, dayWeather },
        meta: {
          itemCount: formattedItems.length,
          athleteCount: athleteIds.length,
          athleteAccessCacheHit: athleteAccess.cacheHit,
          hasWeather: Boolean(dayWeather && Object.keys(dayWeather).length > 0),
        },
      };
    })();

    if (!bypassCaches) {
      coachCalendarResponseInFlight.set(responseCacheKey, computePromise);
    }

    try {
      const computed = await computePromise;
      if (!bypassCaches) {
        coachCalendarResponseCache.set(responseCacheKey, {
          value: computed.payload,
          meta: computed.meta,
          expiresAtMs: now + COACH_CALENDAR_CACHE_TTL_MS,
        });
      }
      prof.mark('format');
      prof.done({
        ...computed.meta,
        responseCacheHit: false,
        responseInFlightHit: false,
        cachesBypassed: bypassCaches,
      });

      return success(computed.payload, {
        headers: privateCacheHeaders({ maxAgeSeconds: 0 }),
      });
    } finally {
      if (!bypassCaches) {
        coachCalendarResponseInFlight.delete(responseCacheKey);
      }
    }
  } catch (error) {
    return handleError(error);
  }
}
