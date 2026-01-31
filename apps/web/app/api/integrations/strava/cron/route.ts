import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { handleError } from '@/lib/http';
import { isPrismaInitError, logPrismaInitError } from '@/lib/prisma-diagnostics';
import { syncStravaActivityById, syncStravaForConnections, type StravaConnectionEntry } from '@/lib/strava-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cronAuthFailure() {
  return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
}

function isAutosyncEnabled() {
  return process.env.STRAVA_AUTOSYNC_ENABLED !== '0';
}

function requireCronAuth(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET ?? process.env.COACHKIT_CRON_SECRET;
  if (!expected) {
    // Misconfiguration should be visible.
    throw new ApiError(500, 'CRON_SECRET_MISSING', 'CRON_SECRET is not set.');
  }

  // IMPORTANT: Do not authenticate cron requests via the Authorization header.
  // Clerk middleware may attempt to parse Authorization as a JWT and reject non-JWT values.
  const provided = request.headers.get('x-cron-secret');
  if (!provided) {
    return cronAuthFailure();
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return cronAuthFailure();
  }

  return null;
}

function computeBackoffMs(attempts: number) {
  const base = 60_000; // 1m
  const max = 6 * 60 * 60_000; // 6h
  const exp = Math.min(8, Math.max(0, attempts));
  return Math.min(max, base * Math.pow(2, exp));
}

function parseForceDays(raw: string | null) {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ApiError(400, 'INVALID_FORCE_DAYS', 'forceDays must be an integer.');
  }

  // Keep the lookback bounded to stay rate-limit and runtime safe.
  return Math.max(1, Math.min(14, n));
}

function parseMode(raw: string | null) {
  if (!raw) return 'intents' as const;
  return raw === 'backfill' ? ('backfill' as const) : ('intents' as const);
}

async function runCron(request: NextRequest) {
  const authResponse = requireCronAuth(request);
  if (authResponse) return authResponse;

  if (!isAutosyncEnabled()) {
    return NextResponse.json({ ok: true, disabled: true }, { status: 200 });
  }

  const url = new URL(request.url);
  const athleteId = url.searchParams.get('athleteId');
  const forceDays = parseForceDays(url.searchParams.get('forceDays'));
  const mode = parseMode(url.searchParams.get('mode'));

  const now = new Date();
  const maxIntentsPerRun = 50;
  const maxAthletesPerBackfillRun = 20;

  // Recover intents stuck in PROCESSING (e.g. worker crash) after 15 minutes.
  await prisma.stravaSyncIntent.updateMany({
    where: {
      status: 'PROCESSING',
      updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) },
      ...(athleteId ? { athleteId } : {}),
    } as any,
    data: { status: 'PENDING' },
  });

  let drainedCount = 0;
  let doneCount = 0;
  let failedCount = 0;
  let createdCalendarItems = 0;
  let matchedCompletions = 0;
  let skippedDuplicates = 0;
  let rateLimited = false;
  let athletesConsidered = 0;
  let stravaConnectionsFound = 0;
  let activitiesFetched = 0;
  let activitiesInWindow = 0;
  let activitiesUpserted = 0;
  const activitiesSkippedByReason: Record<string, number> = {};

  if (mode === 'intents') {
    const intents = await prisma.stravaSyncIntent.findMany({
      where: {
        status: 'PENDING',
        ...(athleteId ? { athleteId } : {}),
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      } as any,
      orderBy: [{ createdAt: 'asc' }],
      take: maxIntentsPerRun,
      select: {
        id: true,
        athleteId: true,
        stravaActivityId: true,
      },
    });

    for (const intent of intents) {
      // Claim by transitioning PENDING -> PROCESSING.
      const claim = await prisma.stravaSyncIntent.updateMany({
        where: {
          id: intent.id,
          status: 'PENDING',
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        } as any,
        data: {
          status: 'PROCESSING',
          attempts: { increment: 1 },
        },
      });

      if (claim.count !== 1) continue;

      drainedCount += 1;

      try {
        const summary = await syncStravaActivityById({
          athleteId: intent.athleteId,
          stravaActivityId: intent.stravaActivityId,
        });

        createdCalendarItems += summary.createdCalendarItems;
        matchedCompletions += summary.matched;
        skippedDuplicates += summary.skippedExisting;
        activitiesFetched += summary.fetched;
        activitiesInWindow += summary.inWindow;
        activitiesUpserted += summary.created + summary.updated;
        for (const [reason, count] of Object.entries(summary.skippedByReason ?? {})) {
          activitiesSkippedByReason[reason] = (activitiesSkippedByReason[reason] ?? 0) + count;
        }

        await prisma.stravaSyncIntent.update({
          where: { id: intent.id },
          data: {
            status: 'DONE',
            processedAt: now,
            lastError: null,
            nextAttemptAt: null,
          },
        });

        doneCount += 1;

        if (summary.errors.some((e) => e.message.toLowerCase().includes('rate limit'))) {
          rateLimited = true;
          break;
        }
      } catch (error: any) {
        const message = error instanceof Error ? error.message : 'Strava sync failed.';

        const current = await prisma.stravaSyncIntent.findUnique({
          where: { id: intent.id },
          select: { attempts: true },
        });
        const attempts = current?.attempts ?? 1;

        if (error?.status === 429 || error?.code === 'STRAVA_RATE_LIMITED') {
          rateLimited = true;
        }

        const nextAttemptAt = new Date(now.getTime() + computeBackoffMs(attempts));
        const terminal = attempts >= 10;

        await prisma.stravaSyncIntent.update({
          where: { id: intent.id },
          data: {
            status: terminal ? 'FAILED' : 'PENDING',
            lastError: message.slice(0, 500),
            nextAttemptAt: terminal ? null : nextAttemptAt,
            processedAt: terminal ? now : null,
          },
        });

        failedCount += 1;
        if (rateLimited) break;
      }
    }
  }

  // Optional bounded backfill safety net.
  if (!rateLimited && forceDays !== null && (mode === 'backfill' || drainedCount === 0)) {
    const connections = await prisma.athleteProfile.findMany({
      where: {
        ...(athleteId ? { userId: athleteId } : {}),
        stravaConnection: { isNot: null },
      },
      take: maxAthletesPerBackfillRun,
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

    athletesConsidered += connections.length;

    const entries: StravaConnectionEntry[] = connections
      .map((a) => {
        if (!a.stravaConnection) return null;
        return {
          athleteId: a.userId,
          athleteTimezone: a.user?.timezone ?? 'UTC',
          coachId: a.coachId,
          connection: a.stravaConnection as any,
        };
      })
      .filter(Boolean) as any;

    stravaConnectionsFound += entries.length;

    if (entries.length > 0) {
      const summary = await syncStravaForConnections(entries, { forceDays, deep: true, deepConcurrency: 2 });
      createdCalendarItems += summary.createdCalendarItems;
      matchedCompletions += summary.matched;
      skippedDuplicates += summary.skippedExisting;
      activitiesFetched += summary.fetched;
      activitiesInWindow += summary.inWindow;
      activitiesUpserted += summary.created + summary.updated;
      for (const [reason, count] of Object.entries(summary.skippedByReason ?? {})) {
        activitiesSkippedByReason[reason] = (activitiesSkippedByReason[reason] ?? 0) + count;
      }
      if (summary.errors.some((e) => e.message.toLowerCase().includes('rate limit'))) {
        rateLimited = true;
      }
    }
  }

  const pendingRemaining = await prisma.stravaSyncIntent.count({
    where: {
      status: 'PENDING',
      ...(athleteId ? { athleteId } : {}),
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    } as any,
  });

  console.info('[strava cron] run summary', {
    drainedCount,
    doneCount,
    failedCount,
    pendingRemaining,
    createdCalendarItems,
    matchedCompletions,
    skippedDuplicates,
    rateLimited,
  });

  return NextResponse.json(
    {
      ok: true,
      mode,
      forceDays,
      athleteId,
      drainedCount,
      doneCount,
      failedCount,
      pendingRemaining,
      createdCalendarItems,
      matchedCompletions,
      skippedDuplicates,
      athletesConsidered,
      stravaConnectionsFound,
      activitiesFetched,
      activitiesInWindow,
      activitiesUpserted,
      activitiesSkipped: activitiesSkippedByReason,
      rateLimited,
    },
    { status: 200 }
  );
}

export async function GET(request: NextRequest) {
  try {
    return await runCron(request);
  } catch (error) {
    if (isPrismaInitError(error)) {
      logPrismaInitError({ where: 'strava_cron', error });
      const retryAfterSeconds = 300;
      return NextResponse.json(
        {
          ok: true,
          status: 'skipped',
          reason: 'db_unreachable',
          retryAfterSeconds,
        },
        {
          status: 200,
          headers: {
            'Retry-After': String(retryAfterSeconds),
          },
        }
      );
    }

    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return await runCron(request);
  } catch (error) {
    if (isPrismaInitError(error)) {
      logPrismaInitError({ where: 'strava_cron', error });
      const retryAfterSeconds = 300;
      return NextResponse.json(
        {
          ok: true,
          status: 'skipped',
          reason: 'db_unreachable',
          retryAfterSeconds,
        },
        {
          status: 200,
          headers: {
            'Retry-After': String(retryAfterSeconds),
          },
        }
      );
    }

    return handleError(error);
  }
}
