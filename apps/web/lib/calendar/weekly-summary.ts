import { getLocalDayKey } from '@/lib/day-key';
import { getCompletionMinutes, isCompletedCalendarItem } from '@/lib/calendar/completion';

export type WeeklySummaryItem = {
  date: string;
  discipline?: string | null;
  status?: string | null;
  plannedDurationMinutes?: number | null;
  latestCompletedActivity?: {
    durationMinutes?: number | null;
  } | null;
};

export type WeeklyDisciplineSummary = {
  discipline: string;
  plannedMinutes: number;
  completedMinutes: number;
};

export type WeeklyPlannedCompletedSummary = {
  fromDayKey: string;
  toDayKey: string;
  plannedTotalMinutes: number;
  completedTotalMinutes: number;
  byDiscipline: WeeklyDisciplineSummary[];
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

function getPlannedMinutes(item: WeeklySummaryItem): number | null {
  const planned = safeNumber(item.plannedDurationMinutes);
  if (planned && planned > 0) return planned;
  return null;
}

export function getWeeklyPlannedCompletedSummary(params: {
  items: WeeklySummaryItem[];
  timeZone: string;
  fromDayKey: string;
  toDayKey: string;
}): WeeklyPlannedCompletedSummary {
  const { items, timeZone, fromDayKey, toDayKey } = params;

  const map = new Map<string, WeeklyDisciplineSummary>();
  let plannedTotalMinutes = 0;
  let completedTotalMinutes = 0;

  for (const item of items) {
    const localDayKey = getLocalDayKey(item.date, timeZone);
    if (localDayKey < fromDayKey || localDayKey > toDayKey) continue;

    const discipline = normalizeDiscipline(item.discipline);
    const plannedMinutes = Math.max(0, getPlannedMinutes(item) ?? 0);
    const completedMinutes = Math.max(0, getCompletionMinutes(item) ?? 0);

    if (plannedMinutes <= 0 && completedMinutes <= 0 && !isCompletedCalendarItem(item)) {
      continue;
    }

    plannedTotalMinutes += plannedMinutes;
    completedTotalMinutes += completedMinutes;

    const existing = map.get(discipline) ?? {
      discipline,
      plannedMinutes: 0,
      completedMinutes: 0,
    };

    existing.plannedMinutes += plannedMinutes;
    existing.completedMinutes += completedMinutes;
    map.set(discipline, existing);
  }

  const byDiscipline = Array.from(map.values()).sort((a, b) => {
    const aMax = Math.max(a.plannedMinutes, a.completedMinutes);
    const bMax = Math.max(b.plannedMinutes, b.completedMinutes);
    if (bMax !== aMax) return bMax - aMax;
    if (b.plannedMinutes !== a.plannedMinutes) return b.plannedMinutes - a.plannedMinutes;
    return b.completedMinutes - a.completedMinutes;
  });

  return {
    fromDayKey,
    toDayKey,
    plannedTotalMinutes,
    completedTotalMinutes,
    byDiscipline,
  };
}
