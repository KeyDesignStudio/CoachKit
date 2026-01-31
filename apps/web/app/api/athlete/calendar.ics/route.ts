import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { buildIcsCalendar } from '@/lib/ical';
import { dayKeyToUtcMidnight, zonedDayTimeToUtc } from '@/lib/zoned-time';
import { addDaysToDayKey, getTodayDayKey, isDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';
import { isValidIanaTimeZone } from '@/lib/timezones';
import { buildIcalEventsForCalendarItems, filterCalendarItemsForLocalDayRange } from '@/lib/calendar-ical-feed';

export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'Australia/Brisbane';
const DEFAULT_PAST_DAYS = 90;
const DEFAULT_FUTURE_DAYS = 180;
const MAX_RANGE_DAYS = 365;

const rateLimitState = new Map<string, { count: number; resetAtMs: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

function clampRangeDays(value: number | null, fallback: number): number {
  if (!Number.isFinite(value) || !value) return fallback;
  return Math.min(MAX_RANGE_DAYS, Math.max(1, Math.floor(value)));
}

function getExplicitRangeOrNull(request: NextRequest): { fromKey: string; toKey: string } | null {
  const fromRaw = request.nextUrl.searchParams.get('from')?.trim() ?? '';
  const toRaw = request.nextUrl.searchParams.get('to')?.trim() ?? '';
  if (!fromRaw && !toRaw) return null;

  if (!isDayKey(fromRaw) || !isDayKey(toRaw)) {
    throw new Error('from/to must be YYYY-MM-DD');
  }

  const fromDate = parseDayKeyToUtcDate(fromRaw);
  const toDate = parseDayKeyToUtcDate(toRaw);
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error('from must be before or equal to to');
  }

  const diffDays = Math.floor((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (diffDays > MAX_RANGE_DAYS) {
    throw new Error(`Range too large (max ${MAX_RANGE_DAYS} days)`);
  }

  return { fromKey: fromRaw, toKey: toRaw };
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
  try {
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

    const explicit = getExplicitRangeOrNull(request);

    const pastDays = clampRangeDays(
      request.nextUrl.searchParams.get('pastDays') ? Number(request.nextUrl.searchParams.get('pastDays')) : null,
      DEFAULT_PAST_DAYS
    );
    const futureDays = clampRangeDays(
      request.nextUrl.searchParams.get('futureDays') ? Number(request.nextUrl.searchParams.get('futureDays')) : null,
      DEFAULT_FUTURE_DAYS
    );

    const todayKey = getTodayDayKey(timeZone);
    const fromKey = explicit?.fromKey ?? addDaysToDayKey(todayKey, -pastDays);
    const toKey = explicit?.toKey ?? addDaysToDayKey(todayKey, futureDays);

    // Compute UTC instant boundaries based on athlete-local day boundaries.
    // Range is inclusive of start, exclusive of end.
    const startUtc = zonedDayTimeToUtc(fromKey, '00:00', timeZone);
    const endUtc = zonedDayTimeToUtc(addDaysToDayKey(toKey, 1), '00:00', timeZone);

    // Candidate range on the date-only column: widened to avoid dropping near-midnight local items.
    const candidateFromUtc = dayKeyToUtcMidnight(addDaysToDayKey(fromKey, -1));
    const candidateToUtc = dayKeyToUtcMidnight(addDaysToDayKey(toKey, 1));

    const items = await prisma.calendarItem.findMany({
      where: {
        athleteId: athleteProfile.userId,
        deletedAt: null,
        date: { gte: candidateFromUtc, lte: candidateToUtc },
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

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim() ? getBaseUrl() : (getBaseUrlFromRequest(request) ?? getBaseUrl());

    const filteredItems = filterCalendarItemsForLocalDayRange({
      items,
      fromDayKey: fromKey,
      toDayKey: toKey,
      timeZone,
      utcRange: { startUtc, endUtc },
    });

    const events = buildIcalEventsForCalendarItems({
      items: filteredItems,
      timeZone,
      baseUrl,
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
  } catch (error: any) {
    return new NextResponse(`Bad request: ${error?.message ?? 'invalid parameters'}`, {
      status: 400,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, max-age=0',
      },
    });
  }
}
