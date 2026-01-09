import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { handleError } from '@/lib/http';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function sanitizeRedirectTo(value: string | null) {
  if (!value) return '/athlete/settings';
  if (!value.startsWith('/') || value.startsWith('//')) return '/athlete/settings';
  return value;
}

function withStravaResult(base: string, result: string) {
  const url = new URL(base, 'http://localhost');
  url.searchParams.set('strava', result);
  return url.pathname + (url.search ? url.search : '');
}

export async function GET(request: Request) {
  try {
    const prismaClient = prisma as any;
    const url = new URL(request.url);

    // Opportunistic cleanup of expired Strava states.
    await prismaClient.oAuthState.deleteMany({
      where: {
        provider: 'STRAVA',
        expiresAt: { lt: new Date() },
      },
    });

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const stravaError = url.searchParams.get('error');

    if (!state) {
      return NextResponse.redirect(new URL('/athlete/settings?strava=missing_state', url.origin));
    }

    const oauthState = await prismaClient.oAuthState.findUnique({
      where: { state },
      include: { user: { select: { role: true } } },
    });

    if (!oauthState || oauthState.provider !== 'STRAVA') {
      return NextResponse.redirect(new URL('/athlete/settings?strava=invalid_state', url.origin));
    }

    const redirectTo = sanitizeRedirectTo(oauthState.redirectTo);

    if (oauthState.expiresAt.getTime() < Date.now()) {
      await prismaClient.oAuthState.delete({ where: { id: oauthState.id } });
      return NextResponse.redirect(new URL(withStravaResult(redirectTo, 'expired_state'), url.origin));
    }

    if (oauthState.user.role !== UserRole.ATHLETE) {
      await prismaClient.oAuthState.delete({ where: { id: oauthState.id } });
      return NextResponse.redirect(new URL('/access-denied', url.origin));
    }

    // If the user is signed in, ensure they match the state owner.
    try {
      const { user } = await requireAuth();
      if (user.id !== oauthState.userId) {
        await prismaClient.oAuthState.delete({ where: { id: oauthState.id } });
        return NextResponse.redirect(new URL('/access-denied', url.origin));
      }
    } catch {
      // Allow completion without a live session; state is one-time and DB-bound.
    }

    if (stravaError) {
      await prismaClient.oAuthState.delete({ where: { id: oauthState.id } });
      return NextResponse.redirect(new URL(withStravaResult(redirectTo, 'cancelled'), url.origin));
    }

    if (!code) {
      await prismaClient.oAuthState.delete({ where: { id: oauthState.id } });
      return NextResponse.redirect(new URL(withStravaResult(redirectTo, 'missing_code'), url.origin));
    }

    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new ApiError(500, 'STRAVA_CONFIG_MISSING', 'STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET are not set.');
    }

    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }).toString(),
      cache: 'no-store',
    });

    const tokenPayload = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      athlete?: { id?: number };
      scope?: string;
      message?: string;
      errors?: unknown;
    };

    if (!tokenResponse.ok) {
      const message = tokenPayload.message || 'Failed to exchange code for token.';
      throw new ApiError(502, 'STRAVA_TOKEN_EXCHANGE_FAILED', message);
    }

    if (!tokenPayload.access_token || !tokenPayload.refresh_token || !tokenPayload.expires_at || !tokenPayload.athlete?.id) {
      throw new ApiError(502, 'STRAVA_TOKEN_RESPONSE_INVALID', 'Strava token response was missing required fields.');
    }

    const expiresAt = new Date(tokenPayload.expires_at * 1000);

    await prismaClient.$transaction([
      prismaClient.stravaConnection.upsert({
        where: { athleteId: oauthState.userId },
        create: {
          athleteId: oauthState.userId,
          stravaAthleteId: String(tokenPayload.athlete.id),
          accessToken: tokenPayload.access_token,
          refreshToken: tokenPayload.refresh_token,
          expiresAt,
          scope: tokenPayload.scope ?? null,
        },
        update: {
          stravaAthleteId: String(tokenPayload.athlete.id),
          accessToken: tokenPayload.access_token,
          refreshToken: tokenPayload.refresh_token,
          expiresAt,
          scope: tokenPayload.scope ?? null,
        },
      }),
      prismaClient.oAuthState.delete({ where: { id: oauthState.id } }),
    ]);

    return NextResponse.redirect(new URL(withStravaResult(redirectTo, 'connected'), url.origin));
  } catch (error) {
    return handleError(error);
  }
}
