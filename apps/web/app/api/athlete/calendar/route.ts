import { NextRequest } from 'next/server';
import { CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { isStravaTimeDebugEnabled } from '@/lib/debug';
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
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' }),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' }),
});

const includeRefs = {
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
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

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const includeDebug = isStravaTimeDebugEnabled();
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    const fromDate = parseDateOnly(params.from, 'from');
    const toDate = parseDateOnly(params.to, 'to');
    assertValidDateRange(fromDate, toDate);

    const athleteTimezone = user.timezone ?? 'Australia/Brisbane';
    const utcRange = getUtcRangeForLocalDayKeyRange({
      fromDayKey: params.from,
      toDayKey: params.to,
      timeZone: athleteTimezone,
    });

    // Candidate fetch window: widen by a day on either side to account for timezone offsets
    // and date-only storage quirks.
    const candidateFromDate = parseDateOnly(addDaysToDayKey(params.from, -1), 'from');
    const candidateToDate = parseDateOnly(addDaysToDayKey(params.to, 1), 'to');

    const [athleteProfile, items] = await Promise.all([
      prisma.athleteProfile.findUnique({
        where: { userId: user.id },
        select: { coachId: true, defaultLat: true, defaultLon: true },
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
        include: includeRefs,
      }),
    ]);

    if (!athleteProfile) {
      return success(
        { items: [] },
        {
          headers: privateCacheHeaders({ maxAgeSeconds: 0 }),
        }
      );
    }

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

      const effectiveStartUtc = getEffectiveStartUtcForCalendarItem({ item, completion: metricsCompletion });

      return {
        item,
        completions,
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

      return {
        ...item,
        // IMPORTANT: return a local-day key so the UI groups items by the athlete's timezone.
        date: getLocalDayKey(effectiveStartUtc, athleteTimezone),
        latestCompletedActivity,
        completedActivities: undefined,
      };
    });

    let dayWeather: Record<string, any> | undefined;
    if (athleteProfile?.defaultLat != null && athleteProfile?.defaultLon != null) {
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

    return success(
      { items: formattedItems, dayWeather },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 0 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
