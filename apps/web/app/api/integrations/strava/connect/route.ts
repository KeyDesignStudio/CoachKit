import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { handleError } from '@/lib/http';
import { requireAthlete } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function sanitizeRedirectTo(value: string | null) {
  if (!value) return '/athlete/settings';
  if (!value.startsWith('/') || value.startsWith('//')) return '/athlete/settings';
  return value;
}

function getStravaRedirectUri(origin: string) {
  const explicit = process.env.STRAVA_REDIRECT_URI;
  if (explicit) {
    return explicit;
  }

  const base = process.env.NEXT_PUBLIC_APP_URL;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && base) {
    return new URL('/api/integrations/strava/callback', base).toString();
  }

  return new URL('/api/integrations/strava/callback', origin || 'http://localhost:3000').toString();
}

export async function GET(request: Request) {
  try {
    const { user } = await requireAthlete();
    const prismaClient = prisma as any;

    const clientId = process.env.STRAVA_CLIENT_ID;
    if (!clientId) {
      throw new ApiError(500, 'STRAVA_CONFIG_MISSING', 'STRAVA_CLIENT_ID is not set.');
    }

    const url = new URL(request.url);
    const redirectTo = sanitizeRedirectTo(url.searchParams.get('redirectTo'));

    // Clean up expired states opportunistically.
    await prismaClient.oAuthState.deleteMany({
      where: {
        provider: 'STRAVA',
        userId: user.id,
        expiresAt: { lt: new Date() },
      },
    });

    const state = crypto.randomUUID().replaceAll('-', '');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prismaClient.oAuthState.create({
      data: {
        provider: 'STRAVA',
        userId: user.id,
        state,
        redirectTo,
        expiresAt,
      },
    });

    const redirectUri = getStravaRedirectUri(url.origin);

    const authorizeUrl = new URL('https://www.strava.com/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri.toString());
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('approval_prompt', 'auto');
    authorizeUrl.searchParams.set('scope', 'read,activity:read_all');
    authorizeUrl.searchParams.set('state', state);

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    return handleError(error);
  }
}
