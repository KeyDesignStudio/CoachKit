import { CalendarItemStatus, CompletionSource } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { mapWithConcurrency } from '@/lib/concurrency';
import { addDaysToDayKey, getLocalDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';
import { upsertExternalCompletedActivity } from '@/lib/external-sync/ingest-core';
import { stravaProviderAdapter } from '@/lib/external-sync/adapters/strava';

export type PollSummary = {
  polledAthletes: number;
  fetched: number;
  inWindow: number;
  created: number;
  updated: number;
  matched: number;
  plannedSessionsMatched: number;
  createdCalendarItems: number;
  calendarItemsCreated: number;
  calendarItemsUpdated: number;
  linkedCalendarItems: number;
  existingCalendarItemLinks: number;
  clearedDeletedCalendarItemLinks: number;
  skippedExisting: number;
  skippedByReason: Record<string, number>;
  errors: Array<{ athleteId?: string; message: string }>;
};

function inc(map: Record<string, number>, key: string, amount = 1) {
  map[key] = (map[key] ?? 0) + amount;
}

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

function minutesToTimeString(totalMinutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.floor(totalMinutes)));
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseTimeToMinutes(value: string) {
  const [hh, mm] = value.split(':');
  const hours = Number(hh);
  const minutes = Number(mm);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function formatLocalDateTime(instant: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(instant);
}

function isStravaSyncDebugEnabled() {
  return process.env.STRAVA_SYNC_DEBUG === '1' || process.env.STRAVA_SYNC_DEBUG === 'true';
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

async function fetchRecentActivities(accessToken: string, afterUnixSeconds: number, scenarioOverride?: string) {
  if (process.env.STRAVA_STUB === 'true' && process.env.DISABLE_AUTH === 'true') {
    const scenario = scenarioOverride ?? process.env.STRAVA_STUB_SCENARIO ?? '';
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

    const activities: StravaActivity[] = scenario === 'timezone-daykey'
      ? [
          mk(2001, 'Fixture Swim Planned', 'Swim', new Date('2026-02-05T05:35:00.000Z'), 3600, 2000),
          mk(2002, 'Fixture Bike Unplanned', 'Ride', new Date('2026-02-06T08:06:00.000Z'), 5400, 40000),
          // Midnight-boundary case: just after midnight local (Brisbane).
          mk(2003, 'Fixture Late Night Run', 'Run', new Date('2026-02-05T14:30:00.000Z'), 1800, 5000),
        ]
      : [
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

async function fetchActivityById(accessToken: string, activityId: string, scenarioOverride?: string) {
  if (process.env.STRAVA_STUB === 'true' && process.env.DISABLE_AUTH === 'true') {
    const activities = await fetchRecentActivities(accessToken, 0, scenarioOverride);
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
  activityDayKey: string;
  activityMinutes: number;
  athleteTimezone: string;
  discipline: string;
  completedActivityId: string;
  confirmedAt: Date | null;
}) {
  const { athleteId, activityDayKey, activityMinutes, athleteTimezone, discipline, completedActivityId, confirmedAt } = params;

  function normalizeDiscipline(value: string) {
    const upper = String(value ?? '').trim().toUpperCase();
    if (upper === 'STR') return 'STRENGTH';
    return upper;
  }

  function minutesDiffAcrossDays(plannedMinutes: number, actualMinutes: number, dayDiff: number) {
    if (dayDiff === 0) return Math.abs(actualMinutes - plannedMinutes);
    if (dayDiff === 1) return Math.abs((plannedMinutes + 1440) - actualMinutes);
    if (dayDiff === -1) return Math.abs((actualMinutes + 1440) - plannedMinutes);
    return Math.abs(actualMinutes - plannedMinutes);
  }

  function dayKeyDiff(a: string, b: string) {
    const aDate = parseDayKeyToUtcDate(a);
    const bDate = parseDayKeyToUtcDate(b);
    return Math.round((aDate.getTime() - bDate.getTime()) / (24 * 60 * 60 * 1000));
  }

  const midnightToleranceMinutes = 4 * 60;
  const isNearMidnight = activityMinutes <= midnightToleranceMinutes || activityMinutes >= 1440 - midnightToleranceMinutes;
  const maxTimeWindowMinutes = 6 * 60;

  function scoreCandidate(candidate: { item: { discipline: string; plannedStartTimeLocal: string | null; date: Date } }) {
    const itemDiscipline = normalizeDiscipline(candidate.item.discipline);
    const activityDiscipline = normalizeDiscipline(discipline);
    const disciplineScore = itemDiscipline === activityDiscipline ? 50 : 0;

    const plannedMinutes = candidate.item.plannedStartTimeLocal
      ? parseTimeToMinutes(candidate.item.plannedStartTimeLocal)
      : null;
    const candidateDayKey = getLocalDayKey(candidate.item.date, athleteTimezone);
    const dayDiff = dayKeyDiff(candidateDayKey, activityDayKey);
    const dayDistance = Math.abs(dayDiff);

    if (dayDistance > 1) {
      return { total: -1, plannedMinutes, timeDiff: null, dayDiff, dayKey: candidateDayKey };
    }

    if (dayDistance === 1 && !isNearMidnight) {
      return { total: -1, plannedMinutes, timeDiff: null, dayDiff, dayKey: candidateDayKey };
    }

    const timeDiff = plannedMinutes == null ? null : minutesDiffAcrossDays(plannedMinutes, activityMinutes, dayDiff);
    if (timeDiff != null && timeDiff > maxTimeWindowMinutes) {
      return { total: -1, plannedMinutes, timeDiff, dayDiff, dayKey: candidateDayKey };
    }

    // Prefer closer times and avoid weak auto-links.
    // 0 min => 40 points, 6h+ => 0 points
    const timeScore = timeDiff == null ? 0 : Math.max(0, Math.round(40 * (1 - Math.min(timeDiff, maxTimeWindowMinutes) / maxTimeWindowMinutes)));
    const dayScore = dayDistance === 0 ? 20 : 10;

    const total = disciplineScore + timeScore + dayScore;

    return {
      total,
      plannedMinutes,
      timeDiff,
      dayDiff,
      dayKey: candidateDayKey,
    };
  }

  const rangeStart = parseDayKeyToUtcDate(addDaysToDayKey(activityDayKey, -1));
  const rangeEnd = parseDayKeyToUtcDate(addDaysToDayKey(activityDayKey, 1));

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
        dayDiff: s.dayDiff,
        timeDiff: s.timeDiff,
        dayKey: s.dayKey,
      };
    })
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0] ?? null;
  const second = scored[1] ?? null;
  if (!best) return { matched: false as const };

  // Require a strong match and avoid ambiguous auto-links.
  // If it's close, prefer creating an unplanned STRAVA item instead.
  const minScoreToMatch = 70;
  const minLead = 5;
  if (best.score < minScoreToMatch) return { matched: false as const };
  if (second && best.score - second.score < minLead) return { matched: false as const };

  const nextStatus = confirmedAt ? CalendarItemStatus.COMPLETED_SYNCED : CalendarItemStatus.COMPLETED_SYNCED_DRAFT;

  const confidence = best.score >= 90 ? 'HIGH' : best.score >= 80 ? 'MEDIUM' : 'LOW';

  await prisma.$transaction([
    prisma.calendarItem.update({
      where: { id: best.item.id },
      data: { status: nextStatus },
    }),
    prisma.completedActivity.update({
      where: { id: completedActivityId },
      data: {
        calendarItemId: best.item.id,
        matchConfidence: confidence,
        matchScore: best.score,
        matchDayDiff: best.dayDiff ?? null,
        matchTimeDiffMinutes: typeof best.timeDiff === 'number' ? Math.round(best.timeDiff) : null,
      },
    }),
  ]);

  return {
    matched: true as const,
    calendarItemId: best.item.id,
    debug: {
      confidence,
      score: best.score,
      dayDiff: best.dayDiff ?? null,
      timeDiffMinutes: typeof best.timeDiff === 'number' ? Math.round(best.timeDiff) : null,
      matchedDayKey: best.dayKey ?? null,
      plannedStartTimeLocal: best.item.plannedStartTimeLocal ?? null,
    },
  };
}

async function applySyncedCompletionToCalendarItem(params: {
  calendarItemId: string;
  confirmedAt: Date | null;
  activityDayKey: string;
  activityMinutes: number;
}): Promise<{ updated: boolean }> {
  const { calendarItemId, confirmedAt, activityDayKey, activityMinutes } = params;

  const item = await prisma.calendarItem.findUnique({
    where: { id: calendarItemId },
    select: { status: true, date: true, plannedStartTimeLocal: true, origin: true },
  });

  if (!item) return { updated: false };
  if (item.status === CalendarItemStatus.COMPLETED_MANUAL) return { updated: false };

  const nextStatus = confirmedAt ? CalendarItemStatus.COMPLETED_SYNCED : CalendarItemStatus.COMPLETED_SYNCED_DRAFT;
  const nextDate = parseDayKeyToUtcDate(activityDayKey);
  const nextStartTimeLocal = minutesToTimeString(activityMinutes);
  const currentDayKey = item.date.toISOString().slice(0, 10);
  const isNearMidnight = activityMinutes <= 4 * 60 || activityMinutes >= 20 * 60;

  const update: Record<string, any> = {};

  if (
    item.status === CalendarItemStatus.PLANNED ||
    item.status === CalendarItemStatus.MODIFIED ||
    item.status === CalendarItemStatus.COMPLETED_SYNCED ||
    item.status === CalendarItemStatus.COMPLETED_SYNCED_DRAFT
  ) {
    if (item.status !== nextStatus) update.status = nextStatus;
  }

  if (item.origin == null || item.origin === 'STRAVA') {
    if (currentDayKey !== activityDayKey && (!isNearMidnight || item.origin === 'STRAVA')) {
      update.date = nextDate;
    }
    if ((item.plannedStartTimeLocal ?? null) !== nextStartTimeLocal) {
      update.plannedStartTimeLocal = nextStartTimeLocal;
    }
  }

  if (Object.keys(update).length === 0) return { updated: false };

  await prisma.calendarItem.update({
    where: { id: calendarItemId },
    data: update,
  });

  return { updated: true };
}

async function ingestActivities(entry: StravaConnectionEntry, activities: StravaActivity[], summary: PollSummary) {
  summary.fetched += activities.length;
  summary.inWindow += activities.length;

  for (const activity of activities) {
    if (!activity?.id || !activity.start_date || !activity.elapsed_time) {
      inc(summary.skippedByReason, 'invalid_payload');
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
      inc(summary.skippedByReason, 'tombstoned');
      continue;
    }

    const normalized = stravaProviderAdapter.normalize(activity, {
      athleteTimezone: entry.athleteTimezone,
    });
    if (!normalized) {
      inc(summary.skippedByReason, 'invalid_payload');
      continue;
    }

    const activityDayKey = normalized.activityDayKey;
    const activityDateOnly = parseDayKeyToUtcDate(activityDayKey);
    const activityMinutes = normalized.activityMinutes;
    const durationMinutes = normalized.durationMinutes;
    const distanceKm = normalized.distanceKm;
    const discipline = normalized.discipline;

    if (isStravaSyncDebugEnabled()) {
      console.info('[strava-sync] activity placement', {
        athleteId: entry.athleteId,
        athleteTimezone: entry.athleteTimezone,
        stravaActivityId: externalActivityId,
        startDateUtc: activity.start_date,
        startDateLocal: activity.start_date_local,
        derivedLocalDateTime: formatLocalDateTime(normalized.startTime, entry.athleteTimezone),
        derivedDayKey: activityDayKey,
      });
    }

    const ingest = await upsertExternalCompletedActivity({
      athleteId: entry.athleteId,
      activity: normalized,
    });
    let completed: any = ingest.completed;
    let activityUpdated = false;

    if (ingest.kind === 'created') {
      summary.created += 1;
    } else if (ingest.kind === 'updated') {
      summary.updated += 1;
      activityUpdated = true;
    } else {
      summary.skippedExisting += 1;
      inc(summary.skippedByReason, 'duplicate_no_changes');
    }

    const initialCalendarItemId: string | null = completed?.calendarItemId ?? null;
    let calendarItemId: string | null = initialCalendarItemId;
    let calendarItemUpdated = false;

    if (calendarItemId) {
      if (activityUpdated) {
        calendarItemUpdated = true;
      }
      summary.existingCalendarItemLinks += 1;

      // If the completion is linked to a deleted/missing item (e.g. coach deleted a planned session),
      // clear the link so we can re-link/match and/or create an unplanned STRAVA calendar item.
      const linked = await prisma.calendarItem.findUnique({
        where: { id: calendarItemId },
        select: { id: true, deletedAt: true },
      });

      if (!linked || linked.deletedAt) {
        await prisma.completedActivity.update({
          where: { id: completed.id },
          data: { calendarItemId: null },
          select: { id: true },
        });

        summary.clearedDeletedCalendarItemLinks += 1;
        inc(summary.skippedByReason, 'linked_calendar_item_deleted');
        calendarItemId = null;
      }
    }

    let placementDayKey = activityDayKey;

    if (!calendarItemId) {
      const match = await matchAndLinkCalendarItem({
        athleteId: entry.athleteId,
        activityDayKey,
        activityMinutes,
        athleteTimezone: entry.athleteTimezone,
        discipline,
        completedActivityId: completed.id,
        confirmedAt: completed.confirmedAt ?? null,
      });

      if (match.matched) {
        summary.matched += 1;
        summary.plannedSessionsMatched += 1;
        calendarItemId = match.calendarItemId;
        calendarItemUpdated = true;
        placementDayKey = match.debug?.matchedDayKey ?? activityDayKey;

        if (isStravaSyncDebugEnabled()) {
          console.info('[strava-sync] matched activity', {
            athleteId: entry.athleteId,
            stravaActivityId: externalActivityId,
            calendarItemId: match.calendarItemId,
            match: match.debug ?? null,
          });
        }
      }
    }

    if (calendarItemId) {
      if (typeof completed?.matchDayDiff === 'number') {
        placementDayKey = addDaysToDayKey(activityDayKey, completed.matchDayDiff);
      }
      const placement = await applySyncedCompletionToCalendarItem({
        calendarItemId,
        confirmedAt: completed.confirmedAt ?? null,
        activityDayKey: placementDayKey,
        activityMinutes,
      });

      if (placement.updated) {
        calendarItemUpdated = true;
      }

      if (calendarItemUpdated) {
        summary.calendarItemsUpdated += 1;
      }

      summary.linkedCalendarItems += 1;
    }

    if (!calendarItemId) {
      const nextStatus = completed.confirmedAt ? CalendarItemStatus.COMPLETED_SYNCED : CalendarItemStatus.COMPLETED_SYNCED_DRAFT;

      const plannedStartTimeLocal = minutesToTimeString(activityMinutes);
      const title = normalized.title;

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
          subtype: normalized.subtype ?? null,
          title,
          notes: 'Imported from Strava.',
          plannedDurationMinutes: durationMinutes,
          plannedDistanceKm: distanceKm,
          distanceMeters: (normalized.metrics.distanceMeters as number | undefined) ?? null,
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
          subtype: normalized.subtype ?? null,
          title,
          plannedDurationMinutes: durationMinutes,
          plannedDistanceKm: distanceKm,
          distanceMeters: (normalized.metrics.distanceMeters as number | undefined) ?? null,
          status: nextStatus,
        } as any,
        select: { id: true },
      });

      await prisma.completedActivity.update({
        where: { id: completed.id },
        data: { calendarItemId: item.id },
      });

      summary.createdCalendarItems += 1;
      summary.calendarItemsCreated += 1;
      summary.linkedCalendarItems += 1;
      calendarItemId = item.id;

      if (isStravaSyncDebugEnabled()) {
        console.info('[strava-sync] unplanned activity', {
          athleteId: entry.athleteId,
          stravaActivityId: externalActivityId,
          calendarItemId,
          dayKey: activityDayKey,
          plannedStartTimeLocal,
        });
      }
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
    stubScenario?: string;
  }
): Promise<PollSummary> {
  const forceDays = options?.forceDays ?? null;
  const deep = options?.deep ?? false;
  const deepConcurrency = options?.deepConcurrency ?? 3;

  const summary: PollSummary = {
    polledAthletes: 0,
    fetched: 0,
    inWindow: 0,
    created: 0,
    updated: 0,
    matched: 0,
    plannedSessionsMatched: 0,
    createdCalendarItems: 0,
    calendarItemsCreated: 0,
    calendarItemsUpdated: 0,
    linkedCalendarItems: 0,
    existingCalendarItemLinks: 0,
    clearedDeletedCalendarItemLinks: 0,
    skippedExisting: 0,
    skippedByReason: {},
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

      const activities = await fetchRecentActivities(refreshed.accessToken, afterUnixSeconds, options?.stubScenario);

      const effectiveActivities = deep
        ? await mapWithConcurrency(
            activities,
            deepConcurrency,
            async (activity) => await fetchActivityById(refreshed.accessToken, String(activity.id), options?.stubScenario)
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

async function syncStravaActivityByIdForEntry(
  entry: StravaConnectionEntry,
  activityId: string,
  scenarioOverride?: string
): Promise<PollSummary> {
  const summary: PollSummary = {
    polledAthletes: 1,
    fetched: 0,
    inWindow: 0,
    created: 0,
    updated: 0,
    matched: 0,
    plannedSessionsMatched: 0,
    createdCalendarItems: 0,
    calendarItemsCreated: 0,
    calendarItemsUpdated: 0,
    linkedCalendarItems: 0,
    existingCalendarItemLinks: 0,
    clearedDeletedCalendarItemLinks: 0,
    skippedExisting: 0,
    skippedByReason: {},
    errors: [],
  };

  try {
    const refreshed = await refreshStravaTokenIfNeeded(entry.connection);
    const activity = await fetchActivityById(refreshed.accessToken, activityId, scenarioOverride);
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
  stubScenario?: string;
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

  return syncStravaActivityByIdForEntry(entry, params.stravaActivityId, params.stubScenario);
}
