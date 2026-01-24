export type WeeklyAchievedSummaryDisciplineKey = 'RUN' | 'BIKE' | 'SWIM' | 'OTHER';

export type WeeklyAchievedSummary = {
  completedCount: number;
  skippedCount: number;
  totalTimeSec: number;
  totalDistanceMeters: number;
  perDiscipline: Record<WeeklyAchievedSummaryDisciplineKey, { timeSec: number; distanceMeters: number }>;
};

export type CalendarItemForWeeklySummary = {
  discipline?: string | null;
  status?: string | null;
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
  distanceMeters?: number | null;
  // Some items may include structure data; we can extract fallback duration from it when plannedDurationMinutes is absent.
  workoutStructure?: unknown;
};

const INCLUDED_COMPLETED_STATUSES = new Set(['COMPLETED_MANUAL', 'COMPLETED_SYNCED']);
const INCLUDED_SKIPPED_STATUSES = new Set(['SKIPPED']);

export function isWeeklySummaryEligible(item: CalendarItemForWeeklySummary): boolean {
  const status = (item.status ?? '').toUpperCase();
  return INCLUDED_COMPLETED_STATUSES.has(status) || INCLUDED_SKIPPED_STATUSES.has(status);
}

function isWeeklySummaryCompleted(item: CalendarItemForWeeklySummary): boolean {
  const status = (item.status ?? '').toUpperCase();
  return INCLUDED_COMPLETED_STATUSES.has(status);
}

function disciplineBucket(raw: string | null | undefined): WeeklyAchievedSummaryDisciplineKey {
  const d = (raw ?? 'OTHER').trim().toUpperCase();
  if (d === 'RUN') return 'RUN';
  if (d === 'BIKE') return 'BIKE';
  if (d === 'SWIM') return 'SWIM';
  return 'OTHER';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function sumStructureDurationSec(structure: unknown): number | null {
  if (!structure) return null;

  const segments: Array<Record<string, unknown>> = [];

  if (Array.isArray(structure)) {
    for (const v of structure) {
      if (v && typeof v === 'object') segments.push(v as Record<string, unknown>);
    }
  } else if (typeof structure === 'object') {
    const rec = structure as Record<string, unknown>;
    const maybeSegments = rec.segments ?? rec.intervals ?? rec.steps;
    if (Array.isArray(maybeSegments)) {
      for (const v of maybeSegments) {
        if (v && typeof v === 'object') segments.push(v as Record<string, unknown>);
      }
    }
  }

  if (segments.length === 0) return null;

  let totalSec = 0;
  let hadAny = false;

  for (const seg of segments) {
    const durationSec = asNumber(seg.durationSec ?? seg.durationSeconds ?? seg.duration_s);
    const durationMin = asNumber(seg.durationMinutes ?? seg.durationMin ?? seg.minutes);

    if (durationMin != null) {
      totalSec += Math.max(0, Math.round(durationMin * 60));
      hadAny = true;
      continue;
    }

    if (durationSec != null) {
      totalSec += Math.max(0, Math.round(durationSec));
      hadAny = true;
      continue;
    }
  }

  return hadAny ? totalSec : null;
}

function getCompletedDurationSec(item: CalendarItemForWeeklySummary): number {
  // Prefer explicit plannedDurationMinutes (we don't have completion duration in the calendar API payload).
  if (typeof item.plannedDurationMinutes === 'number' && Number.isFinite(item.plannedDurationMinutes)) {
    return Math.max(0, Math.round(item.plannedDurationMinutes * 60));
  }

  // Fallback: sum segment durations if structure is present.
  const fromStructure = sumStructureDurationSec(item.workoutStructure);
  if (typeof fromStructure === 'number' && Number.isFinite(fromStructure)) {
    return Math.max(0, Math.round(fromStructure));
  }

  return 0;
}

function getCompletedDistanceMeters(item: CalendarItemForWeeklySummary): number {
  // Prefer distanceMeters when present (used widely throughout the app for distance values).
  if (typeof item.distanceMeters === 'number' && Number.isFinite(item.distanceMeters) && item.distanceMeters > 0) {
    return Math.round(item.distanceMeters);
  }

  if (typeof item.plannedDistanceKm === 'number' && Number.isFinite(item.plannedDistanceKm) && item.plannedDistanceKm > 0) {
    return Math.round(item.plannedDistanceKm * 1000);
  }

  return 0;
}

export function getWeeklyAchievedSummary(
  items: CalendarItemForWeeklySummary[],
  _athleteTimezone: string
): WeeklyAchievedSummary {
  const eligibleItems = items.filter(isWeeklySummaryEligible);
  const completedItems = eligibleItems.filter(isWeeklySummaryCompleted);

  const perDiscipline: WeeklyAchievedSummary['perDiscipline'] = {
    RUN: { timeSec: 0, distanceMeters: 0 },
    BIKE: { timeSec: 0, distanceMeters: 0 },
    SWIM: { timeSec: 0, distanceMeters: 0 },
    OTHER: { timeSec: 0, distanceMeters: 0 },
  };

  let completedCount = 0;
  let skippedCount = 0;
  let totalTimeSec = 0;
  let totalDistanceMeters = 0;

  for (const item of eligibleItems) {
    const status = (item.status ?? '').toUpperCase();
    if (INCLUDED_SKIPPED_STATUSES.has(status)) skippedCount += 1;
  }

  for (const item of completedItems) {
    completedCount += 1;

    const timeSec = getCompletedDurationSec(item);
    const distM = getCompletedDistanceMeters(item);

    totalTimeSec += timeSec;
    totalDistanceMeters += distM;

    const key = disciplineBucket(item.discipline);
    perDiscipline[key].timeSec += timeSec;
    perDiscipline[key].distanceMeters += distM;
  }

  return {
    completedCount,
    skippedCount,
    totalTimeSec,
    totalDistanceMeters,
    perDiscipline,
  };
}
