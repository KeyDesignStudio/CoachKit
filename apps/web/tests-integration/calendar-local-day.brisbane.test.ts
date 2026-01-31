import { describe, expect, it } from 'vitest';

import { getLocalDayKey } from '@/lib/day-key';
import { getUtcRangeForLocalDayKeyRange, isStoredStartInUtcRange } from '@/lib/calendar-local-day';

describe('calendar local-day UTC range (Australia/Brisbane)', () => {
  it('includes a stored start at 2026-01-29T17:00Z in local day 2026-01-30', () => {
    const timeZone = 'Australia/Brisbane';

    const range = getUtcRangeForLocalDayKeyRange({
      fromDayKey: '2026-01-30',
      toDayKey: '2026-01-30',
      timeZone,
    });

    // Brisbane is UTC+10 year-round (no DST).
    expect(range.startUtc.toISOString()).toBe('2026-01-29T14:00:00.000Z');
    expect(range.endUtc.toISOString()).toBe('2026-01-30T14:00:00.000Z');

    const storedStartUtc = new Date('2026-01-29T17:00:00.000Z');

    expect(getLocalDayKey(storedStartUtc, timeZone)).toBe('2026-01-30');
    expect(isStoredStartInUtcRange(storedStartUtc, range)).toBe(true);

    // Boundary checks: inclusive start, exclusive end.
    expect(isStoredStartInUtcRange(range.startUtc, range)).toBe(true);
    expect(isStoredStartInUtcRange(range.endUtc, range)).toBe(false);
  });
});
