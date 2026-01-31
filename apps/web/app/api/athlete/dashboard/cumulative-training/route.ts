import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { addDaysToDayKey, formatUtcDayKey } from '@/lib/day-key';
import { getStravaCaloriesKcal } from '@/lib/strava-metrics';

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
  dataset: z.enum(['ACTUAL', 'PLANNED']).optional().nullable(),
});

type Dataset = 'ACTUAL' | 'PLANNED';

type SessionBreakdownRow = {
  id: string;
  title: string;
  durationMinutes: number;
  distanceKm: number | null;
  rpe: number | null;
  caloriesKcal: number | null;
};

type ResponseShape = {
  from: string;
  to: string;
  dataset: Dataset;
  disciplineFilter: string | null;
  dayKeys: string[];
  disciplines: string[];
  series: Record<string, number[]>; // discipline -> cumulative minutes per day (aligned with dayKeys)
  breakdown: Record<string, Record<string, SessionBreakdownRow[]>>; // dayKey -> discipline -> sessions
};

const COMPLETED_CONFIRMED: CalendarItemStatus[] = [
  CalendarItemStatus.COMPLETED_MANUAL,
  CalendarItemStatus.COMPLETED_SYNCED,
];

function minutesOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function distanceOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function rpeOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function caloriesOrNull(metricsJson: unknown): number | null {
  if (!metricsJson || typeof metricsJson !== 'object') return null;
  const root = metricsJson as Record<string, unknown>;
  const strava = root.strava;
  return getStravaCaloriesKcal(strava);
}

function getDayKeysInclusive(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  let cursor = fromKey;
  out.push(cursor);
  while (cursor !== toKey) {
    cursor = addDaysToDayKey(cursor, 1);
    out.push(cursor);
    // Hard stop (safety) to avoid infinite loops on unexpected input.
    if (out.length > 400) break;
  }
  return out;
}

const CANONICAL_DISCIPLINES = ['BIKE', 'RUN', 'SWIM', 'OTHER'] as const;

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      discipline: searchParams.get('discipline'),
      dataset: searchParams.get('dataset'),
    });

    const dataset: Dataset = params.dataset ?? 'ACTUAL';

    const todayKey = getZonedDateKeyForNow(user.timezone);
    const fromKey = (params.from ?? '').trim() || todayKey;
    const toKey = (params.to ?? '').trim() || todayKey;

    const fromDate = parseDateOnly(fromKey, 'from');
    const toDate = parseDateOnly(toKey, 'to');
    assertValidDateRange(fromDate, toDate);

    const disciplineFilter = (params.discipline ?? '').trim().toUpperCase() || null;

    const rangeFilter = { date: { gte: fromDate, lte: toDate } };
    const disciplineWhere = disciplineFilter ? { discipline: disciplineFilter } : {};

    const items =
      dataset === 'PLANNED'
        ? await prisma.calendarItem.findMany({
            where: {
              athleteId: user.id,
              deletedAt: null,
              ...rangeFilter,
              ...disciplineWhere,
              status: CalendarItemStatus.PLANNED,
            },
            select: {
              id: true,
              date: true,
              discipline: true,
              title: true,
              plannedDurationMinutes: true,
              plannedDistanceKm: true,
            },
            orderBy: [{ date: 'asc' as const }],
          })
        : await prisma.calendarItem.findMany({
            where: {
              athleteId: user.id,
              deletedAt: null,
              ...rangeFilter,
              ...disciplineWhere,
              status: { in: COMPLETED_CONFIRMED },
            },
            select: {
              id: true,
              date: true,
              discipline: true,
              title: true,
              completedActivities: {
                orderBy: [{ startTime: 'desc' as const }],
                take: 1,
                select: {
                  id: true,
                  durationMinutes: true,
                  distanceKm: true,
                  rpe: true,
                  metricsJson: true,
                },
              },
            },
            orderBy: [{ date: 'asc' as const }],
          });

    // dayKey -> discipline -> { totalMinutes, sessions[] }
    const breakdown: Record<string, Record<string, SessionBreakdownRow[]>> = {};
    const dailyMinutes = new Map<string, Map<string, number>>();

    const addSession = (dayKey: string, discipline: string, session: SessionBreakdownRow) => {
      if (!breakdown[dayKey]) breakdown[dayKey] = {};
      if (!breakdown[dayKey]![discipline]) breakdown[dayKey]![discipline] = [];
      breakdown[dayKey]![discipline]!.push(session);

      const byDiscipline = dailyMinutes.get(dayKey) ?? new Map<string, number>();
      byDiscipline.set(discipline, (byDiscipline.get(discipline) ?? 0) + session.durationMinutes);
      dailyMinutes.set(dayKey, byDiscipline);
    };

    for (const item of items) {
      const discipline = (item.discipline || 'OTHER').toUpperCase();
      const dayKey = formatUtcDayKey(item.date);

      if (dataset === 'PLANNED') {
        const durationMinutes = minutesOrZero((item as any).plannedDurationMinutes);
        if (durationMinutes <= 0) continue;
        addSession(dayKey, discipline, {
          id: item.id,
          title: item.title,
          durationMinutes,
          distanceKm: distanceOrNull((item as any).plannedDistanceKm),
          rpe: null,
          caloriesKcal: null,
        });
        continue;
      }

      const latest = (item as any).completedActivities?.[0];
      const durationMinutes = minutesOrZero(latest?.durationMinutes);
      if (durationMinutes <= 0) continue;

      addSession(dayKey, discipline, {
        id: latest?.id ?? item.id,
        title: item.title,
        durationMinutes,
        distanceKm: distanceOrNull(latest?.distanceKm),
        rpe: rpeOrNull(latest?.rpe),
        caloriesKcal: caloriesOrNull(latest?.metricsJson),
      });
    }

    const dayKeys = getDayKeysInclusive(fromKey, toKey);

    // Determine which disciplines to include.
    const availableDisciplines = new Set<string>();
    for (const [, byDisc] of dailyMinutes.entries()) {
      for (const disc of byDisc.keys()) {
        availableDisciplines.add((disc || 'OTHER').toUpperCase());
      }
    }

    const disciplines = disciplineFilter
      ? [disciplineFilter]
      : CANONICAL_DISCIPLINES.filter((d) => availableDisciplines.has(d));

    const series: Record<string, number[]> = {};

    for (const disc of disciplines) {
      let running = 0;
      series[disc] = dayKeys.map((dayKey) => {
        const daily = dailyMinutes.get(dayKey)?.get(disc) ?? 0;
        running += daily;
        return running;
      });
    }

    const response: ResponseShape = {
      from: fromKey,
      to: toKey,
      dataset,
      disciplineFilter,
      dayKeys,
      disciplines,
      series,
      breakdown,
    };

    return success(response, {
      headers: privateCacheHeaders({ maxAgeSeconds: 30 }),
    });
  } catch (error) {
    return handleError(error);
  }
}
