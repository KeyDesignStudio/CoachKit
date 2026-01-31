import { addDaysToDayKey, getLocalDayKey } from '@/lib/day-key';
import { combineDateWithLocalTime } from '@/lib/date';
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

export function getStoredStartUtcFromCalendarItem(item: {
  date: Date;
  plannedStartTimeLocal: string | null;
}): Date {
  return combineDateWithLocalTime(item.date, item.plannedStartTimeLocal);
}

export function getLocalDayKeyForCalendarItem(item: { date: Date; plannedStartTimeLocal: string | null }, timeZone: string): string {
  return getLocalDayKey(getStoredStartUtcFromCalendarItem(item), timeZone);
}

export function isStoredStartInUtcRange(storedStartUtc: Date, range: UtcRange): boolean {
  return storedStartUtc.getTime() >= range.startUtc.getTime() && storedStartUtc.getTime() < range.endUtc.getTime();
}
