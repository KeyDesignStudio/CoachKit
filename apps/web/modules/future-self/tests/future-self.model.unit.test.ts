import { describe, expect, it } from 'vitest';

import { buildProjection, confidenceFromSignals } from '@/modules/future-self/server/model';

const baseInput = {
  athleteId: 'athlete-1',
  sportProfile: {
    disciplines: ['RUN', 'BIKE'],
    eventName: '10k Race',
    eventDate: '2026-05-01',
  },
  history: {
    historyWeeks: 12,
    recentDaysWithTraining: 16,
    recentActivities: [
      {
        startTimeIso: '2026-02-01T00:00:00.000Z',
        discipline: 'RUN',
        durationMinutes: 45,
        distanceKm: 10,
        rpe: 7,
        avgPowerW: null,
      },
      {
        startTimeIso: '2026-02-03T00:00:00.000Z',
        discipline: 'BIKE',
        durationMinutes: 60,
        distanceKm: 30,
        rpe: 6,
        avgPowerW: 250,
      },
    ],
    plannedSessionsLast28Days: 16,
    completedSessionsLast28Days: 14,
    runBest5kSec: 1200,
    runBest10kSec: 2520,
    bikeFtpLikeW: 240,
    checkinsLast30Days: [
      { dateIso: '2026-02-01T00:00:00.000Z', weight: 75, waist: 84 },
      { dateIso: '2026-02-10T00:00:00.000Z', weight: 74.5, waist: 83.5 },
      { dateIso: '2026-02-20T00:00:00.000Z', weight: 74.2, waist: 83.2 },
    ],
  },
};

describe('future-self model', () => {
  it('returns stable projection fixture output for headline and confidence', () => {
    const result = buildProjection(baseInput, {
      adherencePct: 85,
      volumePct: 0,
      intensityMode: 'BASELINE',
      taperDays: 7,
    }, 12);

    expect(result.headline).toMatch(/^Likely 10k:/);
    expect(result.confidence.overall.grade).toBe('A');
    expect(result.horizons['12']?.performance?.summary).toContain('Likely 10k range by 12 weeks');
  });

  it('confidence scoring follows A/B/C rules', () => {
    expect(confidenceFromSignals({ historyWeeks: 12, hasBenchmark: true, recentDaysWithTraining: 14 }).grade).toBe('A');
    expect(confidenceFromSignals({ historyWeeks: 6, hasBenchmark: false, recentDaysWithTraining: 10 }).grade).toBe('B');
    expect(confidenceFromSignals({ historyWeeks: 2, hasBenchmark: false, recentDaysWithTraining: 2 }).grade).toBe('C');
  });

  it('band generation keeps values bounded and ordered', () => {
    const result = buildProjection(baseInput, {
      adherencePct: 95,
      volumePct: 10,
      intensityMode: 'PLUS_ONE_HARD_SESSION',
      taperDays: 10,
    }, 24);

    const run10k = result.horizons['24']?.performance?.run10kSec;
    expect(run10k).not.toBeNull();
    expect((run10k?.low ?? 0) > 0).toBe(true);
    expect((run10k?.low ?? 0) <= (run10k?.likely ?? 0)).toBe(true);
    expect((run10k?.likely ?? 0) <= (run10k?.high ?? 0)).toBe(true);
  });
});
