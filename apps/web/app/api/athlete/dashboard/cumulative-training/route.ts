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
  dataset: z.enum(['ACTUAL', 'PLANNED', 'BOTH']).optional().nullable(),
});

type Dataset = 'ACTUAL' | 'PLANNED';
type DatasetMode = Dataset | 'BOTH';

type SessionBreakdownRow = {
  id: string;
  title: string;
  durationMinutes: number;
  distanceKm: number | null;
  rpe: number | null;
  caloriesKcal: number | null;
};

type DatasetPayload = {
  series: Record<string, number[]>; // discipline -> cumulative minutes per day (aligned with dayKeys)
  breakdown: Record<string, Record<string, SessionBreakdownRow[]>>; // dayKey -> discipline -> sessions
};

type ResponseShape = {
  from: string;
  to: string;
  dataset: DatasetMode;
  disciplineFilter: string | null;
  dayKeys: string[];
  disciplines: string[];
  actual: DatasetPayload | null;
  planned: DatasetPayload | null;
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

function buildPayloadFromItems(params: {
  items: any[];
  dataset: Dataset;
  dayKeys: string[];
  disciplineFilter: string | null;
}): { payload: DatasetPayload; availableDisciplines: Set<string> } {
  const { items, dataset, dayKeys, disciplineFilter } = params;

  const breakdown: Record<string, Record<string, SessionBreakdownRow[]>> = {};
  const dailyMinutes = new Map<string, Map<string, number>>();
  const availableDisciplines = new Set<string>();

  const addSession = (dayKey: string, discipline: string, session: SessionBreakdownRow) => {
    if (!breakdown[dayKey]) breakdown[dayKey] = {};
    if (!breakdown[dayKey]![discipline]) breakdown[dayKey]![discipline] = [];
    breakdown[dayKey]![discipline]!.push(session);

    const byDiscipline = dailyMinutes.get(dayKey) ?? new Map<string, number>();
    byDiscipline.set(discipline, (byDiscipline.get(discipline) ?? 0) + session.durationMinutes);
    dailyMinutes.set(dayKey, byDiscipline);
    availableDisciplines.add((discipline || 'OTHER').toUpperCase());
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

  return { payload: { series, breakdown }, availableDisciplines };
}

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

    const dataset: DatasetMode = (params.dataset as DatasetMode) ?? 'ACTUAL';

    const todayKey = getZonedDateKeyForNow(user.timezone);
    const fromKey = (params.from ?? '').trim() || todayKey;
    const toKey = (params.to ?? '').trim() || todayKey;

    const fromDate = parseDateOnly(fromKey, 'from');
    const toDate = parseDateOnly(toKey, 'to');
    assertValidDateRange(fromDate, toDate);

    const disciplineFilter = (params.discipline ?? '').trim().toUpperCase() || null;

    const rangeFilter = { date: { gte: fromDate, lte: toDate } };
    const disciplineWhere = disciplineFilter ? { discipline: disciplineFilter } : {};

    const dayKeys = getDayKeysInclusive(fromKey, toKey);

    const fetchPlanned = () =>
      prisma.calendarItem.findMany({
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
      });

    const fetchActual = () =>
      prisma.calendarItem.findMany({
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

    let actual: DatasetPayload | null = null;
    let planned: DatasetPayload | null = null;
    let disciplines: string[] = [];

    if (dataset === 'BOTH') {
      const [plannedItems, actualItems] = await Promise.all([fetchPlanned(), fetchActual()]);

      const plannedBuilt = buildPayloadFromItems({
        items: plannedItems,
        dataset: 'PLANNED',
        dayKeys,
        disciplineFilter,
      });
      const actualBuilt = buildPayloadFromItems({
        items: actualItems,
        dataset: 'ACTUAL',
        dayKeys,
        disciplineFilter,
      });

      planned = plannedBuilt.payload;
      actual = actualBuilt.payload;

      const union = new Set<string>([...plannedBuilt.availableDisciplines, ...actualBuilt.availableDisciplines]);
      disciplines = disciplineFilter
        ? [disciplineFilter]
        : CANONICAL_DISCIPLINES.filter((d) => union.has(d));

      // Rebuild series for the union disciplines to keep both datasets aligned.
      if (!disciplineFilter) {
        planned = {
          ...plannedBuilt.payload,
          series: disciplines.reduce<Record<string, number[]>>((acc, disc) => {
            acc[disc] = plannedBuilt.payload.series[disc] ?? dayKeys.map(() => 0);
            return acc;
          }, {}),
        };
        actual = {
          ...actualBuilt.payload,
          series: disciplines.reduce<Record<string, number[]>>((acc, disc) => {
            acc[disc] = actualBuilt.payload.series[disc] ?? dayKeys.map(() => 0);
            return acc;
          }, {}),
        };
      }
    } else if (dataset === 'PLANNED') {
      const plannedItems = await fetchPlanned();
      const built = buildPayloadFromItems({ items: plannedItems, dataset: 'PLANNED', dayKeys, disciplineFilter });
      planned = built.payload;
      disciplines = disciplineFilter ? [disciplineFilter] : CANONICAL_DISCIPLINES.filter((d) => built.availableDisciplines.has(d));

      // Ensure series includes all selected disciplines.
      planned = {
        ...built.payload,
        series: disciplines.reduce<Record<string, number[]>>((acc, disc) => {
          acc[disc] = built.payload.series[disc] ?? dayKeys.map(() => 0);
          return acc;
        }, {}),
      };
    } else {
      const actualItems = await fetchActual();
      const built = buildPayloadFromItems({ items: actualItems, dataset: 'ACTUAL', dayKeys, disciplineFilter });
      actual = built.payload;
      disciplines = disciplineFilter ? [disciplineFilter] : CANONICAL_DISCIPLINES.filter((d) => built.availableDisciplines.has(d));

      actual = {
        ...built.payload,
        series: disciplines.reduce<Record<string, number[]>>((acc, disc) => {
          acc[disc] = built.payload.series[disc] ?? dayKeys.map(() => 0);
          return acc;
        }, {}),
      };
    }

    const response: ResponseShape = {
      from: fromKey,
      to: toKey,
      dataset,
      disciplineFilter,
      dayKeys,
      disciplines,
      actual,
      planned,
    };

    return success(response, {
      headers: privateCacheHeaders({ maxAgeSeconds: 30 }),
    });
  } catch (error) {
    return handleError(error);
  }
}
