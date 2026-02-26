import { addDaysToDayKey, getLocalDayKey } from '@/lib/day-key';
import {
  getCompletionCaloriesKcal,
  getCompletionDistanceKm,
  getCompletionMinutes,
  isCompletedCalendarItem,
} from '@/lib/calendar/completion';

export type RangeSummaryItem = {
  id?: string;
  date: string;
  discipline?: string | null;
  status?: string | null;
  title?: string | null;
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
  plannedCaloriesKcal?: number | null;
  latestCompletedActivity?: {
    confirmedAt?: string | null;
    durationMinutes?: number | null;
    distanceKm?: number | null;
    caloriesKcal?: number | null;
    kilojoules?: number | null;
  } | null;
};

export type RangeSummaryRow = {
  discipline: string;
  plannedWorkouts: number;
  completedWorkouts: number;
  plannedMinutes: number;
  completedMinutes: number;
  plannedDistanceKm: number;
  completedDistanceKm: number;
  plannedCaloriesKcal: number | null;
  completedCaloriesKcal: number;
};

export type RangeSummarySession = {
  id?: string;
  title?: string | null;
  discipline: string;
  caloriesKcal: number;
  caloriesEstimated?: boolean;
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
    completedCaloriesMethod: 'actual' | 'estimated' | 'mixed';
    completedCaloriesEstimatedCount: number;
    workoutsPlanned: number;
    workoutsCompleted: number;
    workoutsSkipped: number;
    workoutsMissed: number;
  };
  byDiscipline: RangeSummaryRow[];
  caloriesByDiscipline: Array<{
    discipline: string;
    completedCaloriesKcal: number;
  }>;
  caloriesByDay: Array<{
    dayKey: string;
    completedCaloriesKcal: number;
    sessions: RangeSummarySession[];
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
  weightKg?: number | null;
  filter?: (item: RangeSummaryItem) => boolean;
}): RangeSummary {
  const { items, timeZone, fromDayKey, toDayKey, todayDayKey, weightKg, filter } = params;

  const map = new Map<string, RangeSummaryRow>();
  let plannedTotalMinutes = 0;
  let completedTotalMinutes = 0;
  let plannedTotalDistance = 0;
  let completedTotalDistance = 0;
  let plannedCaloriesTotal = 0;
  let plannedCaloriesAvailable = false;
  let completedCaloriesTotal = 0;
  let completedCaloriesEstimatedCount = 0;
  let completedCaloriesActualCount = 0;

  let workoutsPlanned = 0;
  let workoutsCompleted = 0;
  let workoutsSkipped = 0;
  let workoutsMissed = 0;

  let plannedItemCount = 0;
  let completedItemCount = 0;
  let skippedItemCount = 0;

  const caloriesByDay = new Map<string, { completed: number; sessions: RangeSummarySession[] }>();

  function estimateCalories(params: {
    discipline: string;
    distanceKm: number;
    durationMinutes: number;
  }): number | null {
    const weight = typeof weightKg === 'number' && Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 75;
    const discipline = normalizeDiscipline(params.discipline);
    const distanceKm = Math.max(0, params.distanceKm);
    const durationMinutes = Math.max(0, params.durationMinutes);

    if (distanceKm > 0) {
      if (discipline === 'RUN') return distanceKm * weight * 1.0;
      if (discipline === 'BIKE') return distanceKm * weight * 0.3;
    }

    if (durationMinutes > 0) {
      const basePerMinute =
        discipline === 'RUN'
          ? 11
          : discipline === 'BIKE'
            ? 8
            : discipline === 'SWIM'
              ? 10
              : 7;
      const weightFactor = weight / 75;
      return durationMinutes * basePerMinute * weightFactor;
    }

    return null;
  }

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
    const directCalories = getCompletionCaloriesKcal(item);
    const directKilojoules = safeNumber(item.latestCompletedActivity?.kilojoules);
    const convertedCalories = directKilojoules ? directKilojoules / 4.184 : null;
    let completedCalories = Math.max(0, directCalories ?? convertedCalories ?? 0);
    let usedEstimate = false;

    if (completedCalories <= 0 && isCompletedCalendarItem(item)) {
      const estimate = estimateCalories({
        discipline: item.discipline ?? 'OTHER',
        distanceKm: completedDistanceKm,
        durationMinutes: completedMinutes,
      });
      if (estimate && estimate > 0) {
        completedCalories = estimate;
        usedEstimate = true;
      }
    }

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
    if (completedCalories > 0) {
      completedCaloriesTotal += completedCalories;
      if (usedEstimate) {
        completedCaloriesEstimatedCount += 1;
      } else if (directCalories || convertedCalories) {
        completedCaloriesActualCount += 1;
      }
    }

    if (completedCalories > 0 && isCompleted) {
      const existing = caloriesByDay.get(localDayKey) ?? { completed: 0, sessions: [] };
      existing.completed += completedCalories;
      existing.sessions.push({
        id: item.id,
        title: item.title ?? null,
        discipline: normalizeDiscipline(item.discipline),
        caloriesKcal: completedCalories,
        caloriesEstimated: usedEstimate,
      });
      caloriesByDay.set(localDayKey, existing);
    }

    if (
      plannedMinutes <= 0 &&
      completedMinutes <= 0 &&
      plannedDistanceKm <= 0 &&
      completedDistanceKm <= 0 &&
      completedCalories <= 0 &&
      !isPlanned &&
      !isCompleted
    ) {
      continue;
    }

    const discipline = normalizeDiscipline(item.discipline);
    const existing = map.get(discipline) ?? {
      discipline,
      plannedWorkouts: 0,
      completedWorkouts: 0,
      plannedMinutes: 0,
      completedMinutes: 0,
      plannedDistanceKm: 0,
      completedDistanceKm: 0,
      plannedCaloriesKcal: null,
      completedCaloriesKcal: 0,
    };

    if (isPlanned) existing.plannedWorkouts += 1;
    if (isCompleted) existing.completedWorkouts += 1;
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
    const sessions = entry?.sessions ? [...entry.sessions] : [];
    sessions.sort((a, b) => b.caloriesKcal - a.caloriesKcal);
    return {
      dayKey,
      completedCaloriesKcal: Math.max(0, entry?.completed ?? 0),
      sessions,
    };
  });

  const caloriesByDiscipline = Array.from(map.values())
    .map((row) => ({
      discipline: row.discipline,
      completedCaloriesKcal: row.completedCaloriesKcal,
    }))
    .filter((row) => row.completedCaloriesKcal > 0)
    .sort((a, b) => b.completedCaloriesKcal - a.completedCaloriesKcal);

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
      completedCaloriesMethod:
        completedCaloriesEstimatedCount > 0 && completedCaloriesActualCount > 0
          ? 'mixed'
          : completedCaloriesEstimatedCount > 0
            ? 'estimated'
            : 'actual',
      completedCaloriesEstimatedCount,
      workoutsPlanned,
      workoutsCompleted,
      workoutsSkipped,
      workoutsMissed,
    },
    byDiscipline,
    caloriesByDiscipline,
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
