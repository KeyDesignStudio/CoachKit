import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { addDaysToDayKey, startOfWeekDayKey } from '@/lib/day-key';
import { getWeeklyPlannedCompletedSummary } from '@/lib/calendar/weekly-summary';

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

const COMPLETED_CONFIRMED: CalendarItemStatus[] = [
  CalendarItemStatus.COMPLETED_MANUAL,
  CalendarItemStatus.COMPLETED_SYNCED,
];

function minutesOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function distanceOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

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

    const weekStartKey = startOfWeekDayKey(todayKey);
    const weekEndKey = addDaysToDayKey(weekStartKey, 6);

    const fromDate = parseDateOnly(fromKey, 'from');
    const toDate = parseDateOnly(toKey, 'to');
    assertValidDateRange(fromDate, toDate);

    const discipline = (params.discipline ?? '').trim().toUpperCase() || null;

    const rangeFilter = { date: { gte: fromDate, lte: toDate } };
    const disciplineFilter = discipline ? { discipline } : {};

    const weekFromDate = parseDateOnly(weekStartKey, 'from');
    const weekToDate = parseDateOnly(weekEndKey, 'to');

    const [completedCount, skippedCount, pendingConfirmationCount, weeklyItems] = await Promise.all([
      prisma.calendarItem.count({
        where: {
          athleteId: user.id,
          deletedAt: null,
          ...rangeFilter,
          ...disciplineFilter,
          status: { in: COMPLETED_CONFIRMED },
        },
      }),
      prisma.calendarItem.count({
        where: {
          athleteId: user.id,
          deletedAt: null,
          ...rangeFilter,
          ...disciplineFilter,
          status: CalendarItemStatus.SKIPPED,
        },
      }),
      prisma.calendarItem.count({
        where: {
          athleteId: user.id,
          deletedAt: null,
          ...rangeFilter,
          ...disciplineFilter,
          status: CalendarItemStatus.COMPLETED_SYNCED_DRAFT,
        },
      }),
      prisma.calendarItem.findMany({
        where: {
          athleteId: user.id,
          deletedAt: null,
          date: { gte: weekFromDate, lte: weekToDate },
        },
        select: {
          date: true,
          discipline: true,
          status: true,
          plannedDurationMinutes: true,
          completedActivities: {
            orderBy: [{ startTime: 'desc' as const }],
            take: 1,
            select: { durationMinutes: true },
          },
        },
      }),
    ]);

    // Missed = planned workouts on dates strictly before today in athlete timezone.
    const todayUtcMidnight = new Date(`${todayKey}T00:00:00.000Z`);
    const workoutsMissed = await prisma.calendarItem.count({
      where: {
        athleteId: user.id,
        deletedAt: null,
        ...rangeFilter,
        ...disciplineFilter,
        status: CalendarItemStatus.PLANNED,
        date: {
          gte: fromDate,
          lte: toDate,
          lt: todayUtcMidnight,
        },
      },
    });

    // Optional attention metric (trivial): confirmed workouts with pain flagged.
    const painFlagWorkouts = await prisma.calendarItem.count({
      where: {
        athleteId: user.id,
        deletedAt: null,
        ...rangeFilter,
        ...disciplineFilter,
        status: { in: COMPLETED_CONFIRMED },
        completedActivities: { some: { painFlag: true } },
      },
    });

    const completedItems = await prisma.calendarItem.findMany({
      where: {
        athleteId: user.id,
        deletedAt: null,
        ...rangeFilter,
        ...disciplineFilter,
        status: { in: COMPLETED_CONFIRMED },
      },
      select: {
        discipline: true,
        completedActivities: {
          orderBy: [{ startTime: 'desc' as const }],
          take: 1,
          select: { durationMinutes: true, distanceKm: true },
        },
      },
    });

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

    const weeklySummary = getWeeklyPlannedCompletedSummary({
      items: weeklyItems.map((item) => ({
        date: item.date.toISOString(),
        discipline: item.discipline,
        status: item.status,
        plannedDurationMinutes: item.plannedDurationMinutes,
        latestCompletedActivity: item.completedActivities?.[0]
          ? { durationMinutes: item.completedActivities[0].durationMinutes }
          : null,
      })),
      timeZone: user.timezone,
      fromDayKey: weekStartKey,
      toDayKey: weekEndKey,
    });

    return success(
      {
        kpis: {
          workoutsCompleted: completedCount,
          workoutsSkipped: skippedCount,
          totalTrainingMinutes: totalMinutes,
          totalDistanceKm,
        },
        attention: {
          pendingConfirmation: pendingConfirmationCount,
          workoutsMissed,
          painFlagWorkouts,
        },
        disciplineLoad,
        weeklySummary,
      },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
