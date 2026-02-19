import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { requireAthlete, requireAuth } from '@/lib/auth';
import {
  DeviceProvider,
  getProviderOAuthConfig,
  getProviderWebhookConfig,
  parseEventType,
  parseExternalActivityId,
  parseExternalAthleteId,
  providerSlug,
  sanitizeRedirectTo,
  toExternalProvider,
  toOAuthProvider,
  withProviderResult,
} from '@/lib/integrations/providers';
import { verifyWebhookHmacSha256 } from '@/lib/integrations/webhook-signature';

function parseTokenPayload(payload: any) {
  const accessToken = payload?.access_token ? String(payload.access_token) : null;
  const refreshToken = payload?.refresh_token != null ? String(payload.refresh_token) : null;

  const expiresAt =
    typeof payload?.expires_at === 'number'
      ? new Date(payload.expires_at * 1000)
      : typeof payload?.expires_in === 'number'
        ? new Date(Date.now() + payload.expires_in * 1000)
        : null;

  const externalAthleteId =
    payload?.athlete?.id ?? payload?.user?.id ?? payload?.athlete_id ?? payload?.user_id ?? payload?.account_id ?? payload?.id;

  return {
    accessToken,
    refreshToken,
    expiresAt,
    externalAthleteId: externalAthleteId != null ? String(externalAthleteId) : null,
    scope: payload?.scope != null ? String(payload.scope) : null,
  };
}

export async function providerConnect(provider: DeviceProvider, request: Request) {
  try {
    const { user } = await requireAthlete();
    const prismaClient = prisma as any;

    const url = new URL(request.url);
    const redirectTo = sanitizeRedirectTo(url.searchParams.get('redirectTo'));
    const cfg = getProviderOAuthConfig(provider, url.origin);

    if (!cfg.clientId || !cfg.authorizeUrl) {
      throw new ApiError(503, 'PROVIDER_OAUTH_NOT_CONFIGURED', `${provider} OAuth is not configured yet.`);
    }

    await prismaClient.oAuthState.deleteMany({
      where: {
        provider: toOAuthProvider(provider),
        userId: user.id,
        expiresAt: { lt: new Date() },
      },
    });

    const state = crypto.randomUUID().replaceAll('-', '');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prismaClient.oAuthState.create({
      data: {
        provider: toOAuthProvider(provider),
        userId: user.id,
        state,
        redirectTo,
        expiresAt,
      },
    });

    const authorizeUrl = new URL(cfg.authorizeUrl);
    authorizeUrl.searchParams.set('client_id', cfg.clientId);
    authorizeUrl.searchParams.set('redirect_uri', cfg.redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', state);
    if (cfg.scopes) {
      authorizeUrl.searchParams.set('scope', cfg.scopes);
    }

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    return handleError(error);
  }
}

export async function providerCallback(provider: DeviceProvider, request: Request) {
  try {
    const prismaClient = prisma as any;
    const url = new URL(request.url);

    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const providerError = url.searchParams.get('error');

    if (!state) {
      return NextResponse.redirect(new URL(`/athlete/settings?${providerSlug(provider)}=missing_state`, url.origin));
    }

    const oauthState = await prismaClient.oAuthState.findUnique({
      where: { state },
      include: { user: { select: { role: true } } },
    });

    if (!oauthState || oauthState.provider !== toOAuthProvider(provider)) {
      return NextResponse.redirect(new URL(`/athlete/settings?${providerSlug(provider)}=invalid_state`, url.origin));
    }

    const redirectTo = sanitizeRedirectTo(oauthState.redirectTo);

    if (oauthState.expiresAt.getTime() < Date.now()) {
      await prismaClient.oAuthState.delete({ where: { id: oauthState.id } });
      return NextResponse.redirect(new URL(withProviderResult(redirectTo, provider, 'expired_state'), url.origin));
    }

    if (oauthState.user.role !== UserRole.ATHLETE) {
      await prismaClient.oAuthState.delete({ where: { id: oauthState.id } });
      return NextResponse.redirect(new URL('/access-denied', url.origin));
    }

    try {
      const { user } = await requireAuth();
      if (user.id !== oauthState.userId) {
        await prismaClient.oAuthState.delete({ where: { id: oauthState.id } });
        return NextResponse.redirect(new URL('/access-denied', url.origin));
      }
    } catch {
      // State is one-time and DB-bound; callback may complete without active session.
    }

    if (providerError) {
      await prismaClient.oAuthState.delete({ where: { id: oauthState.id } });
      return NextResponse.redirect(new URL(withProviderResult(redirectTo, provider, 'cancelled'), url.origin));
    }

    if (!code) {
      await prismaClient.oAuthState.delete({ where: { id: oauthState.id } });
      return NextResponse.redirect(new URL(withProviderResult(redirectTo, provider, 'missing_code'), url.origin));
    }

    const cfg = getProviderOAuthConfig(provider, url.origin);
    if (!cfg.clientId || !cfg.clientSecret || !cfg.tokenUrl) {
      throw new ApiError(503, 'PROVIDER_TOKEN_CONFIG_MISSING', `${provider} token exchange is not configured.`);
    }

    const tokenResponse = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
      }).toString(),
      cache: 'no-store',
    });

    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      const message = (tokenPayload as any)?.message || `${provider} token exchange failed.`;
      throw new ApiError(502, 'PROVIDER_TOKEN_EXCHANGE_FAILED', message);
    }

    const parsed = parseTokenPayload(tokenPayload);
    if (!parsed.accessToken || !parsed.externalAthleteId) {
      throw new ApiError(502, 'PROVIDER_TOKEN_RESPONSE_INVALID', `${provider} token response missing required fields.`);
    }

    await prismaClient.$transaction([
      prismaClient.externalConnection.upsert({
        where: {
          athleteId_provider: {
            athleteId: oauthState.userId,
            provider: toExternalProvider(provider),
          },
        },
        create: {
          athleteId: oauthState.userId,
          provider: toExternalProvider(provider),
          externalAthleteId: parsed.externalAthleteId,
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt,
          scope: parsed.scope,
        },
        update: {
          externalAthleteId: parsed.externalAthleteId,
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt,
          scope: parsed.scope,
        },
      }),
      prismaClient.oAuthState.delete({ where: { id: oauthState.id } }),
    ]);

    return NextResponse.redirect(new URL(withProviderResult(redirectTo, provider, 'connected'), url.origin));
  } catch (error) {
    return handleError(error);
  }
}

export async function providerDisconnect(provider: DeviceProvider) {
  try {
    const { user } = await requireAthlete();
    await prisma.externalConnection.deleteMany({
      where: {
        athleteId: user.id,
        provider: toExternalProvider(provider),
      },
    });

    return success({ disconnected: true });
  } catch (error) {
    return handleError(error);
  }
}

export async function providerStatus(provider: DeviceProvider) {
  try {
    const { user } = await requireAthlete();
    const cfg = getProviderOAuthConfig(provider, 'http://localhost');
    const connection = await prisma.externalConnection.findUnique({
      where: {
        athleteId_provider: {
          athleteId: user.id,
          provider: toExternalProvider(provider),
        },
      },
      select: {
        provider: true,
        externalAthleteId: true,
        expiresAt: true,
        scope: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return success({
      provider,
      configured: Boolean(cfg.clientId && cfg.authorizeUrl),
      connected: Boolean(connection),
      connection,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function providerHealth(provider: DeviceProvider) {
  try {
    const cfg = getProviderOAuthConfig(provider, 'http://localhost');
    const webhook = getProviderWebhookConfig(provider);

    const pending = await prisma.externalWebhookEvent.aggregate({
      where: {
        provider: toExternalProvider(provider),
        status: 'PENDING',
      },
      _count: { id: true },
      _min: { receivedAt: true },
      _max: { updatedAt: true },
    });

    const lastProcessed = await prisma.externalWebhookEvent.findFirst({
      where: {
        provider: toExternalProvider(provider),
        status: 'DONE',
      },
      orderBy: { processedAt: 'desc' },
      select: { processedAt: true },
    });

    return NextResponse.json(
      {
        ok: true,
        provider,
        configured: {
          hasClientId: Boolean(cfg.clientId),
          hasClientSecret: Boolean(cfg.clientSecret),
          hasAuthorizeUrl: Boolean(cfg.authorizeUrl),
          hasTokenUrl: Boolean(cfg.tokenUrl),
          hasWebhookSecret: Boolean(webhook.signingSecret),
          hasWebhookVerifyToken: Boolean(webhook.verifyToken),
        },
        pending: {
          count: pending._count.id,
          oldestReceivedAt: pending._min.receivedAt,
          lastUpdatedAt: pending._max.updatedAt,
        },
        lastProcessedAt: lastProcessed?.processedAt ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function providerWebhookGet(provider: DeviceProvider, request: NextRequest) {
  try {
    const cfg = getProviderWebhookConfig(provider);
    const challenge = request.nextUrl.searchParams.get('hub.challenge') ?? request.nextUrl.searchParams.get('challenge');
    const verifyToken =
      request.nextUrl.searchParams.get('hub.verify_token') ?? request.nextUrl.searchParams.get('verify_token');

    if (!cfg.verifyToken) {
      return NextResponse.json({ ok: true, provider, webhook: 'no_verify_token_configured' }, { status: 200 });
    }

    if (!challenge || !verifyToken || verifyToken !== cfg.verifyToken) {
      return NextResponse.json({ error: 'invalid' }, { status: 403 });
    }

    return NextResponse.json({ 'hub.challenge': challenge }, { status: 200 });
  } catch (error) {
    return handleError(error);
  }
}

export async function providerWebhookPost(provider: DeviceProvider, request: NextRequest) {
  try {
    const cfg = getProviderWebhookConfig(provider);
    const rawBody = await request.text();

    if (cfg.signingSecret) {
      const preferredHeader = cfg.signatureHeader;
      const signatureValue = preferredHeader
        ? request.headers.get(preferredHeader)
        : request.headers.get('x-signature') ??
          request.headers.get(`x-${providerSlug(provider)}-signature`) ??
          request.headers.get('x-hub-signature-256');

      const valid = verifyWebhookHmacSha256({
        rawBody,
        secret: cfg.signingSecret,
        signatureHeaderValue: signatureValue,
      });

      if (!valid) {
        return NextResponse.json({ ok: false, error: 'INVALID_SIGNATURE' }, { status: 401 });
      }
    }

    const payload = rawBody ? JSON.parse(rawBody) : {};
    const externalAthleteId = parseExternalAthleteId(payload);
    const externalActivityId = parseExternalActivityId(payload);
    const eventType = parseEventType(payload);

    const connection = externalAthleteId
      ? await prisma.externalConnection.findUnique({
          where: {
            provider_externalAthleteId: {
              provider: toExternalProvider(provider),
              externalAthleteId,
            },
          },
          select: { athleteId: true },
        })
      : null;

    await prisma.externalWebhookEvent.create({
      data: {
        provider: toExternalProvider(provider),
        athleteId: connection?.athleteId ?? null,
        externalAthleteId,
        externalActivityId,
        eventType,
        status: 'PENDING',
        payloadJson: payload,
      },
    });

    return NextResponse.json({ ok: true, queued: true }, { status: 200 });
  } catch (error) {
    console.error(`[${provider.toLowerCase()} webhook] failed`, error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
