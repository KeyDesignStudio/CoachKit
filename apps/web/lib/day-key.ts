const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export type DayKey = string & { readonly __dayKeyBrand: unique symbol };

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function isDayKey(value: string | null | undefined): value is DayKey {
  return typeof value === 'string' && ISO_DATE_REGEX.test(value);
}

/**
 * Canonical local-day key helper.
 *
 * Rules:
 * - If input is already a YYYY-MM-DD string, returns it unchanged.
 * - Otherwise interprets the input as an instant and returns the YYYY-MM-DD
 *   date key in the provided timezone (or runtime-local timezone if omitted).
 * - Never uses toISOString() or UTC-based slicing.
 */
export function getLocalDayKey(input: Date | string, timeZone?: string): string {
  if (typeof input === 'string' && isDayKey(input)) return input;

  const rawString = typeof input === 'string' ? input : null;

  const instant = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(instant.getTime())) {
    // Best-effort fallback: if a string contained a T, use its date part.
    if (rawString && rawString.includes('T')) return rawString.split('T')[0];
    return rawString ?? String(input);
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

export function toAthleteLocalDayKey(input: Date | string, timeZone: string): string {
  return getLocalDayKey(input, timeZone);
}

/**
 * Formats a Date as a YYYY-MM-DD key using UTC calendar fields.
 *
 * Use this when the Date represents a date-only value stored at UTC midnight.
 */
export function formatUtcDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function parseDayKeyToUtcDate(dayKey: string): Date {
  if (!isDayKey(dayKey)) throw new Error(`Invalid day key: ${dayKey}`);
  // Anchor at UTC midnight for stable date math.
  return new Date(`${dayKey}T00:00:00.000Z`);
}

export function addDaysToDayKey(dayKey: string, days: number): string {
  const date = parseDayKeyToUtcDate(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDayKey(date);
}

export function startOfWeekDayKey(dayKey: string): string {
  const date = parseDayKeyToUtcDate(dayKey);
  const weekday = date.getUTCDay();
  const diffToMonday = (weekday + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return formatUtcDayKey(date);
}

export function getTodayDayKey(timeZone?: string, now: Date = new Date()): string {
  return getLocalDayKey(now, timeZone);
}
