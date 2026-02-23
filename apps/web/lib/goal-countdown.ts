import { formatUtcDayKey, getLocalDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';

const DAILY_COUNTDOWN_THRESHOLD_DAYS = 14;

export type GoalCountdownMode = 'none' | 'weekly' | 'daily' | 'race-day' | 'past';

export type GoalCountdown = {
  mode: GoalCountdownMode;
  eventName: string | null;
  eventDate: string | null;
  daysRemaining: number | null;
  weeksRemaining: number | null;
  weeksTotal: number | null;
  weeksElapsed: number | null;
  progressPct: number | null;
  label: string;
  shortLabel: string;
  isWithinFortnight: boolean;
  isRaceDay: boolean;
  isPast: boolean;
};

function pluralize(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function normalizeEventDateDayKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : formatUtcDayKey(value);

  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return getLocalDayKey(parsed, 'UTC');
}

function diffDays(fromDayKey: string, toDayKey: string): number {
  const from = parseDayKeyToUtcDate(fromDayKey);
  const to = parseDayKeyToUtcDate(toDayKey);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

export function getGoalCountdown(params: {
  eventName?: string | null;
  eventDate?: Date | string | null;
  blockStartDate?: Date | string | null;
  timelineWeeks?: number | null;
  todayDayKey: string;
}): GoalCountdown {
  const eventName = String(params.eventName ?? '').trim() || null;
  const eventDate = normalizeEventDateDayKey(params.eventDate ?? null);
  const blockStartDate = normalizeEventDateDayKey(params.blockStartDate ?? null);
  const derivedWeeksTotal =
    blockStartDate && eventDate
      ? (() => {
          const days = diffDays(blockStartDate, eventDate);
          if (!Number.isFinite(days) || days <= 0) return null;
          return Math.max(1, Math.min(52, Math.ceil(days / 7)));
        })()
      : null;
  const weeksTotal =
    typeof params.timelineWeeks === 'number' && Number.isFinite(params.timelineWeeks) && params.timelineWeeks > 0
      ? Math.max(1, Math.min(52, Math.round(params.timelineWeeks)))
      : derivedWeeksTotal;

  if (!eventDate) {
    return {
      mode: 'none',
      eventName,
      eventDate: null,
      daysRemaining: null,
      weeksRemaining: null,
      weeksTotal,
      weeksElapsed: null,
      progressPct: null,
      label: 'Set a goal event date',
      shortLabel: 'No goal date',
      isWithinFortnight: false,
      isRaceDay: false,
      isPast: false,
    };
  }

  const daysRemaining = diffDays(params.todayDayKey, eventDate);
  const weeksRemaining = daysRemaining > 0 ? Math.ceil(daysRemaining / 7) : null;
  const startAwareProgress =
    weeksTotal != null && blockStartDate && eventDate
      ? (() => {
          const totalDays = Math.max(1, diffDays(blockStartDate, eventDate));
          const elapsedDays = Math.max(0, Math.min(totalDays, diffDays(blockStartDate, params.todayDayKey)));
          const weeksElapsed = Math.max(0, Math.min(weeksTotal, Math.floor(elapsedDays / 7)));
          const progressPct = Math.max(0, Math.min(100, Math.round((elapsedDays / totalDays) * 100)));
          return { weeksElapsed, progressPct };
        })()
      : null;
  const weeksElapsed =
    startAwareProgress?.weeksElapsed ?? (weeksTotal != null ? Math.max(0, weeksTotal - Math.max(0, weeksRemaining ?? 0)) : null);
  const progressPct =
    startAwareProgress?.progressPct ??
    (weeksTotal != null ? Math.max(0, Math.min(100, Math.round(((weeksElapsed ?? 0) / weeksTotal) * 100))) : null);

  if (daysRemaining === 0) {
    return {
      mode: 'race-day',
      eventName,
      eventDate,
      daysRemaining,
      weeksRemaining: 0,
      weeksTotal,
      weeksElapsed: weeksTotal ?? 0,
      progressPct: weeksTotal ? 100 : progressPct,
      label: 'Race day',
      shortLabel: 'Race day',
      isWithinFortnight: true,
      isRaceDay: true,
      isPast: false,
    };
  }

  if (daysRemaining < 0) {
    const ago = Math.abs(daysRemaining);
    return {
      mode: 'past',
      eventName,
      eventDate,
      daysRemaining,
      weeksRemaining: null,
      weeksTotal,
      weeksElapsed: weeksTotal,
      progressPct: weeksTotal ? 100 : progressPct,
      label: `${pluralize(ago, 'day')} since goal`,
      shortLabel: `${ago}d ago`,
      isWithinFortnight: false,
      isRaceDay: false,
      isPast: true,
    };
  }

  if (daysRemaining <= DAILY_COUNTDOWN_THRESHOLD_DAYS) {
    return {
      mode: 'daily',
      eventName,
      eventDate,
      daysRemaining,
      weeksRemaining,
      weeksTotal,
      weeksElapsed,
      progressPct,
      label: `${pluralize(daysRemaining, 'day')} to goal`,
      shortLabel: `${daysRemaining}d`,
      isWithinFortnight: true,
      isRaceDay: false,
      isPast: false,
    };
  }

  const safeWeeksRemaining = Math.max(1, Math.ceil(daysRemaining / 7));
  return {
    mode: 'weekly',
    eventName,
    eventDate,
    daysRemaining,
    weeksRemaining: safeWeeksRemaining,
    weeksTotal,
    weeksElapsed,
    progressPct,
    label: `${pluralize(safeWeeksRemaining, 'week')} to goal`,
    shortLabel: `${safeWeeksRemaining}w`,
    isWithinFortnight: false,
    isRaceDay: false,
    isPast: false,
  };
}
