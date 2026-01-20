import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { handleError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

    if (!ownerId || !activityId) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const connection = await prisma.stravaConnection.findUnique({
      where: { stravaAthleteId: ownerId },
      select: { athleteId: true },
    });

    if (!connection) {
      console.warn('[strava webhook] no matching connection', { ownerId, activityId });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const now = new Date();
    const eventType = event.aspect_type ?? 'create';

    await prisma.stravaSyncIntent.upsert({
      where: {
        athleteId_stravaActivityId: {
          athleteId: connection.athleteId,
          stravaActivityId: activityId,
        },
      },
      create: {
        athleteId: connection.athleteId,
        stravaAthleteId: ownerId,
        stravaActivityId: activityId,
        eventType,
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        nextAttemptAt: null,
        processedAt: null,
        createdAt: now,
      } as any,
      update: {
        stravaAthleteId: ownerId,
        eventType,
        status: 'PENDING',
        lastError: null,
        nextAttemptAt: null,
        processedAt: null,
      } as any,
    });

    console.info('[strava webhook] intent queued', { athleteId: connection.athleteId, activityId, eventType });

    // Serverless-safe: only record intent. Sync happens via the cron backfill endpoint.
    return NextResponse.json({ ok: true, recorded: true }, { status: 200 });
  } catch (error) {
    // Avoid webhook retry storms; still surface errors in response for debugging.
    console.error('Strava webhook failed', error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
