import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { syncStravaForConnections, type StravaConnectionEntry } from '@/lib/strava-sync';

export const dynamic = 'force-dynamic';

function requireCronAuth(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    throw new ApiError(500, 'CRON_SECRET_MISSING', 'CRON_SECRET is not set.');
  }

  const bearer = request.headers.get('authorization');
  const token = bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length).trim() : null;
  const alt = request.headers.get('x-cron-secret');

  const provided = token || alt;
  if (!provided || provided !== expected) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid cron secret.');
  }
}

export async function POST(request: NextRequest) {
  try {
    requireCronAuth(request);

    const url = new URL(request.url);
    const athleteId = url.searchParams.get('athleteId');

    const forceDaysParam = url.searchParams.get('forceDays');
    const requestedForceDays = forceDaysParam ? Number(forceDaysParam) : null;
    const forceDays =
      requestedForceDays && Number.isFinite(requestedForceDays)
        ? Math.min(30, Math.max(1, Math.floor(requestedForceDays)))
        : null;

    const athletes = await prisma.athleteProfile.findMany({
      where: {
        ...(athleteId ? { userId: athleteId } : {}),
        stravaConnection: { isNot: null },
      },
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

    const connections: StravaConnectionEntry[] = athletes
      .filter((a) => Boolean(a.stravaConnection))
      .map((a) => ({
        athleteId: a.userId,
        athleteTimezone: a.user?.timezone ?? 'Australia/Brisbane',
        coachId: a.coachId,
        connection: a.stravaConnection as any,
      }));

    const summary = await syncStravaForConnections(connections, { forceDays });
    return success(summary);
  } catch (error) {
    return handleError(error);
  }
}
