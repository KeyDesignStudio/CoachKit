import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { syncStravaActivityById, syncStravaForConnections, type StravaConnectionEntry } from '@/lib/strava-sync';

export const dynamic = 'force-dynamic';

type StravaWebhookEvent = {
  aspect_type?: 'create' | 'update' | 'delete';
  event_time?: number;
  object_id?: number;
  object_type?: 'activity' | 'athlete';
  owner_id?: number;
  subscription_id?: number;
  updates?: Record<string, unknown>;
};

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
  // Strava expects a 2xx quickly; do best-effort ingestion.
  try {
    const event = (await request.json()) as StravaWebhookEvent;

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
      select: {
        id: true,
        athleteId: true,
        accessToken: true,
        refreshToken: true,
        expiresAt: true,
        scope: true,
        lastSyncAt: true,
        athlete: {
          select: {
            coachId: true,
            user: { select: { timezone: true } },
          },
        },
      },
    });

    if (!connection) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const entry: StravaConnectionEntry = {
      athleteId: connection.athleteId,
      athleteTimezone: connection.athlete.user.timezone ?? 'Australia/Brisbane',
      coachId: connection.athlete.coachId,
      connection: {
        id: connection.id,
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        expiresAt: connection.expiresAt,
        scope: connection.scope,
        lastSyncAt: connection.lastSyncAt,
      },
    };

    // If we have an activity id, ingest just that activity (best for rename/update events).
    if (activityId && (event.aspect_type === 'create' || event.aspect_type === 'update')) {
      const summary = await syncStravaActivityById(entry, activityId);
      return success({ ok: true, mode: 'activity', summary });
    }

    // Fallback: do a small backfill for this athlete.
    const fallbackForceDays = event.aspect_type === 'update' ? 30 : 2;
    const summary = await syncStravaForConnections([entry], { forceDays: fallbackForceDays });
    return success({ ok: true, mode: 'poll', summary });
  } catch (error) {
    // Avoid webhook retry storms; still surface errors in response for debugging.
    console.error('Strava webhook failed', error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
