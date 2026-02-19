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

export type StravaVitalsMetricDelta = {
  current: number | null;
  previous: number | null;
  delta: number | null;
  trend: 'up' | 'down' | 'flat' | 'none';
};

export type StravaLoadModel = {
  current: {
    ctl: number;
    atl: number;
    tsb: number;
  };
  previous: {
    ctl: number;
    atl: number;
    tsb: number;
  };
  delta: {
    ctl: number;
    atl: number;
    tsb: number;
  };
  sourceDays: number;
};

export type StravaVitalsComparison = {
  current: StravaVitalsSnapshot;
  previous: StravaVitalsSnapshot;
  range: {
    from: string;
    to: string;
    windowDays: number;
  };
  previousRange: {
    from: string;
    to: string;
    windowDays: number;
  };
  deltas: {
    overall: {
      avgHrBpm: StravaVitalsMetricDelta;
      avgDistanceKm: StravaVitalsMetricDelta;
      avgDurationMinutes: StravaVitalsMetricDelta;
    };
    bike: {
      avgPowerW: StravaVitalsMetricDelta;
      avgHrBpm: StravaVitalsMetricDelta;
      avgSpeedKmh: StravaVitalsMetricDelta;
      avgCadenceRpm: StravaVitalsMetricDelta;
    };
    run: {
      avgPaceSecPerKm: StravaVitalsMetricDelta;
      avgHrBpm: StravaVitalsMetricDelta;
      avgCadenceRpm: StravaVitalsMetricDelta;
    };
    swim: {
      avgPaceSecPer100m: StravaVitalsMetricDelta;
      avgHrBpm: StravaVitalsMetricDelta;
    };
  };
  loadModel: StravaLoadModel | null;
};

type StravaVitalsWindowOptions = {
  windowDays?: number;
  from?: Date;
  to?: Date;
  includeLoadModel?: boolean;
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

function startOfUtcDay(date: Date) {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function endOfUtcDay(date: Date) {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

function addUtcDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildDelta(current: number | null, previous: number | null): StravaVitalsMetricDelta {
  if (current == null && previous == null) {
    return { current, previous, delta: null, trend: 'none' };
  }
  if (current == null || previous == null) {
    return { current, previous, delta: null, trend: 'none' };
  }
  const delta = current - previous;
  const abs = Math.abs(delta);
  const trend = abs < 0.1 ? 'flat' : delta > 0 ? 'up' : 'down';
  return {
    current,
    previous,
    delta: round(delta, 1),
    trend,
  };
}

async function loadRowsForAthletes(athleteIds: string[], from: Date, to: Date) {
  return prisma.completedActivity.findMany({
    where: {
      athleteId: { in: athleteIds },
      source: CompletionSource.STRAVA,
      startTime: { gte: from, lte: to },
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
}

function parseWindow(options?: StravaVitalsWindowOptions) {
  const now = new Date();
  if (options?.from && options?.to) {
    const currentFrom = startOfUtcDay(options.from);
    const currentTo = endOfUtcDay(options.to);
    const rawWindowDays = Math.max(
      1,
      Math.floor((currentTo.getTime() - currentFrom.getTime()) / (24 * 60 * 60 * 1000)) + 1
    );
    const windowDays = Math.min(365, Math.max(1, rawWindowDays));
    const previousTo = endOfUtcDay(addUtcDays(currentFrom, -1));
    const previousFrom = startOfUtcDay(addUtcDays(previousTo, -(windowDays - 1)));
    return { currentFrom, currentTo, previousFrom, previousTo, windowDays };
  }

  const windowDays = Math.min(365, Math.max(14, options?.windowDays ?? 90));
  const currentTo = endOfUtcDay(now);
  const currentFrom = startOfUtcDay(addUtcDays(currentTo, -(windowDays - 1)));
  const previousTo = endOfUtcDay(addUtcDays(currentFrom, -1));
  const previousFrom = startOfUtcDay(addUtcDays(previousTo, -(windowDays - 1)));
  return { currentFrom, currentTo, previousFrom, previousTo, windowDays };
}

function disciplineLoadWeight(discipline: Discipline) {
  if (discipline === 'RUN') return 1.1;
  if (discipline === 'BIKE') return 1;
  if (discipline === 'SWIM') return 0.9;
  return 0.8;
}

function computeDailyLoad(rows: ActivityRow[]) {
  const byDay = new Map<string, number>();
  rows.forEach((row) => {
    const key = dayKey(row.startTime);
    const discipline = normalizeDiscipline(row);
    const weighted = Math.max(0, row.durationMinutes) * disciplineLoadWeight(discipline);
    byDay.set(key, (byDay.get(key) ?? 0) + weighted);
  });
  return byDay;
}

function computeLoadAtDay(dailyLoad: Map<string, number>, fromDay: Date, toDay: Date) {
  const ctlTau = 42;
  const atlTau = 7;
  const ctlAlpha = 1 - Math.exp(-1 / ctlTau);
  const atlAlpha = 1 - Math.exp(-1 / atlTau);

  let ctl = 0;
  let atl = 0;
  let cursor = startOfUtcDay(fromDay);
  const end = startOfUtcDay(toDay);
  let days = 0;

  while (cursor.getTime() <= end.getTime()) {
    const load = dailyLoad.get(dayKey(cursor)) ?? 0;
    ctl = ctl + ctlAlpha * (load - ctl);
    atl = atl + atlAlpha * (load - atl);
    cursor = addUtcDays(cursor, 1);
    days += 1;
  }

  const tsb = ctl - atl;
  return {
    ctl: round(ctl, 1) ?? 0,
    atl: round(atl, 1) ?? 0,
    tsb: round(tsb, 1) ?? 0,
    days,
  };
}

async function computeLoadModelForAthletes(athleteIds: string[], previousTo: Date, currentTo: Date): Promise<StravaLoadModel> {
  const warmupFrom = startOfUtcDay(addUtcDays(previousTo, -84));
  const rows = await loadRowsForAthletes(athleteIds, warmupFrom, currentTo);
  const dailyLoad = computeDailyLoad(rows);
  const previous = computeLoadAtDay(dailyLoad, warmupFrom, previousTo);
  const current = computeLoadAtDay(dailyLoad, warmupFrom, currentTo);
  return {
    current: {
      ctl: current.ctl,
      atl: current.atl,
      tsb: current.tsb,
    },
    previous: {
      ctl: previous.ctl,
      atl: previous.atl,
      tsb: previous.tsb,
    },
    delta: {
      ctl: round(current.ctl - previous.ctl, 1) ?? 0,
      atl: round(current.atl - previous.atl, 1) ?? 0,
      tsb: round(current.tsb - previous.tsb, 1) ?? 0,
    },
    sourceDays: current.days,
  };
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

export async function getStravaVitalsComparisonForAthlete(athleteId: string, options?: StravaVitalsWindowOptions) {
  return getStravaVitalsComparisonForAthletes([athleteId], options);
}

export async function getStravaVitalsComparisonForAthletes(athleteIds: string[], options?: StravaVitalsWindowOptions) {
  const uniqueAthleteIds = Array.from(new Set(athleteIds.filter(Boolean)));
  const windows = parseWindow(options);

  if (!uniqueAthleteIds.length) {
    const empty = buildStravaVitalsSnapshot([], windows.windowDays);
    return {
      current: empty,
      previous: empty,
      range: {
        from: dayKey(windows.currentFrom),
        to: dayKey(windows.currentTo),
        windowDays: windows.windowDays,
      },
      previousRange: {
        from: dayKey(windows.previousFrom),
        to: dayKey(windows.previousTo),
        windowDays: windows.windowDays,
      },
      deltas: {
        overall: {
          avgHrBpm: buildDelta(null, null),
          avgDistanceKm: buildDelta(null, null),
          avgDurationMinutes: buildDelta(null, null),
        },
        bike: {
          avgPowerW: buildDelta(null, null),
          avgHrBpm: buildDelta(null, null),
          avgSpeedKmh: buildDelta(null, null),
          avgCadenceRpm: buildDelta(null, null),
        },
        run: {
          avgPaceSecPerKm: buildDelta(null, null),
          avgHrBpm: buildDelta(null, null),
          avgCadenceRpm: buildDelta(null, null),
        },
        swim: {
          avgPaceSecPer100m: buildDelta(null, null),
          avgHrBpm: buildDelta(null, null),
        },
      },
      loadModel: null,
    } satisfies StravaVitalsComparison;
  }

  const [currentRows, previousRows, loadModel] = await Promise.all([
    loadRowsForAthletes(uniqueAthleteIds, windows.currentFrom, windows.currentTo),
    loadRowsForAthletes(uniqueAthleteIds, windows.previousFrom, windows.previousTo),
    options?.includeLoadModel
      ? computeLoadModelForAthletes(uniqueAthleteIds, windows.previousTo, windows.currentTo)
      : Promise.resolve(null),
  ]);

  const current = buildStravaVitalsSnapshot(currentRows, windows.windowDays);
  const previous = buildStravaVitalsSnapshot(previousRows, windows.windowDays);

  return {
    current,
    previous,
    range: {
      from: dayKey(windows.currentFrom),
      to: dayKey(windows.currentTo),
      windowDays: windows.windowDays,
    },
    previousRange: {
      from: dayKey(windows.previousFrom),
      to: dayKey(windows.previousTo),
      windowDays: windows.windowDays,
    },
    deltas: {
      overall: {
        avgHrBpm: buildDelta(current.overall.avgHrBpm, previous.overall.avgHrBpm),
        avgDistanceKm: buildDelta(current.overall.avgDistanceKm, previous.overall.avgDistanceKm),
        avgDurationMinutes: buildDelta(current.overall.avgDurationMinutes, previous.overall.avgDurationMinutes),
      },
      bike: {
        avgPowerW: buildDelta(current.bike.avgPowerW, previous.bike.avgPowerW),
        avgHrBpm: buildDelta(current.bike.avgHrBpm, previous.bike.avgHrBpm),
        avgSpeedKmh: buildDelta(current.bike.avgSpeedKmh, previous.bike.avgSpeedKmh),
        avgCadenceRpm: buildDelta(current.bike.avgCadenceRpm, previous.bike.avgCadenceRpm),
      },
      run: {
        avgPaceSecPerKm: buildDelta(current.run.avgPaceSecPerKm, previous.run.avgPaceSecPerKm),
        avgHrBpm: buildDelta(current.run.avgHrBpm, previous.run.avgHrBpm),
        avgCadenceRpm: buildDelta(current.run.avgCadenceRpm, previous.run.avgCadenceRpm),
      },
      swim: {
        avgPaceSecPer100m: buildDelta(current.swim.avgPaceSecPer100m, previous.swim.avgPaceSecPer100m),
        avgHrBpm: buildDelta(current.swim.avgHrBpm, previous.swim.avgHrBpm),
      },
    },
    loadModel,
  } satisfies StravaVitalsComparison;
}

export async function getStravaVitalsForAthlete(athleteId: string, options?: { windowDays?: number }) {
  const comparison = await getStravaVitalsComparisonForAthlete(athleteId, options);
  return comparison.current;
}

export async function getStravaVitalsForAthletes(athleteIds: string[], options?: { windowDays?: number }) {
  const comparison = await getStravaVitalsComparisonForAthletes(athleteIds, options);
  return comparison.current;
}
