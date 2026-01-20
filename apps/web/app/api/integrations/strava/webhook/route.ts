import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { handleError } from '@/lib/http';
import { syncStravaActivityById, syncStravaForConnections, type StravaConnectionEntry } from '@/lib/strava-sync';

export const dynamic = 'force-dynamic';

function isAutosyncEnabled() {
  return process.env.STRAVA_AUTOSYNC_ENABLED !== '0';
}

type StravaWebhookEvent = {
  aspect_type?: 'create' | 'update' | 'delete';
  event_time?: number;
  object_id?: number;
  object_type?: 'activity' | 'athlete';
  owner_id?: number;
  subscription_id?: number;
  updates?: Record<string, unknown>;
};

const stravaWebhookEventSchema = z.object({
  aspect_type: z.enum(['create', 'update', 'delete']).optional(),
  event_time: z.number().int().optional(),
  object_id: z.number().int().optional(),
  object_type: z.enum(['activity', 'athlete']).optional(),
  owner_id: z.number().int().optional(),
  subscription_id: z.number().int().optional(),
  updates: z.record(z.unknown()).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get('hub.mode');
    const challenge = url.searchParams.get('hub.challenge');
    const token = url.searchParams.get('hub.verify_token');

    const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
    if (!expected) {
      throw new ApiError(500, 'STRAVA_WEBHOOK_VERIFY_TOKEN_MISSING', 'STRAVA_WEBHOOK_VERIFY_TOKEN is not set.');
    }

    if (!challenge || !token || mode !== 'subscribe' || token !== expected) {
      return NextResponse.json({ error: 'invalid' }, { status: 403 });
    }

    // Strava expects a raw JSON object with hub.challenge.
    return NextResponse.json({ 'hub.challenge': challenge }, { status: 200 });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  // Strava expects a 2xx quickly; keep work bounded and debounced.
  try {
    if (!isAutosyncEnabled()) {
      return NextResponse.json({ ok: true, disabled: true }, { status: 200 });
    }

    const event = stravaWebhookEventSchema.parse((await request.json()) as StravaWebhookEvent);

    if (event.object_type !== 'activity') {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const ownerId = event.owner_id ? String(event.owner_id) : null;
    const activityId = event.object_id ? String(event.object_id) : null;

    if (!ownerId) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const connection = await prisma.stravaConnection.findUnique({
      where: { stravaAthleteId: ownerId },
      select: { athleteId: true },
    });

    if (!connection) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const receivedAt = new Date();
    const eventTime = typeof event.event_time === 'number' ? new Date(event.event_time * 1000) : receivedAt;

    // Debounced intent per athlete: always record the event.
    await prisma.stravaSyncIntent.upsert({
      where: { athleteId: connection.athleteId },
      create: {
        athleteId: connection.athleteId,
        pending: true,
        lastEventAt: eventTime,
        lastActivityId: activityId,
      },
      update: {
        pending: true,
        lastEventAt: eventTime,
        lastActivityId: activityId,
        nextAttemptAt: null,
      },
    });

    // Attempt a best-effort sync immediately, but debounce to avoid storms.
    const now = receivedAt;
    const debounceMs = 2 * 60_000;
    const leaseMs = 5 * 60_000;
    const allowAfter = new Date(now.getTime() - debounceMs);

    const claim = await prisma.stravaSyncIntent.updateMany({
      where: {
        athleteId: connection.athleteId,
        AND: [
          { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
          { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: allowAfter } }] },
        ],
      } as any,
      data: {
        lockedUntil: new Date(now.getTime() + leaseMs),
        lastAttemptAt: now,
        attempts: { increment: 1 },
      },
    });

    if (claim.count !== 1) {
      return NextResponse.json({ ok: true, debounced: true }, { status: 200 });
    }

    const athlete = await prisma.athleteProfile.findUnique({
      where: { userId: connection.athleteId },
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

    const conn = athlete?.stravaConnection;
    if (!athlete || !conn) {
      await prisma.stravaSyncIntent.update({
        where: { athleteId: connection.athleteId },
        data: { pending: false, lockedUntil: null, nextAttemptAt: null, lastError: null },
      });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const entry: StravaConnectionEntry = {
      athleteId: athlete.userId,
      athleteTimezone: athlete.user?.timezone ?? 'UTC',
      coachId: athlete.coachId,
      connection: conn as any,
    };

    try {
      const summary = activityId
        ? await syncStravaActivityById(entry, activityId)
        : await syncStravaForConnections([entry], { forceDays: 2 });

      const rateLimited = summary.errors.some((e) => e.message.toLowerCase().includes('rate limit'));
      if (rateLimited) {
        await prisma.stravaSyncIntent.update({
          where: { athleteId: connection.athleteId },
          data: {
            pending: true,
            lockedUntil: null,
            nextAttemptAt: new Date(now.getTime() + 15 * 60_000),
            lastError: 'Rate limited',
          },
        });
      } else {
        await prisma.stravaSyncIntent.update({
          where: { athleteId: connection.athleteId },
          data: {
            pending: false,
            attempts: 0,
            nextAttemptAt: null,
            lockedUntil: null,
            lastError: null,
            lastSuccessAt: new Date(),
          },
        });
      }
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Strava sync failed.';
      await prisma.stravaSyncIntent.update({
        where: { athleteId: connection.athleteId },
        data: {
          pending: true,
          lockedUntil: null,
          nextAttemptAt: new Date(now.getTime() + 30 * 60_000),
          lastError: message.slice(0, 500),
        },
      });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    // Avoid webhook retry storms; still surface errors in response for debugging.
    console.error('Strava webhook failed', error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
