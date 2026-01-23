import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { buildIcsCalendar } from '@/lib/ical';
import { calendarItemDateToDayKey, dayKeyToUtcMidnight, zonedDayTimeToUtc } from '@/lib/zoned-time';
import { getTodayDayKey, addDaysToDayKey } from '@/lib/day-key';
import { isValidIanaTimeZone } from '@/lib/timezones';

export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'Australia/Brisbane';
const DEFAULT_PAST_DAYS = 90;
const DEFAULT_FUTURE_DAYS = 180;
const MAX_RANGE_DAYS = 365;
const DEFAULT_DURATION_SEC = 60 * 60;

const rateLimitState = new Map<string, { count: number; resetAtMs: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

function clampRangeDays(value: number | null, fallback: number): number {
  if (!Number.isFinite(value) || !value) return fallback;
  return Math.min(MAX_RANGE_DAYS, Math.max(1, Math.floor(value)));
}

function getBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!raw) return 'https://coach-kit.vercel.app';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw.replace(/\/$/, '');
  return `https://${raw.replace(/\/$/, '')}`;
}

function getBaseUrlFromRequest(request: NextRequest): string | null {
  const origin = request.nextUrl.origin?.trim();
  if (!origin || origin === 'null') return null;
  return origin.replace(/\/$/, '');
}

function rateLimitOrNull(token: string): NextResponse | null {
  const now = Date.now();
  const key = token;

  const current = rateLimitState.get(key);
  if (!current || current.resetAtMs <= now) {
    rateLimitState.set(key, { count: 1, resetAtMs: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }

  current.count += 1;
  if (current.count <= RATE_LIMIT_MAX) return null;

  const retryAfterSec = Math.max(1, Math.ceil((current.resetAtMs - now) / 1000));
  return new NextResponse('Too many requests.', {
    status: 429,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, max-age=0',
      'Retry-After': String(retryAfterSec),
    },
  });
}

function unauthorizedResponse(): NextResponse {
  return new NextResponse('Unauthorized calendar token.', {
    status: 401,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, max-age=0',
    },
  });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim() || '';
  if (!token) return unauthorizedResponse();

  const limited = rateLimitOrNull(token);
  if (limited) return limited;

  const athleteProfile = await prisma.athleteProfile.findUnique({
    where: { icalToken: token },
    select: {
      userId: true,
      user: { select: { timezone: true } },
    },
  });

  if (!athleteProfile) {
    return unauthorizedResponse();
  }

  const timeZoneRaw = athleteProfile.user?.timezone ?? DEFAULT_TZ;
  const timeZone = isValidIanaTimeZone(timeZoneRaw) ? timeZoneRaw : DEFAULT_TZ;

  const pastDays = clampRangeDays(
    request.nextUrl.searchParams.get('pastDays') ? Number(request.nextUrl.searchParams.get('pastDays')) : null,
    DEFAULT_PAST_DAYS
  );
  const futureDays = clampRangeDays(
    request.nextUrl.searchParams.get('futureDays') ? Number(request.nextUrl.searchParams.get('futureDays')) : null,
    DEFAULT_FUTURE_DAYS
  );

  const todayKey = getTodayDayKey(timeZone);
  const fromKey = addDaysToDayKey(todayKey, -pastDays);
  const toKey = addDaysToDayKey(todayKey, futureDays);

  const fromUtc = dayKeyToUtcMidnight(fromKey);
  const toUtc = dayKeyToUtcMidnight(toKey);

  const items = await prisma.calendarItem.findMany({
    where: {
      athleteId: athleteProfile.userId,
      deletedAt: null,
      date: { gte: fromUtc, lte: toUtc },
      status: {
        in: ['PLANNED', 'SKIPPED', 'MODIFIED', 'COMPLETED_MANUAL', 'COMPLETED_SYNCED', 'COMPLETED_SYNCED_DRAFT'],
      },
    },
    orderBy: [{ date: 'asc' }, { plannedStartTimeLocal: 'asc' }],
    select: {
      id: true,
      date: true,
      plannedStartTimeLocal: true,
      status: true,
      discipline: true,
      title: true,
      workoutDetail: true,
      plannedDurationMinutes: true,
      completedActivities: {
        orderBy: { startTime: 'desc' },
        take: 1,
        select: {
          startTime: true,
          durationMinutes: true,
        },
      },
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim()
    ? getBaseUrl()
    : (getBaseUrlFromRequest(request) ?? getBaseUrl());

  const events = items.map((item) => {
    const latest = item.completedActivities[0] ?? null;

    const dayKey = calendarItemDateToDayKey(item.date, timeZone);

    const isCompleted =
      item.status === 'COMPLETED_MANUAL' || item.status === 'COMPLETED_SYNCED' || item.status === 'COMPLETED_SYNCED_DRAFT';

    const startUtc =
      isCompleted && latest?.startTime
        ? new Date(latest.startTime)
        : item.plannedStartTimeLocal
          ? zonedDayTimeToUtc(dayKey, item.plannedStartTimeLocal, timeZone)
          : zonedDayTimeToUtc(dayKey, '00:00', timeZone);

    const durationSec =
      (isCompleted && latest?.durationMinutes ? latest.durationMinutes * 60 : null) ??
      (item.plannedDurationMinutes ? item.plannedDurationMinutes * 60 : null) ??
      DEFAULT_DURATION_SEC;

    const endUtc = new Date(startUtc.getTime() + durationSec * 1000);

    const statusLabel =
      item.status === 'SKIPPED'
        ? 'SKIPPED'
        : isCompleted
          ? 'COMPLETED'
          : item.status === 'MODIFIED'
            ? 'PLANNED'
            : 'PLANNED';

    const detail = item.workoutDetail?.trim() || '';
    const url = `${baseUrl}/athlete/workouts/${item.id}`;

    const descriptionLines = [`Status: ${statusLabel}`];
    if (detail) descriptionLines.push('', detail);
    descriptionLines.push('', url);

    return {
      uid: `coachkit-${item.id}@coachkit`,
      dtStartUtc: startUtc,
      dtEndUtc: endUtc,
      summary: `${item.discipline} — ${item.title}`,
      description: descriptionLines.join('\n'),
    };
  });

  const body = buildIcsCalendar({
    timeZone,
    calName: 'CoachKit Workouts',
    events,
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=60',
    },
  });
}
