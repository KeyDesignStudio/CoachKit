import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { getLocalDayKey } from '@/lib/day-key';
import { getAthleteRangeSummary } from '@/lib/calendar/range-summary';
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
  discipline: z.string().optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      discipline: searchParams.get('discipline'),
    });

    const todayKey = getZonedDateKeyForNow(user.timezone);
    const fromKey = (params.from ?? '').trim() || todayKey;
    const toKey = (params.to ?? '').trim() || todayKey;

    const fromDate = parseDateOnly(fromKey, 'from');
    const toDate = parseDateOnly(toKey, 'to');
    assertValidDateRange(fromDate, toDate);

    const discipline = (params.discipline ?? '').trim().toUpperCase() || null;

    const rangeFilter = { date: { gte: fromDate, lte: toDate } };
    const disciplineFilter = discipline ? { discipline } : {};

    const items = await prisma.calendarItem.findMany({
      where: {
        athleteId: user.id,
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
          select: { durationMinutes: true, distanceKm: true, confirmedAt: true, painFlag: true, metricsJson: true },
        },
      },
      orderBy: [{ date: 'asc' as const }],
    });

    const rangeSummary = getAthleteRangeSummary({
      items: items.map((item) => ({
        date: item.date.toISOString(),
        discipline: item.discipline,
        status: item.status,
        plannedDurationMinutes: item.plannedDurationMinutes,
        plannedDistanceKm: item.plannedDistanceKm,
        latestCompletedActivity: item.completedActivities?.[0]
          ? {
              durationMinutes: item.completedActivities[0].durationMinutes,
              distanceKm: item.completedActivities[0].distanceKm,
              caloriesKcal: getStravaCaloriesKcal(item.completedActivities[0].metricsJson),
              kilojoules: getStravaKilojoules(item.completedActivities[0].metricsJson),
              confirmedAt: item.completedActivities[0].confirmedAt ? item.completedActivities[0].confirmedAt.toISOString() : null,
            }
          : null,
      })),
      timeZone: user.timezone,
      fromDayKey: fromKey,
      toDayKey: toKey,
      todayDayKey: todayKey,
      weightKg: null,
    });

    const pendingConfirmationCount = items.filter(
      (item) => item.status === CalendarItemStatus.COMPLETED_SYNCED_DRAFT
    ).length;

    const painFlagWorkouts = items.filter((item) => item.completedActivities?.[0]?.painFlag).length;

    const nextUp = items
      .filter((item) => item.status === CalendarItemStatus.PLANNED)
      .filter((item) => getLocalDayKey(item.date, user.timezone) >= todayKey)
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

    return success(
      {
        attention: {
          pendingConfirmation: pendingConfirmationCount,
          workoutsMissed: rangeSummary.totals.workoutsMissed,
          painFlagWorkouts,
        },
        rangeSummary,
        nextUp,
      },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
