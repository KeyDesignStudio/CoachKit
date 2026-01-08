import { ApiError } from '@/lib/errors';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateOnly(value: string, fieldName = 'date'): Date {
  if (!ISO_DATE_REGEX.test(value)) {
    throw new ApiError(400, 'INVALID_DATE_FORMAT', `${fieldName} must be in YYYY-MM-DD format.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'INVALID_DATE_VALUE', `${fieldName} must be a valid date.`);
  }

  return date;
}

export function assertValidDateRange(from: Date, to: Date) {
  if (from > to) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', '`from` must be before or equal to `to`.');
  }
}

export function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && ISO_DATE_REGEX.test(value);
}

export function combineDateWithLocalTime(date: Date, time: string | null | undefined): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);

  if (!time) {
    return result;
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);

  if (!match) {
    throw new ApiError(400, 'INVALID_TIME_FORMAT', 'Time must be HH:MM (24h).');
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  result.setUTCHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Get the Monday (start of week) for a given date
 */
export function startOfWeek(date: Date = new Date()): Date {
  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = normalized.getUTCDay();
  const diffToMonday = (weekday + 6) % 7;
  normalized.setUTCDate(normalized.getUTCDate() - diffToMonday);
  return normalized;
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
