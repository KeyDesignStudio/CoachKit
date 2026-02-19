import { CompletionSource, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export type StravaVitalsSnapshot = {
  windowDays: number;
  sampleSize: number;
  latestActivityAt: string | null;
  overall: {
    avgHrBpm: number | null;
    avgDistanceKm: number | null;
    avgDurationMinutes: number | null;
  };
  bike: {
    sessions: number;
    avgPowerW: number | null;
    avgHrBpm: number | null;
    avgSpeedKmh: number | null;
    avgCadenceRpm: number | null;
  };
  run: {
    sessions: number;
    avgPaceSecPerKm: number | null;
    avgHrBpm: number | null;
    avgCadenceRpm: number | null;
  };
  swim: {
    sessions: number;
    avgPaceSecPer100m: number | null;
    avgHrBpm: number | null;
  };
};

type ActivityRow = {
  startTime: Date;
  durationMinutes: number;
  distanceKm: number | null;
  metricsJson: Prisma.JsonValue | null;
  calendarItem: {
    discipline: string;
  } | null;
};

type Discipline = 'BIKE' | 'RUN' | 'SWIM' | 'OTHER';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readNumber(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function normalizeDiscipline(row: ActivityRow): Discipline {
  const fromCalendar = String(row.calendarItem?.discipline ?? '').toUpperCase();
  if (fromCalendar === 'BIKE') return 'BIKE';
  if (fromCalendar === 'RUN') return 'RUN';
  if (fromCalendar === 'SWIM') return 'SWIM';

  const strava = asObject(asObject(row.metricsJson)?.strava);
  const activity = asObject(strava.activity);
  const raw = String(
    activity.sport_type ??
      activity.sportType ??
      strava.sportType ??
      activity.type ??
      strava.type ??
      ''
  ).toUpperCase();

  if (raw.includes('RIDE') || raw.includes('BIKE') || raw.includes('CYCLE')) return 'BIKE';
  if (raw.includes('RUN') || raw.includes('WALK') || raw.includes('TRAIL')) return 'RUN';
  if (raw.includes('SWIM')) return 'SWIM';

  return 'OTHER';
}

function round(value: number | null, decimals = 1) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(sum: number, count: number) {
  return count > 0 ? sum / count : null;
}

export function buildStravaVitalsSnapshot(rows: ActivityRow[], windowDays: number): StravaVitalsSnapshot {
  let totalHr = 0;
  let totalHrCount = 0;
  let totalDistance = 0;
  let totalDuration = 0;

  let bikeSessions = 0;
  let bikePowerSum = 0;
  let bikePowerCount = 0;
  let bikeHrSum = 0;
  let bikeHrCount = 0;
  let bikeSpeedSum = 0;
  let bikeSpeedCount = 0;
  let bikeCadenceSum = 0;
  let bikeCadenceCount = 0;

  let runSessions = 0;
  let runPaceSum = 0;
  let runPaceCount = 0;
  let runHrSum = 0;
  let runHrCount = 0;
  let runCadenceSum = 0;
  let runCadenceCount = 0;

  let swimSessions = 0;
  let swimPaceSum = 0;
  let swimPaceCount = 0;
  let swimHrSum = 0;
  let swimHrCount = 0;

  for (const row of rows) {
    const strava = asObject(asObject(row.metricsJson)?.strava);
    const activity = asObject(strava.activity);
    const discipline = normalizeDiscipline(row);

    const avgHr =
      readNumber(activity, 'average_heartrate', 'averageHeartrate') ??
      readNumber(strava, 'averageHeartrateBpm', 'avgHr', 'average_heartrate');

    const avgSpeedMps =
      readNumber(strava, 'averageSpeedMps', 'avgSpeedMps', 'average_speed') ??
      readNumber(activity, 'average_speed', 'averageSpeed');

    const avgCadence =
      readNumber(strava, 'averageCadenceRpm', 'average_cadence') ??
      readNumber(activity, 'average_cadence', 'averageCadence');

    const avgPower = readNumber(activity, 'average_watts', 'averageWatts');
    const avgPaceSecPerKm =
      readNumber(strava, 'avgPaceSecPerKm', 'avg_pace_sec_per_km') ??
      (avgSpeedMps && avgSpeedMps > 0 ? 1000 / avgSpeedMps : null);
    const avgPaceSecPer100m = avgSpeedMps && avgSpeedMps > 0 ? 100 / avgSpeedMps : null;

    totalDistance += Math.max(0, row.distanceKm ?? 0);
    totalDuration += Math.max(0, row.durationMinutes ?? 0);

    if (avgHr != null) {
      totalHr += avgHr;
      totalHrCount += 1;
    }

    if (discipline === 'BIKE') {
      bikeSessions += 1;
      if (avgPower != null) {
        bikePowerSum += avgPower;
        bikePowerCount += 1;
      }
      if (avgHr != null) {
        bikeHrSum += avgHr;
        bikeHrCount += 1;
      }
      if (avgSpeedMps != null) {
        bikeSpeedSum += avgSpeedMps * 3.6;
        bikeSpeedCount += 1;
      }
      if (avgCadence != null) {
        bikeCadenceSum += avgCadence;
        bikeCadenceCount += 1;
      }
    } else if (discipline === 'RUN') {
      runSessions += 1;
      if (avgPaceSecPerKm != null) {
        runPaceSum += avgPaceSecPerKm;
        runPaceCount += 1;
      }
      if (avgHr != null) {
        runHrSum += avgHr;
        runHrCount += 1;
      }
      if (avgCadence != null) {
        runCadenceSum += avgCadence;
        runCadenceCount += 1;
      }
    } else if (discipline === 'SWIM') {
      swimSessions += 1;
      if (avgPaceSecPer100m != null) {
        swimPaceSum += avgPaceSecPer100m;
        swimPaceCount += 1;
      }
      if (avgHr != null) {
        swimHrSum += avgHr;
        swimHrCount += 1;
      }
    }
  }

  return {
    windowDays,
    sampleSize: rows.length,
    latestActivityAt: rows[0]?.startTime?.toISOString() ?? null,
    overall: {
      avgHrBpm: round(average(totalHr, totalHrCount), 0),
      avgDistanceKm: round(average(totalDistance, rows.length), 1),
      avgDurationMinutes: round(average(totalDuration, rows.length), 0),
    },
    bike: {
      sessions: bikeSessions,
      avgPowerW: round(average(bikePowerSum, bikePowerCount), 0),
      avgHrBpm: round(average(bikeHrSum, bikeHrCount), 0),
      avgSpeedKmh: round(average(bikeSpeedSum, bikeSpeedCount), 1),
      avgCadenceRpm: round(average(bikeCadenceSum, bikeCadenceCount), 0),
    },
    run: {
      sessions: runSessions,
      avgPaceSecPerKm: round(average(runPaceSum, runPaceCount), 0),
      avgHrBpm: round(average(runHrSum, runHrCount), 0),
      avgCadenceRpm: round(average(runCadenceSum, runCadenceCount), 0),
    },
    swim: {
      sessions: swimSessions,
      avgPaceSecPer100m: round(average(swimPaceSum, swimPaceCount), 0),
      avgHrBpm: round(average(swimHrSum, swimHrCount), 0),
    },
  };
}

export async function getStravaVitalsForAthlete(athleteId: string, options?: { windowDays?: number }) {
  const windowDays = Math.min(365, Math.max(14, options?.windowDays ?? 90));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - windowDays);

  const rows = await prisma.completedActivity.findMany({
    where: {
      athleteId,
      source: CompletionSource.STRAVA,
      startTime: { gte: since },
    },
    orderBy: [{ startTime: 'desc' }],
    select: {
      startTime: true,
      durationMinutes: true,
      distanceKm: true,
      metricsJson: true,
      calendarItem: {
        select: {
          discipline: true,
        },
      },
    },
  });

  return buildStravaVitalsSnapshot(rows, windowDays);
}
