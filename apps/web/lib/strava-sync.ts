import { CalendarItemStatus, CompletionSource } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { mapWithConcurrency } from '@/lib/concurrency';

export type PollSummary = {
  polledAthletes: number;
  fetched: number;
  created: number;
  updated: number;
  matched: number;
  createdCalendarItems: number;
  skippedExisting: number;
  errors: Array<{ athleteId?: string; message: string }>;
};

export type StravaConnectionEntry = {
  athleteId: string;
  athleteTimezone: string;
  coachId: string;
  connection: {
    id: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope: string | null;
    lastSyncAt: Date | null;
  };
};

type StravaActivity = {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  start_date?: string; // UTC
  start_date_local?: string; // local
  timezone?: string;
  elapsed_time?: number; // seconds
  moving_time?: number; // seconds
  distance?: number; // meters
  total_elevation_gain?: number; // meters
  elev_high?: number; // meters
  elev_low?: number; // meters
  average_speed?: number; // meters per second
  max_speed?: number; // meters per second
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  calories?: number;
  map?: {
    summary_polyline?: string;
  };
};

function sanitizeStravaActivityForStorage(activity: StravaActivity): any {
  // Strava activity detail payloads may include large arrays (laps/segments/etc).
  // We store a compact version so future fields can be derived without re-fetching.
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

  // Ensure the payload is JSON-serializable (no `undefined`, functions, etc)
  // so Prisma can persist it safely.
  try {
    return JSON.parse(JSON.stringify(rest));
  } catch {
    return rest;
  }
}

function mapStravaDiscipline(activity: StravaActivity) {
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

function minutesToTimeString(totalMinutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.floor(totalMinutes)));
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function metersToKm(meters: number) {
  return meters / 1000;
}

function compactObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

function deriveAvgPaceSecPerKm(avgSpeedMps: number | undefined) {
  if (!avgSpeedMps || !Number.isFinite(avgSpeedMps) || avgSpeedMps <= 0) return undefined;
  return Math.round(1000 / avgSpeedMps);
}

function shouldUpdateStravaMetrics(existing: unknown, next: Record<string, unknown>) {
  if (!existing || typeof existing !== 'object') return true;
  const prev = existing as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    const prevValue = prev[key];

    if (value && typeof value === 'object') {
      if (!prevValue || typeof prevValue !== 'object') return true;
      try {
        if (JSON.stringify(prevValue) !== JSON.stringify(value)) return true;
      } catch {
        return true;
      }
      continue;
    }

    if (prevValue !== value) return true;
  }
  return false;
}

function parseTimeToMinutes(value: string) {
  const [hh, mm] = value.split(':');
  const hours = Number(hh);
  const minutes = Number(mm);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    y: Number(lookup.year),
    m: Number(lookup.month),
    d: Number(lookup.day),
    hh: Number(lookup.hour),
    mm: Number(lookup.minute),
  };
}

function toNaiveUtcDateOnlyFromZone(instant: Date, timeZone: string) {
  const p = getZonedParts(instant, timeZone);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0, 0));
}

function toZonedMinutes(instant: Date, timeZone: string) {
  const p = getZonedParts(instant, timeZone);
  return p.hh * 60 + p.mm;
}

function addDaysUtc(date: Date, days: number) {
  const clone = new Date(date);
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

async function refreshStravaTokenIfNeeded(connection: StravaConnectionEntry['connection']) {
  const now = Date.now();
  const expiresAtMs = new Date(connection.expiresAt).getTime();

  if (now < expiresAtMs - 60_000) {
    return connection;
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new ApiError(500, 'STRAVA_CONFIG_MISSING', 'STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET are not set.');
  }

  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken,
    }).toString(),
    cache: 'no-store',
  });

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    scope?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new ApiError(502, 'STRAVA_TOKEN_REFRESH_FAILED', payload.message || 'Failed to refresh Strava token.');
  }

  if (!payload.access_token || !payload.refresh_token || !payload.expires_at) {
    throw new ApiError(502, 'STRAVA_TOKEN_REFRESH_INVALID', 'Strava token refresh response missing required fields.');
  }

  const updated = await prisma.stravaConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: new Date(payload.expires_at * 1000),
      scope: payload.scope ?? connection.scope ?? null,
    },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
      scope: true,
      lastSyncAt: true,
    },
  });

  return updated;
}

async function fetchRecentActivities(accessToken: string, afterUnixSeconds: number) {
  if (process.env.STRAVA_STUB === 'true' && process.env.DISABLE_AUTH === 'true') {
    const now = new Date();
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

    const mk = (id: number, name: string, sportType: string, startUtc: Date, elapsedSec: number, distanceMeters?: number) => ({
      id,
      name,
      sport_type: sportType,
      type: sportType,
      start_date: startUtc.toISOString(),
      start_date_local: startUtc.toISOString(),
      elapsed_time: elapsedSec,
      moving_time: elapsedSec,
      distance: typeof distanceMeters === 'number' ? distanceMeters : 0,
      total_elevation_gain: 0,
    });

    const activities: StravaActivity[] = [
      // Always-present control activity used by existing Playwright coverage.
      mk(999, 'PW Unscheduled Strength', 'Hike', new Date(base.getTime() + 12 * 60 * 60_000), 3600, 0),

      // Matching scenarios.
      mk(1000, 'PW Run Time Shift', 'Run', new Date(base.getTime() + (6 * 60 + 20) * 60_000), 2700, 8000),
      mk(1001, 'PW Strength Fuzzy', 'Workout', new Date(base.getTime() + (14 * 60 + 10) * 60_000), 3600, 0),
      mk(1002, 'PW Run Ambiguous', 'Run', new Date(base.getTime() + (8 * 60 + 5) * 60_000), 2400, 6000),
      // Midnight-boundary case: just after midnight the next day.
      mk(1003, 'PW Run Midnight', 'Run', new Date(base.getTime() + 24 * 60 * 60_000 + 10 * 60_000), 1800, 5000),
    ];

    return activities.filter((a) => {
      const t = a.start_date ? Math.floor(new Date(a.start_date).getTime() / 1000) : 0;
      return t > afterUnixSeconds;
    });
  }

  const url = new URL('https://www.strava.com/api/v3/athlete/activities');
  url.searchParams.set('per_page', '50');
  url.searchParams.set('after', String(afterUnixSeconds));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  if (response.status === 429) {
    throw new ApiError(429, 'STRAVA_RATE_LIMITED', 'Strava rate limit hit. Try again later.');
  }

  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    throw new ApiError(502, 'STRAVA_ACTIVITIES_FETCH_FAILED', 'Failed to fetch Strava activities.');
  }

  if (!Array.isArray(payload)) {
    throw new ApiError(502, 'STRAVA_ACTIVITIES_INVALID', 'Strava activities response was not an array.');
  }

  return payload as StravaActivity[];
}

async function fetchActivityById(accessToken: string, activityId: string) {
  if (process.env.STRAVA_STUB === 'true' && process.env.DISABLE_AUTH === 'true') {
    const activities = await fetchRecentActivities(accessToken, 0);
    const match = activities.find((a) => String(a.id) === String(activityId));
    if (match) return match;
    return {
      id: Number(activityId) || 999,
      name: 'PW Unscheduled Strength',
      sport_type: 'Workout',
      type: 'Workout',
      start_date: new Date().toISOString(),
      elapsed_time: 3600,
    };
  }

  const url = new URL(`https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}`);
  url.searchParams.set('include_all_efforts', 'false');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  if (response.status === 429) {
    throw new ApiError(429, 'STRAVA_RATE_LIMITED', 'Strava rate limit hit. Try again later.');
  }

  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    throw new ApiError(502, 'STRAVA_ACTIVITY_FETCH_FAILED', 'Failed to fetch Strava activity.');
  }

  return payload as StravaActivity;
}

async function matchAndLinkCalendarItem(params: {
  athleteId: string;
  activityDateOnly: Date;
  activityMinutes: number;
  discipline: string;
  completedActivityId: string;
  confirmedAt: Date | null;
}) {
  const { athleteId, activityDateOnly, activityMinutes, discipline, completedActivityId, confirmedAt } = params;

  function normalizeDiscipline(value: string) {
    const upper = String(value ?? '').trim().toUpperCase();
    if (upper === 'STR') return 'STRENGTH';
    return upper;
  }

  function minutesDiffCircular(a: number, b: number) {
    const diff = Math.abs(a - b);
    return Math.min(diff, 1440 - diff);
  }

  function scoreCandidate(candidate: { item: { discipline: string; plannedStartTimeLocal: string | null; date: Date } }) {
    const itemDiscipline = normalizeDiscipline(candidate.item.discipline);
    const activityDiscipline = normalizeDiscipline(discipline);
    const disciplineScore = itemDiscipline === activityDiscipline ? 50 : 0;

    const plannedMinutes = candidate.item.plannedStartTimeLocal
      ? parseTimeToMinutes(candidate.item.plannedStartTimeLocal)
      : null;
    const timeDiff = plannedMinutes == null ? null : minutesDiffCircular(plannedMinutes, activityMinutes);

    // Prefer closer times and avoid weak auto-links.
    // 0 min => 40 points, 90m+ => 0 points
    const maxMinutes = 90;
    const timeScore = timeDiff == null ? 0 : Math.max(0, Math.round(40 * (1 - Math.min(timeDiff, maxMinutes) / maxMinutes)));

    const dayKey = candidate.item.date.toISOString().slice(0, 10);
    const targetKey = activityDateOnly.toISOString().slice(0, 10);
    const dayDistance = dayKey === targetKey ? 0 : 1;
    const dayScore = dayDistance === 0 ? 20 : 0;

    const total = disciplineScore + timeScore + dayScore;

    return {
      total,
      plannedMinutes,
      timeDiff,
      dayDistance,
    };
  }

  const rangeStart = addDaysUtc(activityDateOnly, -1);
  const rangeEnd = addDaysUtc(activityDateOnly, 1);

  const items = await prisma.calendarItem.findMany({
    where: {
      athleteId,
      deletedAt: null,
      date: { gte: rangeStart, lte: rangeEnd },
      status: { in: [CalendarItemStatus.PLANNED, CalendarItemStatus.MODIFIED] },
      // Only match against planned sessions (provider/imported items have origin).
      origin: null,
    },
    select: {
      id: true,
      date: true,
      discipline: true,
      plannedStartTimeLocal: true,
      status: true,
    },
    orderBy: [{ date: 'asc' }, { plannedStartTimeLocal: 'asc' }],
    take: 25,
  });

  if (!items.length) return { matched: false as const };

  const scored = items
    .map((item) => {
      const s = scoreCandidate({ item });
      return {
        item,
        score: s.total,
        dayDistance: s.dayDistance,
        timeDiff: s.timeDiff,
      };
    })
    .filter((c) => c.dayDistance <= 1)
    .sort((a, b) => b.score - a.score);

  const best = scored[0] ?? null;
  const second = scored[1] ?? null;
  if (!best) return { matched: false as const };

  // Require a strong match and avoid ambiguous auto-links.
  // If it's close, prefer creating an unplanned STRAVA item instead.
  const minScoreToMatch = 70;
  const minLead = 10;
  if (best.score < minScoreToMatch) return { matched: false as const };
  if (second && best.score - second.score < minLead) return { matched: false as const };

  const nextStatus = confirmedAt ? CalendarItemStatus.COMPLETED_SYNCED : CalendarItemStatus.COMPLETED_SYNCED_DRAFT;

  await prisma.$transaction([
    prisma.calendarItem.update({
      where: { id: best.item.id },
      data: { status: nextStatus },
    }),
    prisma.completedActivity.update({
      where: { id: completedActivityId },
      data: { calendarItemId: best.item.id },
    }),
  ]);

  return { matched: true as const, calendarItemId: best.item.id };
}

async function ensureCalendarItemStatusForSyncedCompletion(params: { calendarItemId: string; confirmedAt: Date | null }) {
  const { calendarItemId, confirmedAt } = params;

  const item = await prisma.calendarItem.findUnique({
    where: { id: calendarItemId },
    select: { status: true },
  });

  if (!item) return;

  if (!confirmedAt) {
    if (
      item.status === CalendarItemStatus.PLANNED ||
      item.status === CalendarItemStatus.MODIFIED ||
      item.status === CalendarItemStatus.COMPLETED_SYNCED
    ) {
      await prisma.calendarItem.update({
        where: { id: calendarItemId },
        data: { status: CalendarItemStatus.COMPLETED_SYNCED_DRAFT },
      });
    }

    return;
  }

  if (item.status === CalendarItemStatus.COMPLETED_SYNCED_DRAFT) {
    await prisma.calendarItem.update({
      where: { id: calendarItemId },
      data: { status: CalendarItemStatus.COMPLETED_SYNCED },
    });
  }
}

async function ingestActivities(entry: StravaConnectionEntry, activities: StravaActivity[], summary: PollSummary) {
  summary.fetched += activities.length;

  for (const activity of activities) {
    if (!activity?.id || !activity.start_date || !activity.elapsed_time) {
      continue;
    }

    const externalActivityId = String(activity.id);

    // Tombstone guard: if the athlete deleted a STRAVA-origin calendar item for this activity,
    // do NOT recreate or update it (and do not recreate the completion row).
    const tombstone = await prisma.calendarItem.findUnique({
      where: {
        athleteId_origin_sourceActivityId: {
          athleteId: entry.athleteId,
          origin: 'STRAVA',
          sourceActivityId: externalActivityId,
        },
      } as any,
      select: { id: true, deletedAt: true },
    });

    if (tombstone?.deletedAt) {
      // Defensive cleanup: ensure we don't keep recreating orphaned completions.
      await prisma.completedActivity.deleteMany({
        where: {
          athleteId: entry.athleteId,
          source: CompletionSource.STRAVA,
          externalActivityId,
        },
      });
      summary.skippedExisting += 1;
      continue;
    }

    const discipline = mapStravaDiscipline(activity);
    const startInstant = new Date(activity.start_date);
    const activityDateOnly = toNaiveUtcDateOnlyFromZone(startInstant, entry.athleteTimezone);
    const activityMinutes = toZonedMinutes(startInstant, entry.athleteTimezone);
    const durationMinutes = secondsToMinutesRounded(activity.elapsed_time);
    const distanceKm = typeof activity.distance === 'number' ? metersToKm(activity.distance) : null;

    const stravaType = activity.sport_type ?? activity.type;
    const distanceMeters = typeof activity.distance === 'number' ? activity.distance : undefined;
    const movingTimeSec = typeof activity.moving_time === 'number' ? activity.moving_time : undefined;
    const elapsedTimeSec = typeof activity.elapsed_time === 'number' ? activity.elapsed_time : undefined;
    const totalElevationGainM = typeof activity.total_elevation_gain === 'number' ? activity.total_elevation_gain : undefined;
    const elevHighM = typeof activity.elev_high === 'number' ? activity.elev_high : undefined;
    const elevLowM = typeof activity.elev_low === 'number' ? activity.elev_low : undefined;
    const averageSpeedMps = typeof activity.average_speed === 'number' ? activity.average_speed : undefined;
    const maxSpeedMps = typeof activity.max_speed === 'number' ? activity.max_speed : undefined;
    const averageHeartrateBpm = typeof activity.average_heartrate === 'number' ? activity.average_heartrate : undefined;
    const maxHeartrateBpm = typeof activity.max_heartrate === 'number' ? activity.max_heartrate : undefined;
    const averageCadenceRpm = typeof activity.average_cadence === 'number' ? activity.average_cadence : undefined;
    const caloriesKcal = typeof activity.calories === 'number' ? activity.calories : undefined;
    const summaryPolyline = typeof activity.map?.summary_polyline === 'string' ? activity.map.summary_polyline : undefined;
    const storedActivity = sanitizeStravaActivityForStorage(activity);

    const stravaMetrics = compactObject({
      activityId: externalActivityId,
      startDateUtc: activity.start_date,
      startDateLocal: activity.start_date_local,
      timezone: activity.timezone,

      // Retain a compact version of Strava's payload so newly added fields can be
      // populated without requiring another Strava API fetch.
      activity: storedActivity,

      name: activity.name,
      sportType: activity.sport_type,
      type: activity.type ?? stravaType,
      distanceMeters,
      movingTimeSec,
      elapsedTimeSec,

      totalElevationGainM,
      elevHighM,
      elevLowM,
      averageSpeedMps,
      maxSpeedMps,
      averageHeartrateBpm,
      maxHeartrateBpm,
      averageCadenceRpm,

      caloriesKcal,

      summaryPolyline,

      avgSpeedMps: averageSpeedMps,
      avgPaceSecPerKm: discipline === 'RUN' ? deriveAvgPaceSecPerKm(averageSpeedMps) : undefined,
      avgHr: typeof averageHeartrateBpm === 'number' ? Math.round(averageHeartrateBpm) : undefined,
      maxHr: typeof maxHeartrateBpm === 'number' ? Math.round(maxHeartrateBpm) : undefined,
    });

    const canonicalStartUtc = (stravaMetrics as any)?.startDateUtc ?? activity.start_date;
    const canonicalStart = new Date(canonicalStartUtc);
    const startTime = !Number.isNaN(canonicalStart.getTime()) ? canonicalStart : startInstant;

    let completed: any;

    try {
      completed = await prisma.completedActivity.create({
        data: {
          athleteId: entry.athleteId,
          source: CompletionSource.STRAVA,
          externalProvider: 'STRAVA',
          externalActivityId,
          startTime,
          durationMinutes,
          distanceKm,
          notes: null,
          painFlag: false,
          confirmedAt: null,
          metricsJson: {
            strava: stravaMetrics,
          },
        },
        select: {
          id: true,
          calendarItemId: true,
          durationMinutes: true,
          distanceKm: true,
          startTime: true,
          confirmedAt: true,
        },
      });
      summary.created += 1;
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;

      const existing = await prisma.completedActivity.findUnique({
        where: {
          athleteId_source_externalActivityId: {
            athleteId: entry.athleteId,
            source: CompletionSource.STRAVA,
            externalActivityId,
          },
        } as any,
        select: {
          id: true,
          calendarItemId: true,
          durationMinutes: true,
          distanceKm: true,
          startTime: true,
          confirmedAt: true,
          metricsJson: true,
        },
      });

      if (
        existing &&
        existing.durationMinutes === durationMinutes &&
        (existing.distanceKm ?? null) === (distanceKm ?? null) &&
        new Date(existing.startTime).getTime() === startTime.getTime() &&
        !shouldUpdateStravaMetrics((existing.metricsJson as any)?.strava, stravaMetrics as any)
      ) {
        completed = existing;
        summary.skippedExisting += 1;
      } else {
        completed = await prisma.completedActivity.update({
          where: {
            athleteId_source_externalActivityId: {
              athleteId: entry.athleteId,
              source: CompletionSource.STRAVA,
              externalActivityId,
            },
          } as any,
          data: {
            startTime,
            durationMinutes,
            distanceKm,
            metricsJson: {
              ...(existing?.metricsJson as any),
              strava: stravaMetrics,
            },
          },
          select: {
            id: true,
            calendarItemId: true,
            durationMinutes: true,
            distanceKm: true,
            startTime: true,
            confirmedAt: true,
          },
        });
        summary.updated += 1;
      }
    }

    let calendarItemId: string | null = completed?.calendarItemId ?? null;

    if (!calendarItemId) {
      const match = await matchAndLinkCalendarItem({
        athleteId: entry.athleteId,
        activityDateOnly,
        activityMinutes,
        discipline,
        completedActivityId: completed.id,
        confirmedAt: completed.confirmedAt ?? null,
      });

      if (match.matched) {
        summary.matched += 1;
        calendarItemId = match.calendarItemId;
      }
    }

    if (calendarItemId) {
      await ensureCalendarItemStatusForSyncedCompletion({
        calendarItemId,
        confirmedAt: completed.confirmedAt ?? null,
      });
    }

    if (!calendarItemId) {
      const nextStatus = completed.confirmedAt ? CalendarItemStatus.COMPLETED_SYNCED : CalendarItemStatus.COMPLETED_SYNCED_DRAFT;

      const plannedStartTimeLocal = minutesToTimeString(activityMinutes);
      const title = (activity.name ?? '').trim() || 'Unplanned (Imported from Strava)';

      const item = await prisma.calendarItem.upsert({
        where: {
          athleteId_origin_sourceActivityId: {
            athleteId: entry.athleteId,
            origin: 'STRAVA',
            sourceActivityId: externalActivityId,
          },
        } as any,
        create: {
          athleteId: entry.athleteId,
          coachId: entry.coachId,
          date: activityDateOnly,
          plannedStartTimeLocal,
          origin: 'STRAVA',
          planningStatus: 'UNPLANNED',
          sourceActivityId: externalActivityId,
          discipline,
          subtype: stravaType ?? null,
          title,
          notes: 'Imported from Strava.',
          plannedDurationMinutes: durationMinutes,
          plannedDistanceKm: distanceKm,
          distanceMeters: typeof distanceMeters === 'number' ? distanceMeters : null,
          status: nextStatus,
        } as any,
        update: {
          coachId: entry.coachId,
          date: activityDateOnly,
          plannedStartTimeLocal,
          origin: 'STRAVA',
          planningStatus: 'UNPLANNED',
          sourceActivityId: externalActivityId,
          discipline,
          subtype: stravaType ?? null,
          title,
          plannedDurationMinutes: durationMinutes,
          plannedDistanceKm: distanceKm,
          distanceMeters: typeof distanceMeters === 'number' ? distanceMeters : null,
          status: nextStatus,
        } as any,
        select: { id: true },
      });

      await prisma.completedActivity.update({
        where: { id: completed.id },
        data: { calendarItemId: item.id },
      });

      summary.createdCalendarItems += 1;
      calendarItemId = item.id;
    }
  }
}

export async function syncStravaForConnections(
  connections: StravaConnectionEntry[],
  options?: {
    forceDays?: number | null;
    overrideAfterUnixSeconds?: number;
    deep?: boolean;
    deepConcurrency?: number;
  }
): Promise<PollSummary> {
  const forceDays = options?.forceDays ?? null;
  const deep = options?.deep ?? false;
  const deepConcurrency = options?.deepConcurrency ?? 3;

  const summary: PollSummary = {
    polledAthletes: 0,
    fetched: 0,
    created: 0,
    updated: 0,
    matched: 0,
    createdCalendarItems: 0,
    skippedExisting: 0,
    errors: [],
  };

  for (const entry of connections) {
    summary.polledAthletes += 1;

    try {
      const refreshed = await refreshStravaTokenIfNeeded(entry.connection);

      const now = new Date();
      const lastSyncAt: Date | null = refreshed.lastSyncAt ? new Date(refreshed.lastSyncAt) : null;

      const lookbackMs = 14 * 24 * 60 * 60 * 1000;
      const bufferMs = 2 * 60 * 60 * 1000;

      const effectiveLookbackMs = forceDays ? forceDays * 24 * 60 * 60 * 1000 : lookbackMs;

      const baseMs =
        forceDays
          ? now.getTime() - effectiveLookbackMs
          : lastSyncAt
            ? lastSyncAt.getTime()
            : now.getTime() - effectiveLookbackMs;

      const afterDate = new Date(baseMs - bufferMs);
      const afterUnixSeconds =
        typeof options?.overrideAfterUnixSeconds === 'number'
          ? options.overrideAfterUnixSeconds
          : Math.max(0, Math.floor(afterDate.getTime() / 1000));

      const activities = await fetchRecentActivities(refreshed.accessToken, afterUnixSeconds);

      const effectiveActivities = deep
        ? await mapWithConcurrency(
            activities,
            deepConcurrency,
            async (activity) => await fetchActivityById(refreshed.accessToken, String(activity.id))
          )
        : activities;

      await ingestActivities(
        {
          ...entry,
          connection: {
            ...refreshed,
            lastSyncAt: refreshed.lastSyncAt,
          },
        },
        effectiveActivities,
        summary
      );

      await prisma.stravaConnection.update({
        where: { id: refreshed.id },
        data: { lastSyncAt: new Date() },
      });
    } catch (error: any) {
      summary.errors.push({
        athleteId: entry.athleteId,
        message: error instanceof Error ? error.message : 'Strava sync failed.',
      });

      if (error?.status === 429 || error?.code === 'STRAVA_RATE_LIMITED') {
        break;
      }
    }
  }

  return summary;
}

async function syncStravaActivityByIdForEntry(entry: StravaConnectionEntry, activityId: string): Promise<PollSummary> {
  const summary: PollSummary = {
    polledAthletes: 1,
    fetched: 0,
    created: 0,
    updated: 0,
    matched: 0,
    createdCalendarItems: 0,
    skippedExisting: 0,
    errors: [],
  };

  try {
    const refreshed = await refreshStravaTokenIfNeeded(entry.connection);
    const activity = await fetchActivityById(refreshed.accessToken, activityId);
    await ingestActivities({ ...entry, connection: refreshed }, [activity], summary);

    await prisma.stravaConnection.update({
      where: { id: refreshed.id },
      data: { lastSyncAt: new Date() },
    });
  } catch (error: any) {
    summary.errors.push({
      athleteId: entry.athleteId,
      message: error instanceof Error ? error.message : 'Strava sync failed.',
    });
  }

  return summary;
}

export async function syncStravaActivityById(params: {
  athleteId: string;
  stravaActivityId: string;
}): Promise<PollSummary> {
  const athlete = await prisma.athleteProfile.findUnique({
    where: { userId: params.athleteId },
    select: {
      userId: true,
      coachId: true,
      user: { select: { timezone: true } },
      stravaConnection: {
        select: {
          id: true,
          accessToken: true,
          refreshToken: true,
          expiresAt: true,
          scope: true,
          lastSyncAt: true,
        },
      },
    },
  });

  const connection = athlete?.stravaConnection;
  if (!athlete || !connection) {
    throw new ApiError(404, 'STRAVA_CONNECTION_NOT_FOUND', 'No Strava connection found for athlete.');
  }

  const entry: StravaConnectionEntry = {
    athleteId: athlete.userId,
    athleteTimezone: athlete.user?.timezone ?? 'UTC',
    coachId: athlete.coachId,
    connection: connection as any,
  };

  return syncStravaActivityByIdForEntry(entry, params.stravaActivityId);
}
