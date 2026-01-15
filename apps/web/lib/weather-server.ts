import 'server-only';

import { WeatherIcon, WeatherSummary } from '@/lib/weather-model';

type CacheEntry<T> = {
  expiresAtMs: number;
  value: T;
};

const RANGE_CACHE_TTL_MS = 45 * 60 * 1000;
const rangeCache = new Map<string, CacheEntry<Record<string, WeatherSummary>>>();
const inFlight = new Map<string, Promise<Record<string, WeatherSummary>>>();

export function hhmm(value: string): string {
  const t = value.includes('T') ? value.split('T')[1] : value;
  return t.slice(0, 5);
}

export function iconFromWeatherCode(code: number): WeatherIcon {
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

async function fetchOpenMeteoDailyRange(params: {
  lat: number;
  lon: number;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  timezone: string;
}): Promise<Record<string, WeatherSummary>> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(params.lat));
  url.searchParams.set('longitude', String(params.lon));
  url.searchParams.set('daily', 'weathercode,temperature_2m_max,sunrise,sunset');
  url.searchParams.set('timezone', params.timezone);
  url.searchParams.set('start_date', params.from);
  url.searchParams.set('end_date', params.to);

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

    const days = Array.isArray(daily?.time) ? (daily.time as string[]) : [];
    const weathercodes = Array.isArray(daily?.weathercode) ? (daily.weathercode as Array<number | string>) : [];
    const maxTemps = Array.isArray(daily?.temperature_2m_max) ? (daily.temperature_2m_max as Array<number | string>) : [];
    const sunrises = Array.isArray(daily?.sunrise) ? (daily.sunrise as string[]) : [];
    const sunsets = Array.isArray(daily?.sunset) ? (daily.sunset as string[]) : [];

    const out: Record<string, WeatherSummary> = {};

    for (let i = 0; i < days.length; i++) {
      const date = String(days[i] ?? '');
      const weathercode = Number(weathercodes[i]);
      const maxTempC = Number(maxTemps[i]);
      const sunrise = String(sunrises[i] ?? '');
      const sunset = String(sunsets[i] ?? '');

      if (!date) continue;
      if (!Number.isFinite(weathercode) || !Number.isFinite(maxTempC) || !sunrise || !sunset) continue;

      out[date] = {
        icon: iconFromWeatherCode(weathercode),
        maxTempC,
        sunriseLocal: hhmm(sunrise),
        sunsetLocal: hhmm(sunset),
      };
    }

    return out;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getWeatherSummariesForRange(params: {
  lat: number;
  lon: number;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  timezone: string;
}): Promise<Record<string, WeatherSummary>> {
  const latKey = params.lat.toFixed(4);
  const lonKey = params.lon.toFixed(4);
  const cacheKey = `${latKey}|${lonKey}|${params.timezone}|${params.from}|${params.to}`;

  const now = Date.now();
  const cached = rangeCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) return cached.value;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = fetchOpenMeteoDailyRange(params);
  inFlight.set(cacheKey, promise);

  try {
    const value = await promise;
    rangeCache.set(cacheKey, { value, expiresAtMs: now + RANGE_CACHE_TTL_MS });
    return value;
  } finally {
    inFlight.delete(cacheKey);
  }
}
