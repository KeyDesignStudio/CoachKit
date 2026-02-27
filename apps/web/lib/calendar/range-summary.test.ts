import { describe, it, expect } from 'vitest';

import { getAthleteRangeSummary } from '@/lib/calendar/range-summary';

const baseItem = {
  discipline: 'RUN',
  plannedDurationMinutes: 60,
  plannedDistanceKm: 10,
};

describe('getAthleteRangeSummary', () => {
  it('counts completed items even without confirmedAt', () => {
    const summary = getAthleteRangeSummary({
      items: [
        {
          ...baseItem,
          date: '2026-02-05',
          status: 'COMPLETED_SYNCED',
          latestCompletedActivity: {
            durationMinutes: 50,
            distanceKm: 9,
            caloriesKcal: 500,
          },
        },
      ],
      timeZone: 'UTC',
      fromDayKey: '2026-02-01',
      toDayKey: '2026-02-07',
      todayDayKey: '2026-02-07',
    });

    expect(summary.totals.workoutsCompleted).toBe(1);
    expect(summary.totals.completedMinutes).toBe(50);
    expect(summary.totals.completedDistanceKm).toBe(9);
    expect(summary.totals.completedCaloriesKcal).toBe(500);
  });

  it('tracks planned vs completed minutes independently', () => {
    const summary = getAthleteRangeSummary({
      items: [
        {
          ...baseItem,
          date: '2026-02-04',
          status: 'COMPLETED_MANUAL',
          latestCompletedActivity: {
            durationMinutes: 45,
          },
        },
      ],
      timeZone: 'UTC',
      fromDayKey: '2026-02-01',
      toDayKey: '2026-02-07',
      todayDayKey: '2026-02-07',
    });

    expect(summary.totals.plannedMinutes).toBe(60);
    expect(summary.totals.completedMinutes).toBe(45);
  });

  it('aligns discipline totals with overall totals', () => {
    const summary = getAthleteRangeSummary({
      items: [
        {
          ...baseItem,
          date: '2026-02-03',
          status: 'COMPLETED_MANUAL',
          latestCompletedActivity: {
            durationMinutes: 70,
            distanceKm: 12,
          },
        },
      ],
      timeZone: 'UTC',
      fromDayKey: '2026-02-01',
      toDayKey: '2026-02-07',
      todayDayKey: '2026-02-07',
    });

    expect(summary.byDiscipline).toHaveLength(1);
    const row = summary.byDiscipline[0];
    expect(row.plannedWorkouts).toBe(summary.totals.workoutsPlanned);
    expect(row.completedWorkouts).toBe(summary.totals.workoutsCompleted);
    expect(row.plannedMinutes).toBe(summary.totals.plannedMinutes);
    expect(row.completedMinutes).toBe(summary.totals.completedMinutes);
    expect(row.plannedDistanceKm).toBe(summary.totals.plannedDistanceKm);
    expect(row.completedDistanceKm).toBe(summary.totals.completedDistanceKm);
  });

  it('uses direct kcal when present and converts kJ', () => {
    const summary = getAthleteRangeSummary({
      items: [
        {
          ...baseItem,
          date: '2026-02-02',
          status: 'COMPLETED_SYNCED',
          latestCompletedActivity: {
            durationMinutes: 30,
            caloriesKcal: 300,
          },
        },
        {
          ...baseItem,
          date: '2026-02-03',
          status: 'COMPLETED_SYNCED',
          latestCompletedActivity: {
            durationMinutes: 20,
            kilojoules: 418.4,
          },
        },
      ],
      timeZone: 'UTC',
      fromDayKey: '2026-02-01',
      toDayKey: '2026-02-07',
      todayDayKey: '2026-02-07',
    });

    expect(summary.totals.completedCaloriesKcal).toBeCloseTo(400, 1);
    expect(summary.totals.completedCaloriesMethod).toBe('actual');
  });

  it('estimates calories when missing and marks mixed', () => {
    const summary = getAthleteRangeSummary({
      items: [
        {
          ...baseItem,
          date: '2026-02-04',
          status: 'COMPLETED_MANUAL',
          latestCompletedActivity: {
            durationMinutes: 40,
          },
        },
        {
          ...baseItem,
          date: '2026-02-05',
          status: 'COMPLETED_SYNCED',
          latestCompletedActivity: {
            durationMinutes: 30,
            caloriesKcal: 250,
          },
        },
      ],
      timeZone: 'UTC',
      fromDayKey: '2026-02-01',
      toDayKey: '2026-02-07',
      todayDayKey: '2026-02-07',
    });

    expect(summary.totals.completedCaloriesKcal).toBeGreaterThan(250);
    expect(summary.totals.completedCaloriesMethod).toBe('mixed');
    expect(summary.totals.completedCaloriesEstimatedCount).toBe(1);
  });

  it('filters by range and respects filter callback', () => {
    const summary = getAthleteRangeSummary({
      items: [
        {
          ...baseItem,
          date: '2026-02-01',
          status: 'COMPLETED_SYNCED',
          latestCompletedActivity: { durationMinutes: 30, caloriesKcal: 200 },
        },
        {
          ...baseItem,
          date: '2026-02-10',
          status: 'COMPLETED_SYNCED',
          latestCompletedActivity: { durationMinutes: 30, caloriesKcal: 200 },
        },
        {
          ...baseItem,
          date: '2026-02-03',
          status: 'COMPLETED_SYNCED',
          latestCompletedActivity: { durationMinutes: 30, caloriesKcal: 200 },
          discipline: 'BIKE',
        },
      ],
      timeZone: 'UTC',
      fromDayKey: '2026-02-01',
      toDayKey: '2026-02-07',
      todayDayKey: '2026-02-07',
      filter: (item) => item.discipline !== 'BIKE',
    });

    expect(summary.totals.completedCaloriesKcal).toBe(200);
    expect(summary.totals.completedMinutes).toBe(30);
  });

  it('aggregates completed calories by discipline and session', () => {
    const summary = getAthleteRangeSummary({
      items: [
        {
          ...baseItem,
          id: 'run-1',
          title: 'Track Session',
          date: '2026-02-06',
          status: 'COMPLETED_SYNCED',
          discipline: 'RUN',
          latestCompletedActivity: { durationMinutes: 40, caloriesKcal: 480 },
        },
        {
          ...baseItem,
          id: 'bike-1',
          title: 'Trainer Ride',
          date: '2026-02-06',
          status: 'COMPLETED_SYNCED',
          discipline: 'BIKE',
          latestCompletedActivity: { durationMinutes: 60, caloriesKcal: 600 },
        },
      ],
      timeZone: 'UTC',
      fromDayKey: '2026-02-01',
      toDayKey: '2026-02-07',
      todayDayKey: '2026-02-07',
    });

    const runRow = summary.caloriesByDiscipline.find((row) => row.discipline === 'RUN');
    const bikeRow = summary.caloriesByDiscipline.find((row) => row.discipline === 'BIKE');
    expect(runRow?.completedCaloriesKcal).toBe(480);
    expect(bikeRow?.completedCaloriesKcal).toBe(600);

    const day = summary.caloriesByDay.find((row) => row.dayKey === '2026-02-06');
    expect(day?.completedCaloriesKcal).toBe(1080);
    expect(day?.sessions).toHaveLength(2);
    expect(day?.sessions?.map((session) => session.title)).toContain('Track Session');
  });

  it('aggregates daily calories by athlete-local day keys', () => {
    const summary = getAthleteRangeSummary({
      items: [
        {
          ...baseItem,
          date: '2026-02-05T01:00:00.000Z',
          status: 'COMPLETED_SYNCED',
          latestCompletedActivity: { durationMinutes: 30, caloriesKcal: 300 },
        },
        {
          ...baseItem,
          date: '2026-02-05T14:30:00.000Z',
          status: 'COMPLETED_SYNCED',
          latestCompletedActivity: { durationMinutes: 45, caloriesKcal: 500 },
        },
      ],
      timeZone: 'Australia/Brisbane',
      fromDayKey: '2026-02-05',
      toDayKey: '2026-02-06',
      todayDayKey: '2026-02-06',
    });

    const dayFive = summary.caloriesByDay.find((row) => row.dayKey === '2026-02-05');
    const daySix = summary.caloriesByDay.find((row) => row.dayKey === '2026-02-06');
    expect(dayFive?.completedCaloriesKcal).toBe(300);
    expect(daySix?.completedCaloriesKcal).toBe(500);
  });

  it('tracks compliance when no planned sessions exist', () => {
    const summary = getAthleteRangeSummary({
      items: [
        {
          ...baseItem,
          date: '2026-02-06',
          status: 'COMPLETED_SYNCED',
          plannedDurationMinutes: null,
          plannedDistanceKm: null,
          latestCompletedActivity: { durationMinutes: 35 },
        },
      ],
      timeZone: 'UTC',
      fromDayKey: '2026-02-01',
      toDayKey: '2026-02-07',
      todayDayKey: '2026-02-07',
    });

    expect(summary.totals.plannedMinutes).toBe(0);
    expect(summary.totals.completedMinutes).toBe(35);
  });
});
