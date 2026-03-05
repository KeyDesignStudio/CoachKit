import { NextRequest } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { notFound, forbidden } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { privateCacheHeaders } from '@/lib/cache';
import { getWeatherSummariesForRange, iconFromWeatherCode } from '@/lib/weather-server';

export const dynamic = 'force-dynamic';

type WeatherIcon = 'sunny' | 'partly_cloudy' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | 'wind';

type WeatherResponseEnabled = {
  enabled: true;
  source: 'strava' | 'open-meteo';
  mode: 'observed' | 'forecast';
  date: string; // YYYY-MM-DD
  timezone: string;
  icon: WeatherIcon;
  maxTempC: number;
  sunriseLocal: string; // HH:MM
  sunsetLocal: string; // HH:MM
  observedAtLocal?: string;
};

type WeatherResponseDisabled = {
  enabled: false;
  reason: 'NO_LOCATION';
};

type WeatherResponse = WeatherResponseEnabled | WeatherResponseDisabled;

type CacheEntry = {
  expiresAtMs: number;
  value: WeatherResponse;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<WeatherResponse>>();

function isValidCoordinate(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function formatZonedDateKey(date: Date, timeZone: string): string {
  // en-CA reliably formats to YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatZonedTimeHm(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

function formatZonedHour(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  return Number.isFinite(hh) ? hh : 0;
}

function firstFiniteNumber(candidates: unknown[]): number | null {
  for (const value of candidates) {
    const n = typeof value === 'string' ? Number(value) : (value as number);
    if (Number.isFinite(n)) return Number(n);
  }
  return null;
}

function iconFromConditionText(raw: unknown): WeatherIcon | null {
  const value = String(raw ?? '').toLowerCase().trim();
  if (!value) return null;
  if (value.includes('thunder') || value.includes('storm')) return 'storm';
  if (value.includes('snow') || value.includes('sleet') || value.includes('hail')) return 'snow';
  if (value.includes('fog') || value.includes('mist')) return 'fog';
  if (value.includes('rain') || value.includes('drizzle') || value.includes('shower')) return 'rain';
  if (value.includes('wind')) return 'wind';
  if (value.includes('partly') || value.includes('broken') || value.includes('scattered')) return 'partly_cloudy';
  if (value.includes('cloud') || value.includes('overcast')) return 'cloudy';
  if (value.includes('clear') || value.includes('sun')) return 'sunny';
  return null;
}

function extractStravaObservedWeather(strava: any): { tempC: number; icon: WeatherIcon | null } | null {
  if (!strava || typeof strava !== 'object') return null;
  const activity = (strava.activity ?? {}) as Record<string, unknown>;
  const weather = (activity.weather ?? {}) as Record<string, unknown>;

  const tempC = firstFiniteNumber([
    strava.temperatureC,
    strava.tempC,
    strava.temperature,
    strava.averageTempC,
    strava.avgTempC,
    activity.temperature,
    activity.temperature_c,
    activity.average_temp,
    weather.temperatureC,
    weather.temperature,
  ]);
  if (tempC == null) return null;

  const weatherCode = firstFiniteNumber([
    strava.weatherCode,
    strava.weathercode,
    activity.weather_code,
    weather.weathercode,
  ]);
  const iconFromCode = weatherCode == null ? null : iconFromWeatherCode(Math.round(weatherCode));
  const iconFromTextValue = iconFromConditionText(
    strava.weatherCondition ?? strava.conditions ?? activity.weather ?? weather.summary ?? weather.condition
  );

  return {
    tempC,
    icon: iconFromCode ?? iconFromTextValue,
  };
}

function getCompletionStart(item: {
  completedActivities?: Array<{
    source: string;
    startTime: Date;
    metricsJson: any;
  }>;
}): { startUtc: Date; stravaMetrics: any } | null {
  const completion = item.completedActivities?.[0];
  if (!completion) return null;

  const stravaMetrics = completion.metricsJson?.strava ?? null;
  if (completion.source === 'STRAVA') {
    const stravaStart = stravaMetrics?.startDateUtc;
    if (stravaStart) {
      const parsed = new Date(stravaStart);
      if (!Number.isNaN(parsed.getTime())) return { startUtc: parsed, stravaMetrics };
    }
  }

  if (completion.startTime && !Number.isNaN(completion.startTime.getTime())) {
    return { startUtc: completion.startTime, stravaMetrics };
  }

  return null;
}

async function fetchOpenMeteoHourlyObservation(params: {
  lat: number;
  lon: number;
  dateKey: string;
  timezone: string;
  targetHour: number;
}): Promise<{ icon: WeatherIcon; tempC: number; observedAtLocal: string } | null> {
  const run = async (baseUrl: string) => {
    const url = new URL(baseUrl);
    url.searchParams.set('latitude', String(params.lat));
    url.searchParams.set('longitude', String(params.lon));
    url.searchParams.set('hourly', 'temperature_2m,weathercode');
    url.searchParams.set('timezone', params.timezone);
    url.searchParams.set('start_date', params.dateKey);
    url.searchParams.set('end_date', params.dateKey);

    const res = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;

    const json = (await res.json()) as any;
    const hourly = json?.hourly;
    const times = Array.isArray(hourly?.time) ? (hourly.time as string[]) : [];
    const temps = Array.isArray(hourly?.temperature_2m) ? (hourly.temperature_2m as Array<number | string>) : [];
    const codes = Array.isArray(hourly?.weathercode) ? (hourly.weathercode as Array<number | string>) : [];
    if (times.length === 0) return null;

    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < times.length; i += 1) {
      const timeValue = String(times[i] ?? '');
      const hourRaw = Number(timeValue.split('T')[1]?.slice(0, 2) ?? NaN);
      if (!Number.isFinite(hourRaw)) continue;
      const dist = Math.abs(hourRaw - params.targetHour);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) return null;
    const tempC = Number(temps[bestIndex]);
    const weatherCode = Number(codes[bestIndex]);
    const timeValue = String(times[bestIndex] ?? '');
    const observedAtLocal = timeValue.split('T')[1]?.slice(0, 5) ?? `${String(params.targetHour).padStart(2, '0')}:00`;

    if (!Number.isFinite(tempC) || !Number.isFinite(weatherCode)) return null;
    return {
      icon: iconFromWeatherCode(weatherCode),
      tempC,
      observedAtLocal,
    };
  };

  const fromForecast = await run('https://api.open-meteo.com/v1/forecast');
  if (fromForecast) return fromForecast;
  return run('https://archive-api.open-meteo.com/v1/archive');
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
        completedActivities: {
          select: {
            source: true,
            startTime: true,
            metricsJson: true,
          },
          orderBy: { startTime: 'desc' },
          take: 1,
        },
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

    if (!isValidCoordinate(lat, -90, 90) || !isValidCoordinate(lon, -180, 180)) {
      const disabled: WeatherResponseDisabled = { enabled: false, reason: 'NO_LOCATION' };
      return success(disabled, { headers });
    }

    const athleteUser = await prisma.user.findUnique({
      where: { id: item.athleteId },
      select: { timezone: true },
    });

    const athleteTzRaw = athleteUser?.timezone ?? 'UTC';
    const athleteTz = isValidTimeZone(athleteTzRaw) ? athleteTzRaw : 'UTC';
    const completionStart = getCompletionStart(item);
    const anchorInstant = completionStart?.startUtc ?? item.date;
    const dateKey = formatZonedDateKey(anchorInstant, athleteTz);
    const targetHour = formatZonedHour(anchorInstant, athleteTz);
    const observedAtLocal = formatZonedTimeHm(anchorInstant, athleteTz);

    const latKey = lat.toFixed(4);
    const lonKey = lon.toFixed(4);
    const completionKey = completionStart?.startUtc.toISOString() ?? 'none';
    const cacheKey = `${item.athleteId}|${item.id}|${completionKey}|${dateKey}|${latKey}|${lonKey}|${athleteTz}`;

    const now = Date.now();
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAtMs > now) {
      return success(cached.value, { headers });
    }

    if (inFlight.has(cacheKey)) {
      const value = await inFlight.get(cacheKey)!;
      return success(value, { headers });
    }

    const promise: Promise<WeatherResponse> = (async () => {
      const map = await getWeatherSummariesForRange({
        lat,
        lon,
        from: dateKey,
        to: dateKey,
        timezone: athleteTz,
      });
      const summary = map[dateKey];
      const sunriseLocal = summary?.sunriseLocal ?? '--:--';
      const sunsetLocal = summary?.sunsetLocal ?? '--:--';

      const stravaObserved = extractStravaObservedWeather(completionStart?.stravaMetrics);
      if (stravaObserved) {
        return {
          enabled: true as const,
          source: 'strava' as const,
          mode: 'observed' as const,
          date: dateKey,
          timezone: athleteTz,
          icon: (stravaObserved.icon ?? summary?.icon ?? 'cloudy') as WeatherIcon,
          maxTempC: stravaObserved.tempC,
          sunriseLocal,
          sunsetLocal,
          observedAtLocal,
        };
      }

      if (completionStart) {
        const observed = await fetchOpenMeteoHourlyObservation({
          lat,
          lon,
          dateKey,
          timezone: athleteTz,
          targetHour,
        });
        if (observed) {
          return {
            enabled: true as const,
            source: 'open-meteo' as const,
            mode: 'observed' as const,
            date: dateKey,
            timezone: athleteTz,
            icon: observed.icon,
            maxTempC: observed.tempC,
            sunriseLocal,
            sunsetLocal,
            observedAtLocal: observed.observedAtLocal,
          };
        }
      }

      if (summary) {
        return {
          enabled: true as const,
          source: 'open-meteo' as const,
          mode: 'forecast' as const,
          date: dateKey,
          timezone: athleteTz,
          icon: summary.icon as WeatherIcon,
          maxTempC: summary.maxTempC,
          sunriseLocal: summary.sunriseLocal,
          sunsetLocal: summary.sunsetLocal,
        };
      }

      return { enabled: false, reason: 'NO_LOCATION' } as const;
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
