import { NextRequest } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { notFound, forbidden } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { privateCacheHeaders } from '@/lib/cache';

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

function hhmm(value: string): string {
  const t = value.includes('T') ? value.split('T')[1] : value;
  return t.slice(0, 5);
}

function iconFromWeatherCode(code: number): WeatherIcon {
  if (code === 0) return 'sunny';
  if (code === 1 || code === 2) return 'partly_cloudy';
  if (code === 3) return 'cloudy';

  if (code === 45 || code === 48) return 'fog';

  // Drizzle / rain / freezing rain.
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';

  // Snow.
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';

  // Thunderstorm.
  if (code >= 95 && code <= 99) return 'storm';

  return 'cloudy';
}

async function fetchOpenMeteoDaily(params: {
  lat: number;
  lon: number;
  date: string;
  timezone: string;
}): Promise<WeatherResponseEnabled> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(params.lat));
  url.searchParams.set('longitude', String(params.lon));
  url.searchParams.set('daily', 'weathercode,temperature_2m_max,sunrise,sunset');
  url.searchParams.set('timezone', params.timezone);
  url.searchParams.set('start_date', params.date);
  url.searchParams.set('end_date', params.date);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Open-Meteo request failed (${res.status})`);
    }

    const json = (await res.json()) as any;
    const daily = json?.daily;

    const weathercode = Number(daily?.weathercode?.[0]);
    const maxTempC = Number(daily?.temperature_2m_max?.[0]);
    const sunrise = String(daily?.sunrise?.[0] ?? '');
    const sunset = String(daily?.sunset?.[0] ?? '');

    if (!Number.isFinite(weathercode) || !Number.isFinite(maxTempC) || !sunrise || !sunset) {
      throw new Error('Open-Meteo response missing required daily fields.');
    }

    return {
      enabled: true,
      source: 'open-meteo',
      date: params.date,
      timezone: params.timezone,
      icon: iconFromWeatherCode(weathercode),
      maxTempC,
      sunriseLocal: hhmm(sunrise),
      sunsetLocal: hhmm(sunset),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(_request: NextRequest, context: { params: { itemId: string } }) {
  try {
    const { user } = await requireAuth();
    const itemId = context.params.itemId;

    const item = await prisma.calendarItem.findUnique({
      where: { id: itemId },
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

    if (profile?.defaultLat == null || profile?.defaultLon == null) {
      const disabled: WeatherResponseDisabled = { enabled: false, reason: 'NO_LOCATION' };
      return success(disabled, { headers });
    }

    const athleteUser = await prisma.user.findUnique({
      where: { id: item.athleteId },
      select: { timezone: true },
    });

    const athleteTz = athleteUser?.timezone ?? 'UTC';
    const dateKey = formatZonedDateKey(item.date, athleteTz);

    const latKey = profile.defaultLat.toFixed(4);
    const lonKey = profile.defaultLon.toFixed(4);
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

    const promise = fetchOpenMeteoDaily({
      lat: profile.defaultLat,
      lon: profile.defaultLon,
      date: dateKey,
      timezone: athleteTz,
    });

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
