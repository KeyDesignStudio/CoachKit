import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { syncStravaForConnections, type StravaConnectionEntry } from '@/lib/strava-sync';

export const dynamic = 'force-dynamic';

function cronAuthFailure() {
  return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
}

function isAutosyncEnabled() {
  return process.env.STRAVA_AUTOSYNC_ENABLED !== '0';
}

function requireCronAuth(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Misconfiguration should be visible.
    throw new ApiError(500, 'CRON_SECRET_MISSING', 'CRON_SECRET is not set.');
  }

  const bearer = request.headers.get('authorization');
  const token = bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length).trim() : null;
  const alt = request.headers.get('x-cron-secret');

  const provided = token || alt;
  if (!provided || provided !== expected) {
    return cronAuthFailure();
  }

  return null;
}

function computeAfterUnixSeconds(params: { lastSyncAt: Date | null; now: Date }) {
  const { lastSyncAt, now } = params;
  const minWindowMs = 2 * 24 * 60 * 60 * 1000;
  const maxWindowMs = 14 * 24 * 60 * 60 * 1000;
  const bufferMs = 2 * 60 * 60 * 1000;

  const minStart = new Date(now.getTime() - minWindowMs);
  const maxStart = new Date(now.getTime() - maxWindowMs);

  const base = lastSyncAt ? new Date(Math.max(lastSyncAt.getTime(), minStart.getTime())) : minStart;
  const clamped = new Date(Math.max(base.getTime(), maxStart.getTime()));
  return Math.max(0, Math.floor((clamped.getTime() - bufferMs) / 1000));
}

function computeBackoffMs(attempts: number) {
  const base = 60_000; // 1m
  const max = 6 * 60 * 60_000; // 6h
  const exp = Math.min(8, Math.max(0, attempts));
  return Math.min(max, base * Math.pow(2, exp));
}

async function runCron(request: NextRequest) {
  const authResponse = requireCronAuth(request);
  if (authResponse) return authResponse;

  if (!isAutosyncEnabled()) {
    return NextResponse.json({ ok: true, disabled: true }, { status: 200 });
  }

  const url = new URL(request.url);
  const athleteId = url.searchParams.get('athleteId');

  const now = new Date();
  const maxAthletesPerRun = 20;
  const leaseMs = 10 * 60_000;

  // If no webhook has marked athletes as pending recently, do a small safety sweep
  // to avoid missed webhook events leaving athletes permanently unsynced.
  if (!athleteId) {
    const staleCutoff = new Date(now.getTime() - 12 * 60 * 60_000);
    const stale = await prisma.stravaConnection.findMany({
      where: {
        OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: staleCutoff } }],
      },
      select: { athleteId: true },
      take: 10,
    });

    for (const row of stale) {
      await prisma.stravaSyncIntent.upsert({
        where: { athleteId: row.athleteId },
        create: {
          athleteId: row.athleteId,
          pending: true,
          lastEventAt: now,
        },
        update: {
          pending: true,
          lastEventAt: now,
          nextAttemptAt: null,
        },
      });
    }
  }

  const intents = await prisma.stravaSyncIntent.findMany({
    where: {
      pending: true,
      ...(athleteId ? { athleteId } : {}),
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      ],
    } as any,
    orderBy: { lastEventAt: 'asc' },
    take: maxAthletesPerRun,
    select: {
      athleteId: true,
      attempts: true,
    },
  });

  let processedAthletes = 0;
  let createdCalendarItems = 0;
  let matchedCompletions = 0;
  let skippedDuplicates = 0;
  const errors: Array<{ athleteId: string; message: string }> = [];
  let rateLimited = false;

  for (const intent of intents) {
    // Claim lease.
    const claim = await prisma.stravaSyncIntent.updateMany({
      where: {
        athleteId: intent.athleteId,
        pending: true,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      } as any,
      data: {
        lockedUntil: new Date(now.getTime() + leaseMs),
        lastAttemptAt: now,
        attempts: { increment: 1 },
      },
    });

    if (claim.count !== 1) {
      continue;
    }

    const athlete = await prisma.athleteProfile.findUnique({
      where: { userId: intent.athleteId },
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
      await prisma.stravaSyncIntent.update({
        where: { athleteId: intent.athleteId },
        data: {
          pending: false,
          lockedUntil: null,
          nextAttemptAt: null,
          lastError: null,
        },
      });
      continue;
    }

    const entry: StravaConnectionEntry = {
      athleteId: athlete.userId,
      athleteTimezone: athlete.user?.timezone ?? 'Australia/Brisbane',
      coachId: athlete.coachId,
      connection: connection as any,
    };

    try {
      const afterUnixSeconds = computeAfterUnixSeconds({
        lastSyncAt: connection.lastSyncAt ? new Date(connection.lastSyncAt) : null,
        now,
      });

      const summary = await syncStravaForConnections([entry], { overrideAfterUnixSeconds: afterUnixSeconds });

      processedAthletes += 1;
      createdCalendarItems += summary.createdCalendarItems;
      matchedCompletions += summary.matched;
      skippedDuplicates += summary.skippedExisting;

      await prisma.stravaSyncIntent.update({
        where: { athleteId: intent.athleteId },
        data: {
          pending: false,
          attempts: 0,
          nextAttemptAt: null,
          lockedUntil: null,
          lastError: null,
          lastSuccessAt: new Date(),
        },
      });

      if (summary.errors.some((e) => e.message.toLowerCase().includes('rate limit'))) {
        rateLimited = true;
        break;
      }
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Strava sync failed.';
      errors.push({ athleteId: intent.athleteId, message });

      if (error?.status === 429 || error?.code === 'STRAVA_RATE_LIMITED') {
        rateLimited = true;
      }

      const backoffMs = computeBackoffMs((intent.attempts ?? 0) + 1);

      await prisma.stravaSyncIntent.update({
        where: { athleteId: intent.athleteId },
        data: {
          pending: true,
          lockedUntil: null,
          nextAttemptAt: new Date(now.getTime() + backoffMs),
          lastError: message.slice(0, 500),
        },
      });

      if (rateLimited) break;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      processedAthletes,
      createdCalendarItems,
      matchedCompletions,
      skippedDuplicates,
      errorsCount: errors.length,
      rateLimited,
    },
    { status: 200 }
  );
}

export async function GET(request: NextRequest) {
  try {
    return await runCron(request);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return await runCron(request);
  } catch (error) {
    return handleError(error);
  }
}
