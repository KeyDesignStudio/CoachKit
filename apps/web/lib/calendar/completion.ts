import { getLocalDayKey } from '@/lib/day-key';

export type CalendarCompletionItem = {
  athleteId?: string | null;
  date: string;
  discipline?: string | null;
  status?: string | null;
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
  latestCompletedActivity?: {
    confirmedAt?: string | null;
    durationMinutes?: number | null;
    distanceKm?: number | null;
    caloriesKcal?: number | null;
  } | null;
};

export type CompletionSummaryRow = {
  discipline: string;
  durationMinutes: number;
  distanceKm: number;
  caloriesKcal: number;
};

export type CompletionSummary = {
  totals: CompletionSummaryRow;
  byDiscipline: CompletionSummaryRow[];
  workoutCount: number;
};

const COMPLETED_STATUSES = new Set(['COMPLETED_MANUAL', 'COMPLETED_SYNCED']);

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

/**
 * Completion contract for athlete calendar summaries.
 *
 * - Completed sessions are calendar items with status COMPLETED_MANUAL or COMPLETED_SYNCED.
 * - COMPLETED_SYNCED_DRAFT is NOT completed (pending athlete confirmation).
 * - Metrics prefer latestCompletedActivity when available; otherwise fall back to planned
 *   duration/distance for completed items only (never for planned).
 * - Each calendar item is counted once (no double counting between planned vs completed).
 */
export function isCompletedCalendarItem(item: CalendarCompletionItem): boolean {
  const status = String(item.status ?? '').toUpperCase();
  return COMPLETED_STATUSES.has(status);
}

export function getCompletionMinutes(item: CalendarCompletionItem): number | null {
  if (!isCompletedCalendarItem(item)) return null;
  const completion = item.latestCompletedActivity ?? null;
  const completionMinutes = safeNumber(completion?.durationMinutes);
  if (completionMinutes && completionMinutes > 0) return completionMinutes;
  const planned = safeNumber(item.plannedDurationMinutes);
  if (planned && planned > 0) return planned;
  return null;
}

export function getCompletionDistanceKm(item: CalendarCompletionItem): number | null {
  if (!isCompletedCalendarItem(item)) return null;
  const completion = item.latestCompletedActivity ?? null;
  const completionDistance = safeNumber(completion?.distanceKm);
  if (completionDistance && completionDistance > 0) return completionDistance;
  const planned = safeNumber(item.plannedDistanceKm);
  if (planned && planned > 0) return planned;
  return null;
}

export function getCompletionCaloriesKcal(item: CalendarCompletionItem): number | null {
  if (!isCompletedCalendarItem(item)) return null;
  const completion = item.latestCompletedActivity ?? null;
  const calories = safeNumber(completion?.caloriesKcal);
  if (calories && calories > 0) return calories;
  return null;
}

export function getRangeCompletionSummary(params: {
  items: CalendarCompletionItem[];
  timeZone: string;
  fromDayKey: string;
  toDayKey: string;
  filter?: (item: CalendarCompletionItem) => boolean;
}): CompletionSummary {
  const { items, timeZone, fromDayKey, toDayKey, filter } = params;

  const map = new Map<string, CompletionSummaryRow>();
  let totalDuration = 0;
  let totalDistance = 0;
  let totalCalories = 0;
  let workoutCount = 0;

  for (const item of items) {
    if (filter && !filter(item)) continue;
    if (!isCompletedCalendarItem(item)) continue;

    const localDayKey = getLocalDayKey(item.date, timeZone);
    if (localDayKey < fromDayKey || localDayKey > toDayKey) continue;

    workoutCount += 1;

    const discipline = normalizeDiscipline(item.discipline);
    const durationMinutes = Math.max(0, getCompletionMinutes(item) ?? 0);
    const distanceKm = Math.max(0, getCompletionDistanceKm(item) ?? 0);
    const caloriesKcal = Math.max(0, getCompletionCaloriesKcal(item) ?? 0);

    if (durationMinutes <= 0 && distanceKm <= 0 && caloriesKcal <= 0) continue;

    totalDuration += durationMinutes;
    totalDistance += distanceKm;
    totalCalories += caloriesKcal;

    const existing = map.get(discipline) ?? {
      discipline,
      durationMinutes: 0,
      distanceKm: 0,
      caloriesKcal: 0,
    };

    existing.durationMinutes += durationMinutes;
    existing.distanceKm += distanceKm;
    existing.caloriesKcal += caloriesKcal;

    map.set(discipline, existing);
  }

  const byDiscipline = Array.from(map.values()).sort((a, b) => {
    if (b.durationMinutes !== a.durationMinutes) return b.durationMinutes - a.durationMinutes;
    if (b.distanceKm !== a.distanceKm) return b.distanceKm - a.distanceKm;
    return b.caloriesKcal - a.caloriesKcal;
  });

  return {
    totals: {
      discipline: 'TOTAL',
      durationMinutes: totalDuration,
      distanceKm: totalDistance,
      caloriesKcal: totalCalories,
    },
    byDiscipline,
    workoutCount,
  };
}
