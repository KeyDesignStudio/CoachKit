import { CompletionSource } from '@prisma/client';

import type { ExternalProviderAdapter, NormalizedExternalActivity } from '@/lib/external-sync/types';
import { toAthleteLocalDayKey } from '@/lib/day-key';

type StravaActivity = {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  start_date?: string;
  start_date_local?: string;
  timezone?: string;
  elapsed_time?: number;
  moving_time?: number;
  distance?: number;
  total_elevation_gain?: number;
  elev_high?: number;
  elev_low?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  calories?: number;
  map?: { summary_polyline?: string };
};

function mapStravaDiscipline(activity: StravaActivity): NormalizedExternalActivity['discipline'] {
  const raw = (activity.sport_type || activity.type || '').toLowerCase();

  if (raw.includes('run')) return 'RUN';
  if (raw.includes('ride') || raw.includes('bike')) return 'BIKE';
  if (raw.includes('swim')) return 'SWIM';

  if (
    raw.includes('workout') ||
    raw.includes('weight') ||
    raw.includes('strength') ||
    raw.includes('training') ||
    raw.includes('crossfit') ||
    raw.includes('yoga') ||
    raw.includes('pilates')
  ) {
    return 'STRENGTH';
  }

  return 'OTHER';
}

function secondsToMinutesRounded(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
}

function metersToKm(meters: number) {
  return meters / 1000;
}

function toZonedMinutes(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return hh * 60 + mm;
}

function deriveAvgPaceSecPerKm(avgSpeedMps: number | undefined) {
  if (!avgSpeedMps || !Number.isFinite(avgSpeedMps) || avgSpeedMps <= 0) return undefined;
  return Math.round(1000 / avgSpeedMps);
}

function compactObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

function sanitizeStravaActivityForStorage(activity: StravaActivity): unknown {
  const raw = activity as any;
  const {
    segment_efforts,
    splits_metric,
    splits_standard,
    laps,
    best_efforts,
    photos,
    similar_activities,
    ...rest
  } = raw ?? {};

  try {
    return JSON.parse(JSON.stringify(rest));
  } catch {
    return rest;
  }
}

export const stravaProviderAdapter: ExternalProviderAdapter<StravaActivity> = {
  provider: 'STRAVA',
  normalize(raw, context) {
    const externalActivityId = String(raw.id ?? '').trim();
    if (!externalActivityId) return null;

    const startInstant = raw.start_date ? new Date(raw.start_date) : new Date(Number.NaN);
    if (Number.isNaN(startInstant.getTime())) return null;

    const movingTimeSec = Math.max(0, Number(raw.moving_time || raw.elapsed_time || 0));
    if (movingTimeSec <= 0) return null;

    const distanceMeters = Number(raw.distance || 0);
    const durationMinutes = secondsToMinutesRounded(movingTimeSec);
    const distanceKm = distanceMeters > 0 ? metersToKm(distanceMeters) : null;
    const discipline = mapStravaDiscipline(raw);

    const averageSpeedMps = typeof raw.average_speed === 'number' ? raw.average_speed : undefined;
    const averageHeartrateBpm = typeof raw.average_heartrate === 'number' ? raw.average_heartrate : undefined;
    const maxHeartrateBpm = typeof raw.max_heartrate === 'number' ? raw.max_heartrate : undefined;
    const averageCadenceRpm = typeof raw.average_cadence === 'number' ? raw.average_cadence : undefined;

    const metrics = compactObject({
      activityId: externalActivityId,
      startDateUtc: raw.start_date,
      startDateLocal: raw.start_date_local,
      timezone: raw.timezone,
      activity: sanitizeStravaActivityForStorage(raw),
      name: raw.name,
      sportType: raw.sport_type,
      type: raw.type,
      distanceMeters,
      movingTimeSec,
      elapsedTimeSec: typeof raw.elapsed_time === 'number' ? raw.elapsed_time : undefined,
      totalElevationGainM: typeof raw.total_elevation_gain === 'number' ? raw.total_elevation_gain : undefined,
      elevHighM: typeof raw.elev_high === 'number' ? raw.elev_high : undefined,
      elevLowM: typeof raw.elev_low === 'number' ? raw.elev_low : undefined,
      averageSpeedMps,
      maxSpeedMps: typeof raw.max_speed === 'number' ? raw.max_speed : undefined,
      averageHeartrateBpm,
      maxHeartrateBpm,
      averageCadenceRpm,
      caloriesKcal: typeof raw.calories === 'number' ? raw.calories : undefined,
      summaryPolyline: typeof raw.map?.summary_polyline === 'string' ? raw.map.summary_polyline : undefined,
      avgSpeedMps: averageSpeedMps,
      avgPaceSecPerKm: discipline === 'RUN' ? deriveAvgPaceSecPerKm(averageSpeedMps) : undefined,
      avgHr: typeof averageHeartrateBpm === 'number' ? Math.round(averageHeartrateBpm) : undefined,
      maxHr: typeof maxHeartrateBpm === 'number' ? Math.round(maxHeartrateBpm) : undefined,
    });

    return {
      externalActivityId,
      provider: 'STRAVA',
      source: CompletionSource.STRAVA,
      discipline,
      subtype: raw.type ?? null,
      title: (raw.name ?? '').trim() || 'Unplanned (Imported from Strava)',
      startTime: startInstant,
      activityDayKey: toAthleteLocalDayKey(startInstant, context.athleteTimezone),
      activityMinutes: toZonedMinutes(startInstant, context.athleteTimezone),
      durationMinutes,
      distanceKm,
      notes: null,
      metricsNamespace: 'strava',
      metrics,
    };
  },
};
