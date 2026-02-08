import { addDaysToDayKey, formatUtcDayKey, getLocalDayKey } from '@/lib/day-key';
import { zonedDayTimeToUtc } from '@/lib/zoned-time';

export type UtcRange = {
  startUtc: Date;
  endUtc: Date;
};

export function getUtcRangeForLocalDayKeyRange(params: {
  fromDayKey: string;
  toDayKey: string;
  timeZone: string;
}): UtcRange {
  const { fromDayKey, toDayKey, timeZone } = params;

  const startUtc = zonedDayTimeToUtc(fromDayKey, '00:00', timeZone);
  const endUtc = zonedDayTimeToUtc(addDaysToDayKey(toDayKey, 1), '00:00', timeZone);

  return { startUtc, endUtc };
}

export function resolveLocalStartUtc(params: {
  dayKey: string;
  plannedStartTimeLocal: string | null | undefined;
  timeZone: string;
}): Date {
  const time = params.plannedStartTimeLocal && params.plannedStartTimeLocal.trim()
    ? params.plannedStartTimeLocal
    : '00:00';

  return zonedDayTimeToUtc(params.dayKey, time, params.timeZone);
}

export function getStoredStartUtcFromCalendarItem(
  item: {
    date: Date;
    plannedStartTimeLocal: string | null;
  },
  timeZone: string
): Date {
  return resolveLocalStartUtc({
    dayKey: formatUtcDayKey(item.date),
    plannedStartTimeLocal: item.plannedStartTimeLocal,
    timeZone,
  });
}

export type CalendarCompletionLike = {
  source?: string | null;
  startTime: Date;
  metricsJson?: any;
  matchDayDiff?: number | null;
};

export function getEffectiveStartUtcFromCompletion(completion: CalendarCompletionLike): Date {
  const source = String(completion.source ?? '').toUpperCase();
  if (source === 'STRAVA') {
    const candidate = completion.metricsJson?.strava?.startDateUtc ?? null;
    const parsed = candidate ? new Date(candidate) : null;
    const base = parsed && !Number.isNaN(parsed.getTime()) ? parsed : completion.startTime;

    if (typeof completion.matchDayDiff === 'number' && completion.matchDayDiff !== 0) {
      return new Date(base.getTime() + completion.matchDayDiff * 24 * 60 * 60 * 1000);
    }

    return base;
  }

  return completion.startTime;
}

export function getEffectiveStartUtcForCalendarItem(params: {
  item: { date: Date; plannedStartTimeLocal: string | null };
  completion?: CalendarCompletionLike | null;
  timeZone: string;
}): Date {
  if (params.completion) {
    return getEffectiveStartUtcFromCompletion(params.completion);
  }

  return getStoredStartUtcFromCalendarItem(params.item, params.timeZone);
}

export function getLocalDayKeyForCalendarItem(
  item: { date: Date; plannedStartTimeLocal: string | null },
  timeZone: string
): string {
  return getLocalDayKey(getStoredStartUtcFromCalendarItem(item, timeZone), timeZone);
}

export function isStoredStartInUtcRange(storedStartUtc: Date, range: UtcRange): boolean {
  return storedStartUtc.getTime() >= range.startUtc.getTime() && storedStartUtc.getTime() < range.endUtc.getTime();
}
