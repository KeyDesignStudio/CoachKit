import { describe, expect, it } from 'vitest';

import { buildStravaVitalsSnapshot } from '@/lib/strava-vitals';

describe('strava vitals aggregation', () => {
  it('aggregates bike/run/swim vitals from Strava metrics', () => {
    const snapshot = buildStravaVitalsSnapshot(
      [
        {
          startTime: new Date('2026-02-19T06:00:00.000Z'),
          durationMinutes: 90,
          distanceKm: 45,
          calendarItem: { discipline: 'BIKE' },
          metricsJson: {
            strava: {
              averageHeartrateBpm: 148,
              averageSpeedMps: 8.5,
              averageCadenceRpm: 86,
              activity: {
                average_watts: 235,
              },
            },
          },
        },
        {
          startTime: new Date('2026-02-18T06:00:00.000Z'),
          durationMinutes: 50,
          distanceKm: 10,
          calendarItem: { discipline: 'RUN' },
          metricsJson: {
            strava: {
              avgPaceSecPerKm: 300,
              avgHr: 155,
              averageCadenceRpm: 172,
            },
          },
        },
        {
          startTime: new Date('2026-02-17T06:00:00.000Z'),
          durationMinutes: 40,
          distanceKm: 2,
          calendarItem: { discipline: 'SWIM' },
          metricsJson: {
            strava: {
              average_speed: 1.4,
              average_heartrate: 140,
            },
          },
        },
      ],
      90
    );

    expect(snapshot.sampleSize).toBe(3);
    expect(snapshot.overall.avgHrBpm).toBe(148);
    expect(snapshot.bike.avgPowerW).toBe(235);
    expect(snapshot.bike.avgSpeedKmh).toBe(30.6);
    expect(snapshot.run.avgPaceSecPerKm).toBe(300);
    expect(snapshot.run.avgCadenceRpm).toBe(172);
    expect(snapshot.swim.avgPaceSecPer100m).toBe(71);
  });

  it('falls back to sport type when calendar discipline is missing', () => {
    const snapshot = buildStravaVitalsSnapshot(
      [
        {
          startTime: new Date('2026-02-19T06:00:00.000Z'),
          durationMinutes: 55,
          distanceKm: 8,
          calendarItem: null,
          metricsJson: {
            strava: {
              sportType: 'Run',
              averageSpeedMps: 3.6,
              avgHr: 150,
            },
          },
        },
      ],
      30
    );

    expect(snapshot.run.sessions).toBe(1);
    expect(snapshot.run.avgPaceSecPerKm).toBe(278);
    expect(snapshot.run.avgHrBpm).toBe(150);
  });
});
