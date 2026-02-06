import { describe, expect, it } from 'vitest';

import {
  getCompletionCaloriesKcal,
  getCompletionDistanceKm,
  getCompletionMinutes,
  getRangeCompletionSummary,
  isCompletedCalendarItem,
} from '@/lib/calendar/completion';

const baseItem = {
  date: '2026-02-05',
  discipline: 'RUN',
  status: 'PLANNED',
  plannedDurationMinutes: 50,
  plannedDistanceKm: 8,
  latestCompletedActivity: null as any,
};

describe('calendar completion contract', () => {
  it('treats COMPLETED_MANUAL as completed even without confirmedAt', () => {
    const item = {
      ...baseItem,
      status: 'COMPLETED_MANUAL',
      latestCompletedActivity: {
        durationMinutes: 42,
        distanceKm: 6.2,
        caloriesKcal: null,
        confirmedAt: null,
      },
    };

    expect(isCompletedCalendarItem(item)).toBe(true);
    expect(getCompletionMinutes(item)).toBe(42);
    expect(getCompletionDistanceKm(item)).toBe(6.2);
    expect(getCompletionCaloriesKcal(item)).toBeNull();
  });

  it('treats COMPLETED_SYNCED as completed even if confirmedAt missing', () => {
    const item = {
      ...baseItem,
      status: 'COMPLETED_SYNCED',
      latestCompletedActivity: {
        durationMinutes: 30,
        distanceKm: null,
        caloriesKcal: 300,
        confirmedAt: null,
      },
    };

    expect(isCompletedCalendarItem(item)).toBe(true);
    expect(getCompletionMinutes(item)).toBe(30);
    expect(getCompletionDistanceKm(item)).toBeNull();
    expect(getCompletionCaloriesKcal(item)).toBe(300);
  });

  it('does not count COMPLETED_SYNCED_DRAFT as completed', () => {
    const item = {
      ...baseItem,
      status: 'COMPLETED_SYNCED_DRAFT',
      latestCompletedActivity: {
        durationMinutes: 20,
        distanceKm: 3,
        caloriesKcal: 200,
        confirmedAt: null,
      },
    };

    expect(isCompletedCalendarItem(item)).toBe(false);
    expect(getCompletionMinutes(item)).toBeNull();
  });

  it('falls back to planned metrics when completion metrics are missing', () => {
    const item = {
      ...baseItem,
      status: 'COMPLETED_MANUAL',
      latestCompletedActivity: {
        durationMinutes: null,
        distanceKm: null,
        caloriesKcal: null,
        confirmedAt: null,
      },
    };

    expect(getCompletionMinutes(item)).toBe(50);
    expect(getCompletionDistanceKm(item)).toBe(8);
  });

  it('summarizes completed items in range without double counting', () => {
    const items = [
      {
        ...baseItem,
        status: 'COMPLETED_MANUAL',
        latestCompletedActivity: {
          durationMinutes: 40,
          distanceKm: 5,
          caloriesKcal: null,
          confirmedAt: null,
        },
      },
      {
        ...baseItem,
        status: 'PLANNED',
        date: '2026-02-06',
      },
    ];

    const summary = getRangeCompletionSummary({
      items,
      timeZone: 'Australia/Brisbane',
      fromDayKey: '2026-02-02',
      toDayKey: '2026-02-08',
    });

    expect(summary.workoutCount).toBe(1);
    expect(summary.totals.durationMinutes).toBe(40);
    expect(summary.totals.distanceKm).toBe(5);
  });

  it('supports filtering items before summarizing', () => {
    const items = [
      {
        ...baseItem,
        status: 'COMPLETED_MANUAL',
        athleteId: 'athlete-a',
        latestCompletedActivity: {
          durationMinutes: 30,
          distanceKm: 4,
          caloriesKcal: null,
          confirmedAt: null,
        },
      },
      {
        ...baseItem,
        status: 'COMPLETED_MANUAL',
        athleteId: 'athlete-b',
        date: '2026-02-06',
        latestCompletedActivity: {
          durationMinutes: 50,
          distanceKm: 8,
          caloriesKcal: null,
          confirmedAt: null,
        },
      },
    ];

    const summary = getRangeCompletionSummary({
      items: items as any,
      timeZone: 'Australia/Brisbane',
      fromDayKey: '2026-02-02',
      toDayKey: '2026-02-08',
      filter: (item: any) => item.athleteId === 'athlete-a',
    });

    expect(summary.workoutCount).toBe(1);
    expect(summary.totals.durationMinutes).toBe(30);
    expect(summary.totals.distanceKm).toBe(4);
  });
});
