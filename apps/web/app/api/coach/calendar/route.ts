import { NextRequest } from 'next/server';
import { CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete, requireCoach } from '@/lib/auth';
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
  athleteId: z.string().trim().min(1, { message: 'athleteId is required.' }),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' }),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' }),
});

const COMPLETIONS_TAKE = 5;
const LEAN_CALENDAR_ITEMS = new Set(['1', 'true', 'yes']);
const completionSources: CompletionSource[] = [CompletionSource.MANUAL, CompletionSource.STRAVA];

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

export async function GET(request: NextRequest) {
  try {
    const prof = createServerProfiler('coach/calendar');
    prof.mark('start');
    const { user } = await requireCoach();
    const includeDebug = isStravaTimeDebugEnabled();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      athleteId: searchParams.get('athleteId'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });
    const lean = LEAN_CALENDAR_ITEMS.has(String(searchParams.get('lean') ?? '').toLowerCase());

    const athlete = await assertCoachOwnsAthlete(params.athleteId, user.id);
    const athleteTimezone = athlete?.user?.timezone ?? 'Australia/Brisbane';

    const fromDate = parseDateOnly(params.from, 'from');
    const toDate = parseDateOnly(params.to, 'to');
    assertValidDateRange(fromDate, toDate);

    const utcRange = getUtcRangeForLocalDayKeyRange({
      fromDayKey: params.from,
      toDayKey: params.to,
      timeZone: athleteTimezone,
    });

    // Widen the candidate window: we store `CalendarItem.date` as UTC-midnight date-only,
    // which can differ from athlete-local day boundaries.
    const candidateFromDate = parseDateOnly(addDaysToDayKey(params.from, -1), 'from');
    const candidateToDate = parseDateOnly(addDaysToDayKey(params.to, 1), 'to');

    prof.mark('auth+parse');

    const items = await prisma.calendarItem.findMany({
      where: {
        athleteId: params.athleteId,
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
      const effectiveStartUtc = getEffectiveStartUtcForCalendarItem({
        item,
        completion: metricsCompletion,
        timeZone: athleteTimezone,
      });

      return { item, completions, latestManual, latestStrava, metricsCompletion, effectiveStartUtc };
    });

    const filteredItems = preparedItems
      .filter(({ effectiveStartUtc }) => isStoredStartInUtcRange(effectiveStartUtc, utcRange))
      .sort((a, b) => a.effectiveStartUtc.getTime() - b.effectiveStartUtc.getTime());

    // Format items to include latestCompletedActivity.
    // Prefer STRAVA for metrics (duration/distance/calories) because manual completions
    // are often used for notes/pain flags on top of a synced activity.
    const formattedItems = filteredItems.map(
      ({ item, latestManual, latestStrava, metricsCompletion, effectiveStartUtc }) => {
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

        const effectiveDayKey = getLocalDayKey(effectiveStartUtc, athleteTimezone);
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

    prof.mark('format');
    prof.done({ itemCount: formattedItems.length });

    return success(
      { items: formattedItems, athleteTimezone, dayWeather },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 0 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
