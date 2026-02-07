import { describe, expect, it } from 'vitest';

import { getWeeklyPlannedCompletedSummary } from '@/lib/calendar/weekly-summary';

const baseItem = {
  date: '2026-02-03',
  discipline: 'RUN',
  status: 'PLANNED',
  plannedDurationMinutes: 60,
  latestCompletedActivity: null as any,
};

describe('getWeeklyPlannedCompletedSummary', () => {
  it('summarizes planned and completed totals', () => {
    const summary = getWeeklyPlannedCompletedSummary({
      items: [
        {
          ...baseItem,
          status: 'PLANNED',
          plannedDurationMinutes: 45,
        },
        {
          ...baseItem,
          date: '2026-02-04',
          status: 'COMPLETED_MANUAL',
          plannedDurationMinutes: 50,
          latestCompletedActivity: {
            durationMinutes: 40,
          },
        },
      ],
      timeZone: 'Australia/Brisbane',
      fromDayKey: '2026-02-02',
      toDayKey: '2026-02-08',
    });

    expect(summary.plannedTotalMinutes).toBe(95);
    expect(summary.completedTotalMinutes).toBe(40);
    expect(summary.byDiscipline[0]?.discipline).toBe('RUN');
  });

  it('handles planned=0 with completed sessions', () => {
    const summary = getWeeklyPlannedCompletedSummary({
      items: [
        {
          ...baseItem,
          status: 'COMPLETED_SYNCED',
          plannedDurationMinutes: null,
          latestCompletedActivity: {
            durationMinutes: 55,
          },
        },
      ],
      timeZone: 'Australia/Brisbane',
      fromDayKey: '2026-02-02',
      toDayKey: '2026-02-08',
    });

    expect(summary.plannedTotalMinutes).toBe(0);
    expect(summary.completedTotalMinutes).toBe(55);
  });

  it('falls back to planned minutes for completed items when completion missing', () => {
    const summary = getWeeklyPlannedCompletedSummary({
      items: [
        {
          ...baseItem,
          status: 'COMPLETED_MANUAL',
          plannedDurationMinutes: 35,
          latestCompletedActivity: {
            durationMinutes: null,
          },
        },
      ],
      timeZone: 'Australia/Brisbane',
      fromDayKey: '2026-02-02',
      toDayKey: '2026-02-08',
    });

    expect(summary.completedTotalMinutes).toBe(35);
  });
});
