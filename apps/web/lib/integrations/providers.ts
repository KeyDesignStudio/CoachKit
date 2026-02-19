import { ExternalProvider, OAuthProvider } from '@prisma/client';

export const DEVICE_PROVIDERS = ['GARMIN', 'WAHOO', 'COROS'] as const;
export type DeviceProvider = (typeof DEVICE_PROVIDERS)[number];

export function providerSlug(provider: DeviceProvider) {
  return provider.toLowerCase();
}

export function toOAuthProvider(provider: DeviceProvider): OAuthProvider {
  return provider as unknown as OAuthProvider;
}

export function toExternalProvider(provider: DeviceProvider): ExternalProvider {
  return provider as unknown as ExternalProvider;
}

export function sanitizeRedirectTo(value: string | null) {
  if (!value) return '/athlete/settings';
  if (!value.startsWith('/') || value.startsWith('//')) return '/athlete/settings';
  return value;
}

export function withProviderResult(base: string, provider: DeviceProvider, result: string) {
  const url = new URL(base, 'http://localhost');
  url.searchParams.set(providerSlug(provider), result);
  return url.pathname + (url.search ? url.search : '');
}

export function envName(provider: DeviceProvider, suffix: string) {
  return `${provider}_${suffix}`;
}

export function getProviderOAuthConfig(provider: DeviceProvider, origin: string) {
  const clientId = process.env[envName(provider, 'CLIENT_ID')] ?? null;
  const clientSecret = process.env[envName(provider, 'CLIENT_SECRET')] ?? null;
  const authorizeUrl = process.env[envName(provider, 'AUTHORIZE_URL')] ?? null;
  const tokenUrl = process.env[envName(provider, 'TOKEN_URL')] ?? null;
  const scopes = process.env[envName(provider, 'SCOPES')] ?? '';

  const explicitRedirect = process.env[envName(provider, 'REDIRECT_URI')] ?? null;
  const redirectUri = explicitRedirect || new URL(`/api/integrations/${providerSlug(provider)}/callback`, origin).toString();

  return {
    clientId,
    clientSecret,
    authorizeUrl,
    tokenUrl,
    scopes,
    redirectUri,
  };
}

export function getProviderWebhookConfig(provider: DeviceProvider) {
  return {
    signingSecret: process.env[envName(provider, 'WEBHOOK_SIGNING_SECRET')] ?? null,
    verifyToken: process.env[envName(provider, 'WEBHOOK_VERIFY_TOKEN')] ?? null,
    signatureHeader: process.env[envName(provider, 'WEBHOOK_SIGNATURE_HEADER')] ?? null,
  };
}

export function parseExternalAthleteId(payload: unknown): string | null {
  const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (!obj) return null;

  const nestedAthlete = obj.athlete && typeof obj.athlete === 'object' ? (obj.athlete as Record<string, unknown>) : null;
  const nestedUser = obj.user && typeof obj.user === 'object' ? (obj.user as Record<string, unknown>) : null;

  const candidates = [
    nestedAthlete?.id,
    nestedUser?.id,
    obj.athlete_id,
    obj.user_id,
    obj.owner_id,
    obj.account_id,
    obj.externalAthleteId,
  ];

  for (const candidate of candidates) {
    if (candidate == null) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }

  return null;
}

export function parseExternalActivityId(payload: unknown): string | null {
  const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (!obj) return null;

  const candidates = [obj.object_id, obj.activity_id, obj.externalActivityId, obj.id];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }

  return null;
}

export function parseEventType(payload: unknown): string | null {
  const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (!obj) return null;
  const candidate = obj.aspect_type ?? obj.event_type ?? obj.type ?? null;
  if (!candidate) return null;
  const value = String(candidate).trim();
  return value || null;
}
