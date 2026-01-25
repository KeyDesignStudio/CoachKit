import { getLocalDayKey } from '@/lib/day-key';

export type DisciplineKey =
  | 'RUN'
  | 'BIKE'
  | 'SWIM'
  | 'BRICK'
  | 'STRENGTH'
  | 'REST'
  | 'OTHER'
  | string;

type ItemLike = {
  date: string;
  discipline?: string | null;
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
  latestCompletedActivity?: {
    confirmedAt?: string | null;
    durationMinutes?: number | null;
    distanceKm?: number | null;
    caloriesKcal?: number | null;
  } | null;
};

export type DisciplineAggregate = {
  discipline: DisciplineKey;
  durationMinutes: number;
  distanceKm: number;
  caloriesKcal: number;
};

export type RangeDisciplineSummary = {
  totals: DisciplineAggregate;
  byDiscipline: DisciplineAggregate[];
};

function safeNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function normalizeDiscipline(value: unknown): DisciplineKey {
  const raw = typeof value === 'string' ? value.trim() : '';
  const upper = raw.toUpperCase();
  if (!upper) return 'OTHER';
  return upper;
}

export function formatMinutesCompact(totalMinutes: number): string {
  const minutes = Math.round(totalMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

export function formatKmCompact(km: number): string {
  if (!Number.isFinite(km) || km <= 0) return '0km';
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${km.toFixed(0)}km`;
}

export function formatKcal(kcal: number): string {
  if (!Number.isFinite(kcal) || kcal <= 0) return '0 kcal';
  return `${Math.round(kcal)} kcal`;
}

export function getRangeDisciplineSummary(params: {
  items: ItemLike[];
  timeZone: string;
  fromDayKey: string;
  toDayKey: string;
  includePlannedFallback?: boolean;
  filter?: (item: ItemLike) => boolean;
}): RangeDisciplineSummary {
  const { items, timeZone, fromDayKey, toDayKey, includePlannedFallback = true, filter } = params;

  const map = new Map<string, DisciplineAggregate>();
  let totalDuration = 0;
  let totalDistance = 0;
  let totalCalories = 0;

  for (const item of items) {
    if (filter && !filter(item)) continue;

    const localDayKey = getLocalDayKey(item.date, timeZone);
    if (localDayKey < fromDayKey || localDayKey > toDayKey) continue;

    const discipline = normalizeDiscipline(item.discipline);

    const completion = item.latestCompletedActivity ?? null;
    const durationFromCompletion = safeNumber(completion?.durationMinutes);
    const distanceFromCompletion = safeNumber(completion?.distanceKm);
    const caloriesFromCompletion = completion?.confirmedAt ? safeNumber(completion?.caloriesKcal) : null;

    const durationFromPlan = includePlannedFallback ? safeNumber(item.plannedDurationMinutes) : null;
    const distanceFromPlan = includePlannedFallback ? safeNumber(item.plannedDistanceKm) : null;

    const durationMinutes = Math.max(0, durationFromCompletion ?? durationFromPlan ?? 0);
    const distanceKm = Math.max(0, distanceFromCompletion ?? distanceFromPlan ?? 0);
    const caloriesKcal = Math.max(0, caloriesFromCompletion ?? 0);

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
  };
}
