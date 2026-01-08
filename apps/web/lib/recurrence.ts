import { ApiError } from '@/lib/errors';
import { assertValidDateRange } from '@/lib/date';

const VALID_WEEKDAY_TOKENS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const WEEKDAY_BY_INDEX = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const VALID_WEEKDAY_SET = new Set<string>(VALID_WEEKDAY_TOKENS);

type WeeklyRecurrence = {
  byDayTokens: string[];
};

function normalizeRuleValue(value: string | undefined) {
  return value?.trim().toUpperCase() ?? '';
}

function parseRRuleComponents(rule: string) {
  return rule
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const [rawKey, rawValue] = part.split('=');
      if (!rawKey || !rawValue) {
        return acc;
      }

      acc[rawKey.trim().toUpperCase()] = rawValue.trim().toUpperCase();
      return acc;
    }, {});
}

export function parseWeeklyRecurrenceRule(rule: string): WeeklyRecurrence {
  if (!rule || typeof rule !== 'string') {
    throw new ApiError(400, 'INVALID_RECURRENCE_RULE', 'recurrenceRule is required.');
  }

  const parts = parseRRuleComponents(rule);
  const freq = normalizeRuleValue(parts.FREQ);

  if (freq !== 'WEEKLY') {
    throw new ApiError(400, 'UNSUPPORTED_RECURRENCE_RULE', 'Only weekly recurrence rules are supported.');
  }

  const byDayValue = normalizeRuleValue(parts.BYDAY);

  if (!byDayValue) {
    throw new ApiError(400, 'INVALID_RECURRENCE_RULE', 'BYDAY is required for weekly recurrence.');
  }

  const byDayTokens = Array.from(new Set(byDayValue.split(',').map((token) => token.trim()).filter(Boolean)));

  if (!byDayTokens.length) {
    throw new ApiError(400, 'INVALID_RECURRENCE_RULE', 'BYDAY must include at least one weekday token.');
  }

  const invalidTokens = byDayTokens.filter((token) => !VALID_WEEKDAY_SET.has(token));

  if (invalidTokens.length) {
    throw new ApiError(
      400,
      'INVALID_RECURRENCE_RULE',
      `BYDAY contains invalid tokens: ${invalidTokens.join(', ')}`,
    );
  }

  const intervalValue = parts.INTERVAL ? Number(parts.INTERVAL) : 1;

  if (!Number.isInteger(intervalValue) || intervalValue !== 1) {
    throw new ApiError(400, 'UNSUPPORTED_RECURRENCE_RULE', 'Only weekly rules with INTERVAL=1 are supported.');
  }

  return { byDayTokens };
}

export function expandWeeklyOccurrences(rule: string, from: Date, to: Date): Date[] {
  assertValidDateRange(from, to);

  const { byDayTokens } = parseWeeklyRecurrenceRule(rule);
  const daySet = new Set(byDayTokens);
  const start = new Date(from);
  const end = new Date(to);

  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);

  const occurrences: Date[] = [];
  const cursor = new Date(start);

  while (cursor.getTime() <= end.getTime()) {
    const weekdayToken = WEEKDAY_BY_INDEX[cursor.getUTCDay()];

    if (daySet.has(weekdayToken)) {
      occurrences.push(new Date(cursor));
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return occurrences;
}
