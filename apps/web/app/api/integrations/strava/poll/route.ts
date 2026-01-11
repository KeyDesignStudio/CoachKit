import { NextRequest } from 'next/server';
import { CalendarItemStatus, CompletionSource, UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { assertCoachOwnsAthlete, requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

type PollSummary = {
  polledAthletes: number;
  fetched: number;
  created: number;
  updated: number;
  matched: number;
  skippedExisting: number;
  errors: Array<{ athleteId?: string; message: string }>;
};

type StravaActivity = {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  start_date?: string; // UTC
  start_date_local?: string; // local
  elapsed_time?: number; // seconds
  moving_time?: number; // seconds
  distance?: number; // meters
  average_speed?: number; // meters per second
  average_heartrate?: number;
  max_heartrate?: number;
  timezone?: string;
};

function mapStravaDiscipline(activity: StravaActivity) {
  const raw = (activity.sport_type || activity.type || '').toLowerCase();

  if (raw.includes('run')) return 'RUN';
  if (raw.includes('ride') || raw.includes('bike')) return 'BIKE';
  if (raw.includes('swim')) return 'SWIM';

  return 'OTHER';
}

function secondsToMinutesRounded(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
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

function toNaiveUtcDateTimeFromZone(instant: Date, timeZone: string) {
  // The app stores "local time" by setting UTC fields (see combineDateWithLocalTime).
  // Convert a real instant into that same representation.
  const p = getZonedParts(instant, timeZone);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, 0, 0));
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

async function refreshStravaTokenIfNeeded(connection: any) {
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
  });

  return updated;
}

async function fetchRecentActivities(accessToken: string, afterUnixSeconds: number) {
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

async function matchAndLinkCalendarItem(params: {
  athleteId: string;
  activityDateOnly: Date;
  activityMinutes: number;
  discipline: string;
  completedActivityId: string;
  confirmedAt: Date | null;
}) {
  const { athleteId, activityDateOnly, activityMinutes, discipline, completedActivityId, confirmedAt } = params;

  const rangeStart = addDaysUtc(activityDateOnly, -1);
  const rangeEnd = addDaysUtc(activityDateOnly, 1);

  const items = await prisma.calendarItem.findMany({
    where: {
      athleteId,
      discipline,
      date: { gte: rangeStart, lte: rangeEnd },
      status: { in: [CalendarItemStatus.PLANNED, CalendarItemStatus.MODIFIED] },
    },
    select: {
      id: true,
      date: true,
      plannedStartTimeLocal: true,
      status: true,
    },
    orderBy: [{ date: 'asc' }, { plannedStartTimeLocal: 'asc' }],
    take: 25,
  });

  if (!items.length) return { matched: false as const };

  const targetKey = activityDateOnly.toISOString().slice(0, 10);

  const candidates = items
    .map((item) => {
      const plannedMinutes = item.plannedStartTimeLocal ? parseTimeToMinutes(item.plannedStartTimeLocal) : null;
      const diff = plannedMinutes === null ? null : Math.abs(plannedMinutes - activityMinutes);
      const dayKey = item.date.toISOString().slice(0, 10);
      const dayDistance = dayKey === targetKey ? 0 : 1;
      return { item, plannedMinutes, diff, dayDistance };
    })
    .filter((c) => c.dayDistance <= 1);

  if (!candidates.length) return { matched: false as const };

  // Choose best candidate.
  candidates.sort((a, b) => {
    if (a.dayDistance !== b.dayDistance) return a.dayDistance - b.dayDistance;

    const aHas = a.diff !== null;
    const bHas = b.diff !== null;

    if (aHas && bHas) return (a.diff as number) - (b.diff as number);
    if (aHas !== bHas) return aHas ? -1 : 1;

    // No plannedStartTimeLocal: choose earliest planned item.
    const aMin = a.plannedMinutes ?? Number.POSITIVE_INFINITY;
    const bMin = b.plannedMinutes ?? Number.POSITIVE_INFINITY;
    return aMin - bMin;
  });

  const match = candidates[0]?.item;
  if (!match) return { matched: false as const };

  const nextStatus = confirmedAt ? CalendarItemStatus.COMPLETED_SYNCED : CalendarItemStatus.COMPLETED_SYNCED_DRAFT;

  await prisma.$transaction([
    prisma.calendarItem.update({
      where: { id: match.id },
      data: { status: nextStatus },
    }),
    prisma.completedActivity.update({
      where: { id: completedActivityId },
      data: { calendarItemId: match.id },
    }),
  ]);

  return { matched: true as const, calendarItemId: match.id };
}

async function ensureCalendarItemStatusForSyncedCompletion(params: {
  calendarItemId: string;
  confirmedAt: Date | null;
}) {
  const { calendarItemId, confirmedAt } = params;

  const item = await prisma.calendarItem.findUnique({
    where: { id: calendarItemId },
    select: { status: true },
  });

  if (!item) return;

  if (!confirmedAt) {
    // Unconfirmed Strava matches must remain athlete-editable and not coach-visible.
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

  // Confirmed completions should be committed.
  if (item.status === CalendarItemStatus.COMPLETED_SYNCED_DRAFT) {
    await prisma.calendarItem.update({
      where: { id: calendarItemId },
      data: { status: CalendarItemStatus.COMPLETED_SYNCED },
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();

    const summary: PollSummary = {
      polledAthletes: 0,
      fetched: 0,
      created: 0,
      updated: 0,
      matched: 0,
      skippedExisting: 0,
      errors: [],
    };

    const url = new URL(request.url);
    const requestedAthleteId = url.searchParams.get('athleteId');
    const forceDaysParam = url.searchParams.get('forceDays');
    const requestedForceDays = forceDaysParam ? Number(forceDaysParam) : null;
    const forceDays =
      requestedForceDays && Number.isFinite(requestedForceDays)
        ? Math.min(30, Math.max(1, Math.floor(requestedForceDays)))
        : null;

    let connections: Array<{
      athleteId: string;
      athleteTimezone: string;
      connection: any;
    }> = [];

    if (user.role === UserRole.ATHLETE) {
      const connection = await prisma.stravaConnection.findUnique({
        where: { athleteId: user.id },
      });

      if (!connection) {
        return success({ ...summary, polledAthletes: 0 });
      }

      connections = [{ athleteId: user.id, athleteTimezone: user.timezone, connection }];
    } else if (user.role === UserRole.COACH) {
      if (requestedAthleteId) {
        const athlete = await assertCoachOwnsAthlete(requestedAthleteId, user.id);
        const connection = await prisma.stravaConnection.findUnique({
          where: { athleteId: athlete.userId },
        });

        if (!connection) {
          return success({ ...summary, polledAthletes: 0 });
        }

        connections = [{ athleteId: athlete.userId, athleteTimezone: athlete.user.timezone, connection }];
      } else {
        const athletes = await prisma.athleteProfile.findMany({
          where: {
            coachId: user.id,
            stravaConnection: { isNot: null },
          },
          select: {
            userId: true,
            user: { select: { timezone: true } },
            stravaConnection: true,
          },
        });

        connections = athletes
          .filter((a) => Boolean(a.stravaConnection))
          .map((a) => ({ athleteId: a.userId, athleteTimezone: a.user.timezone, connection: a.stravaConnection }));
      }
    } else {
      throw new ApiError(403, 'FORBIDDEN', 'Access denied.');
    }

    for (const entry of connections) {
      summary.polledAthletes += 1;

      try {
        const refreshed = await refreshStravaTokenIfNeeded(entry.connection);

        const now = new Date();
        const lastSyncAt: Date | null = refreshed.lastSyncAt ? new Date(refreshed.lastSyncAt) : null;

        const lookbackMs = 14 * 24 * 60 * 60 * 1000;
        const bufferMs = 2 * 60 * 60 * 1000;

        const effectiveLookbackMs =
          user.role === UserRole.ATHLETE && forceDays ? forceDays * 24 * 60 * 60 * 1000 : lookbackMs;

        const baseMs =
          user.role === UserRole.ATHLETE && forceDays
            ? now.getTime() - effectiveLookbackMs
            : lastSyncAt
              ? lastSyncAt.getTime()
              : now.getTime() - effectiveLookbackMs;

        const afterDate = new Date(baseMs - bufferMs);
        const afterUnixSeconds = Math.max(0, Math.floor(afterDate.getTime() / 1000));

        const activities = await fetchRecentActivities(refreshed.accessToken, afterUnixSeconds);
        summary.fetched += activities.length;

        for (const activity of activities) {
          if (!activity?.id || !activity.start_date || !activity.elapsed_time) {
            continue;
          }

          const externalActivityId = String(activity.id);
          const discipline = mapStravaDiscipline(activity);
          const startInstant = new Date(activity.start_date);
          const startTime = toNaiveUtcDateTimeFromZone(startInstant, entry.athleteTimezone);
          const activityDateOnly = toNaiveUtcDateOnlyFromZone(startInstant, entry.athleteTimezone);
          const activityMinutes = toZonedMinutes(startInstant, entry.athleteTimezone);
          const durationMinutes = secondsToMinutesRounded(activity.elapsed_time);
          const distanceKm = typeof activity.distance === 'number' ? metersToKm(activity.distance) : null;

          const stravaType = activity.sport_type ?? activity.type;
          const avgSpeedMps = typeof activity.average_speed === 'number' ? activity.average_speed : undefined;
          const avgHr = typeof activity.average_heartrate === 'number' ? Math.round(activity.average_heartrate) : undefined;
          const maxHr = typeof activity.max_heartrate === 'number' ? Math.round(activity.max_heartrate) : undefined;

          const stravaMetrics = compactObject({
            name: activity.name,
            type: stravaType,
            startDateLocal: activity.start_date_local,
            startDateUtc: activity.start_date,
            avgSpeedMps,
            avgPaceSecPerKm: discipline === 'RUN' ? deriveAvgPaceSecPerKm(avgSpeedMps) : undefined,
            avgHr,
            maxHr,
          });

          // Create or update idempotently.
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
                // Notes are reserved for the athlete's own log.
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
            if (error?.code !== 'P2002') {
              throw error;
            }

            const existing = await prisma.completedActivity.findUnique({
              where: {
                source_externalActivityId: {
                  source: CompletionSource.STRAVA,
                  externalActivityId,
                },
              },
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
              new Date(existing.startTime).getTime() === startTime.getTime()
            ) {
              completed = existing;
              summary.skippedExisting += 1;
            } else {
              completed = await prisma.completedActivity.update({
                where: {
                  source_externalActivityId: {
                    source: CompletionSource.STRAVA,
                    externalActivityId,
                  },
                },
                data: {
                  startTime,
                  durationMinutes,
                  distanceKm,
                  // Preserve any existing athlete notes; Strava fields belong in metricsJson.
                  metricsJson: {
                    ...(typeof existing?.metricsJson === 'object' && existing?.metricsJson ? (existing.metricsJson as any) : {}),
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

          // Attempt to match to planned CalendarItem.
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

          // Self-heal status in case older runs set it incorrectly (e.g. backfill over existing links).
          if (calendarItemId) {
            await ensureCalendarItemStatusForSyncedCompletion({
              calendarItemId,
              confirmedAt: completed.confirmedAt ?? null,
            });
          }

        }

        await prisma.stravaConnection.update({
          where: { id: refreshed.id },
          data: { lastSyncAt: new Date() },
        });
      } catch (error: any) {
        summary.errors.push({
          athleteId: entry.athleteId,
          message: error instanceof Error ? error.message : 'Strava poll failed.',
        });

        // If we hit Strava rate limiting, stop to be safe.
        if (error?.status === 429 || error?.code === 'STRAVA_RATE_LIMITED') {
          break;
        }
      }
    }

    return success(summary);
  } catch (error) {
    return handleError(error);
  }
}
