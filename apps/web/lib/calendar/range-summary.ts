import { addDaysToDayKey, getLocalDayKey } from '@/lib/day-key';
import {
  getCompletionCaloriesKcal,
  getCompletionDistanceKm,
  getCompletionMinutes,
  isCompletedCalendarItem,
} from '@/lib/calendar/completion';

export type RangeSummaryItem = {
  date: string;
  discipline?: string | null;
  status?: string | null;
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
  plannedCaloriesKcal?: number | null;
  latestCompletedActivity?: {
    confirmedAt?: string | null;
    durationMinutes?: number | null;
    distanceKm?: number | null;
    caloriesKcal?: number | null;
  } | null;
};

export type RangeSummaryRow = {
  discipline: string;
  plannedMinutes: number;
  completedMinutes: number;
  plannedDistanceKm: number;
  completedDistanceKm: number;
  plannedCaloriesKcal: number | null;
  completedCaloriesKcal: number;
};

export type RangeSummary = {
  fromDayKey: string;
  toDayKey: string;
  totals: {
    plannedMinutes: number;
    completedMinutes: number;
    plannedDistanceKm: number;
    completedDistanceKm: number;
    plannedCaloriesKcal: number | null;
    completedCaloriesKcal: number;
    workoutsPlanned: number;
    workoutsCompleted: number;
    workoutsSkipped: number;
    workoutsMissed: number;
  };
  byDiscipline: RangeSummaryRow[];
  caloriesByDay: Array<{
    dayKey: string;
    completedCaloriesKcal: number;
    plannedCaloriesKcal: number | null;
  }>;
  meta: {
    timeZone: string;
    itemCount: number;
    plannedItemCount: number;
    completedItemCount: number;
    skippedItemCount: number;
  };
};

function safeNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function normalizeDiscipline(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const upper = raw.toUpperCase();
  if (!upper) return 'OTHER';
  return upper;
}

function getPlannedMinutes(item: RangeSummaryItem): number | null {
  const planned = safeNumber(item.plannedDurationMinutes);
  if (planned && planned > 0) return planned;
  return null;
}

function getPlannedDistanceKm(item: RangeSummaryItem): number | null {
  const planned = safeNumber(item.plannedDistanceKm);
  if (planned && planned > 0) return planned;
  return null;
}

function getPlannedCaloriesKcal(item: RangeSummaryItem): number | null {
  const planned = safeNumber(item.plannedCaloriesKcal);
  if (planned && planned > 0) return planned;
  return null;
}

function getDayKeysInclusive(fromDayKey: string, toDayKey: string): string[] {
  const days = [fromDayKey];
  let cursor = fromDayKey;
  while (cursor < toDayKey) {
    cursor = addDaysToDayKey(cursor, 1);
    days.push(cursor);
    if (days.length > 366) break;
  }
  return days;
}

export function getAthleteRangeSummary(params: {
  items: RangeSummaryItem[];
  timeZone: string;
  fromDayKey: string;
  toDayKey: string;
  todayDayKey: string;
  filter?: (item: RangeSummaryItem) => boolean;
}): RangeSummary {
  const { items, timeZone, fromDayKey, toDayKey, todayDayKey, filter } = params;

  const map = new Map<string, RangeSummaryRow>();
  let plannedTotalMinutes = 0;
  let completedTotalMinutes = 0;
  let plannedTotalDistance = 0;
  let completedTotalDistance = 0;
  let plannedCaloriesTotal = 0;
  let plannedCaloriesAvailable = false;
  let completedCaloriesTotal = 0;

  let workoutsPlanned = 0;
  let workoutsCompleted = 0;
  let workoutsSkipped = 0;
  let workoutsMissed = 0;

  let plannedItemCount = 0;
  let completedItemCount = 0;
  let skippedItemCount = 0;

  const caloriesByDay = new Map<string, { completed: number; planned: number | null }>();

  for (const item of items) {
    if (filter && !filter(item)) continue;

    const localDayKey = getLocalDayKey(item.date, timeZone);
    if (localDayKey < fromDayKey || localDayKey > toDayKey) continue;

    const status = String(item.status ?? '').toUpperCase();
    const plannedMinutes = Math.max(0, getPlannedMinutes(item) ?? 0);
    const plannedDistanceKm = Math.max(0, getPlannedDistanceKm(item) ?? 0);
    const plannedCalories = getPlannedCaloriesKcal(item);
    const completedMinutes = Math.max(0, getCompletionMinutes(item) ?? 0);
    const completedDistanceKm = Math.max(0, getCompletionDistanceKm(item) ?? 0);
    const completedCalories = Math.max(0, getCompletionCaloriesKcal(item) ?? 0);

    const isPlanned = plannedMinutes > 0 || plannedDistanceKm > 0 || plannedCalories != null || status === 'PLANNED';
    const isCompleted = isCompletedCalendarItem(item);
    const isSkipped = status === 'SKIPPED';

    if (isPlanned) {
      workoutsPlanned += 1;
      plannedItemCount += 1;
    }
    if (isCompleted) {
      workoutsCompleted += 1;
      completedItemCount += 1;
    }
    if (isSkipped) {
      workoutsSkipped += 1;
      skippedItemCount += 1;
    }

    if (isPlanned && status === 'PLANNED' && localDayKey < todayDayKey) {
      workoutsMissed += 1;
    }

    if (plannedMinutes > 0) plannedTotalMinutes += plannedMinutes;
    if (plannedDistanceKm > 0) plannedTotalDistance += plannedDistanceKm;
    if (plannedCalories != null) {
      plannedCaloriesTotal += plannedCalories;
      plannedCaloriesAvailable = true;
    }

    if (completedMinutes > 0) completedTotalMinutes += completedMinutes;
    if (completedDistanceKm > 0) completedTotalDistance += completedDistanceKm;
    if (completedCalories > 0) completedCaloriesTotal += completedCalories;

    if (completedCalories > 0 || plannedCalories != null) {
      const existing = caloriesByDay.get(localDayKey) ?? { completed: 0, planned: null };
      existing.completed += completedCalories;
      if (plannedCalories != null) {
        existing.planned = (existing.planned ?? 0) + plannedCalories;
      }
      caloriesByDay.set(localDayKey, existing);
    }

    if (plannedMinutes <= 0 && completedMinutes <= 0 && plannedDistanceKm <= 0 && completedDistanceKm <= 0 && completedCalories <= 0) {
      continue;
    }

    const discipline = normalizeDiscipline(item.discipline);
    const existing = map.get(discipline) ?? {
      discipline,
      plannedMinutes: 0,
      completedMinutes: 0,
      plannedDistanceKm: 0,
      completedDistanceKm: 0,
      plannedCaloriesKcal: null,
      completedCaloriesKcal: 0,
    };

    existing.plannedMinutes += plannedMinutes;
    existing.completedMinutes += completedMinutes;
    existing.plannedDistanceKm += plannedDistanceKm;
    existing.completedDistanceKm += completedDistanceKm;
    if (plannedCalories != null) {
      existing.plannedCaloriesKcal = (existing.plannedCaloriesKcal ?? 0) + plannedCalories;
    }
    existing.completedCaloriesKcal += completedCalories;

    map.set(discipline, existing);
  }

  const byDiscipline = Array.from(map.values()).sort((a, b) => {
    const aMax = Math.max(a.plannedMinutes, a.completedMinutes);
    const bMax = Math.max(b.plannedMinutes, b.completedMinutes);
    if (bMax !== aMax) return bMax - aMax;
    if (b.plannedMinutes !== a.plannedMinutes) return b.plannedMinutes - a.plannedMinutes;
    return b.completedMinutes - a.completedMinutes;
  });

  const dayKeys = getDayKeysInclusive(fromDayKey, toDayKey);
  const caloriesSeries = dayKeys.map((dayKey) => {
    const entry = caloriesByDay.get(dayKey);
    return {
      dayKey,
      completedCaloriesKcal: Math.max(0, entry?.completed ?? 0),
      plannedCaloriesKcal: entry?.planned ?? null,
    };
  });

  return {
    fromDayKey,
    toDayKey,
    totals: {
      plannedMinutes: plannedTotalMinutes,
      completedMinutes: completedTotalMinutes,
      plannedDistanceKm: plannedTotalDistance,
      completedDistanceKm: completedTotalDistance,
      plannedCaloriesKcal: plannedCaloriesAvailable ? plannedCaloriesTotal : null,
      completedCaloriesKcal: completedCaloriesTotal,
      workoutsPlanned,
      workoutsCompleted,
      workoutsSkipped,
      workoutsMissed,
    },
    byDiscipline,
    caloriesByDay: caloriesSeries,
    meta: {
      timeZone,
      itemCount: items.length,
      plannedItemCount,
      completedItemCount,
      skippedItemCount,
    },
  };
}
