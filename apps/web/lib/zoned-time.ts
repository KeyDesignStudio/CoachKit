import { ApiError } from '@/lib/errors';
import { getLocalDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';

function parseTimeToParts(time: string): { hours: number; minutes: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    throw new ApiError(400, 'INVALID_TIME_FORMAT', 'Time must be HH:MM (24h).');
  }

  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function getZonedParts(dateUtc: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(dateUtc);

  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
  };
}

/**
 * Convert a local time (dayKey + HH:MM) in a specific IANA timezone into a UTC Date.
 *
 * This is implemented without external deps (date-fns-tz/luxon) using an iterative
 * correction approach based on Intl.DateTimeFormat.
 */
export function zonedDayTimeToUtc(dayKey: string, time: string, timeZone: string): Date {
  const { hours, minutes } = parseTimeToParts(time);

  const [yearStr, monthStr, dayStr] = dayKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new ApiError(400, 'INVALID_DATE_VALUE', 'Invalid day key.');
  }

  const desiredUtcMs = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);

  // Initial guess: treat local components as if they were UTC.
  let guess = new Date(desiredUtcMs);

  // Correct guess up to 3 times to account for DST transitions.
  for (let i = 0; i < 3; i += 1) {
    const zoned = getZonedParts(guess, timeZone);
    const asIfUtcMs = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, 0, 0);
    const diffMs = desiredUtcMs - asIfUtcMs;
    if (diffMs === 0) return guess;
    guess = new Date(guess.getTime() + diffMs);
  }

  return guess;
}

/**
 * Given a date-only field stored at UTC midnight, get the local day key in the
 * provided timezone.
 */
export function calendarItemDateToDayKey(dateOnlyUtc: Date, timeZone: string): string {
  return getLocalDayKey(dateOnlyUtc, timeZone);
}

export function dayKeyToUtcMidnight(dayKey: string): Date {
  return parseDayKeyToUtcDate(dayKey);
}
