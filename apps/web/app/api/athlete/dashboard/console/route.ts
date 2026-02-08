import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { assertValidDateRange, combineDateWithLocalTime, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { addDaysToDayKey } from '@/lib/day-key';
import { getAthleteRangeSummary } from '@/lib/calendar/range-summary';
import { getUtcRangeForLocalDayKeyRange, isStoredStartInUtcRange } from '@/lib/calendar-local-day';
import { getStravaCaloriesKcal, getStravaKilojoules } from '@/lib/strava-metrics';

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
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    const todayKey = getZonedDateKeyForNow(user.timezone);
    const fromKey = (params.from ?? '').trim() || todayKey;
    const toKey = (params.to ?? '').trim() || todayKey;

    const fromDate = parseDateOnly(fromKey, 'from');
    const toDate = parseDateOnly(toKey, 'to');
    assertValidDateRange(fromDate, toDate);

    const candidateFromDate = parseDateOnly(addDaysToDayKey(fromKey, -1), 'from');
    const candidateToDate = parseDateOnly(addDaysToDayKey(toKey, 1), 'to');
    const rangeFilter = { date: { gte: candidateFromDate, lte: candidateToDate } };
    const utcRange = getUtcRangeForLocalDayKeyRange({
      fromDayKey: fromKey,
      toDayKey: toKey,
      timeZone: user.timezone,
    });

    const items = await prisma.calendarItem.findMany({
      where: {
        athleteId: user.id,
        deletedAt: null,
        ...rangeFilter,
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
    });

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
        const effectiveStartUtc = completionStartUtc ?? combineDateWithLocalTime(item.date, item.plannedStartTimeLocal);
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
      timeZone: user.timezone,
      fromDayKey: fromKey,
      toDayKey: toKey,
      todayDayKey: todayKey,
      weightKg: null,
    });

    return success(
      {
        rangeSummary,
      },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
