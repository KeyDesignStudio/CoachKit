import { NextRequest } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { notFound, forbidden } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { privateCacheHeaders } from '@/lib/cache';
import { getWeatherSummariesForRange } from '@/lib/weather-server';

export const dynamic = 'force-dynamic';

type WeatherIcon = 'sunny' | 'partly_cloudy' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | 'wind';

type WeatherResponseEnabled = {
  enabled: true;
  source: 'open-meteo';
  date: string; // YYYY-MM-DD
  timezone: string;
  icon: WeatherIcon;
  maxTempC: number;
  sunriseLocal: string; // HH:MM
  sunsetLocal: string; // HH:MM
};

type WeatherResponseDisabled = {
  enabled: false;
  reason: 'NO_LOCATION';
};

type WeatherResponse = WeatherResponseEnabled | WeatherResponseDisabled;

type CacheEntry = {
  expiresAtMs: number;
  value: WeatherResponseEnabled;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<WeatherResponseEnabled>>();

function formatZonedDateKey(date: Date, timeZone: string): string {
  // en-CA reliably formats to YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export async function GET(_request: NextRequest, context: { params: { itemId: string } }) {
  try {
    const { user } = await requireAuth();
    const itemId = context.params.itemId;

    const item = await prisma.calendarItem.findFirst({
      where: { id: itemId, deletedAt: null },
      select: {
        id: true,
        athleteId: true,
        coachId: true,
        date: true,
      },
    });

    if (!item) {
      throw notFound('Workout not found.');
    }

    if (user.role === 'ATHLETE') {
      if (item.athleteId !== user.id) throw notFound('Workout not found.');
    } else if (user.role === 'COACH') {
      if (item.coachId !== user.id) throw notFound('Workout not found.');
    } else {
      throw forbidden('Access denied.');
    }

    const profile = await prisma.athleteProfile.findUnique({
      where: { userId: item.athleteId },
      select: {
        defaultLat: true,
        defaultLon: true,
      },
    });

    const headers = privateCacheHeaders({ maxAgeSeconds: 1800 });

    if (!profile || profile.defaultLat == null || profile.defaultLon == null) {
      const disabled: WeatherResponseDisabled = { enabled: false, reason: 'NO_LOCATION' };
      return success(disabled, { headers });
    }

    const lat = profile.defaultLat;
    const lon = profile.defaultLon;

    const athleteUser = await prisma.user.findUnique({
      where: { id: item.athleteId },
      select: { timezone: true },
    });

    const athleteTz = athleteUser?.timezone ?? 'UTC';
    const dateKey = formatZonedDateKey(item.date, athleteTz);

    const latKey = lat.toFixed(4);
    const lonKey = lon.toFixed(4);
    const cacheKey = `${item.athleteId}|${dateKey}|${latKey}|${lonKey}|${athleteTz}`;

    const now = Date.now();
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAtMs > now) {
      return success(cached.value, { headers });
    }

    if (inFlight.has(cacheKey)) {
      const value = await inFlight.get(cacheKey)!;
      return success(value, { headers });
    }

    const promise: Promise<WeatherResponseEnabled> = (async () => {
      const map = await getWeatherSummariesForRange({
        lat,
        lon,
        from: dateKey,
        to: dateKey,
        timezone: athleteTz,
      });

      const summary = map[dateKey];
      if (!summary) {
        throw new Error('Open-Meteo response missing required daily fields.');
      }

      return {
        enabled: true as const,
        source: 'open-meteo' as const,
        date: dateKey,
        timezone: athleteTz,
        icon: summary.icon as WeatherIcon,
        maxTempC: summary.maxTempC,
        sunriseLocal: summary.sunriseLocal,
        sunsetLocal: summary.sunsetLocal,
      };
    })();

    inFlight.set(cacheKey, promise);

    try {
      const value = await promise;
      responseCache.set(cacheKey, { value, expiresAtMs: now + CACHE_TTL_MS });
      return success(value, { headers });
    } finally {
      inFlight.delete(cacheKey);
    }
  } catch (error) {
    return handleError(error);
  }
}
