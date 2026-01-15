import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

type ReverseResult = {
  label: string;
  latitude: number;
  longitude: number;
};

function buildLabel(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

async function reverseWithOpenMeteo(params: { lat: number; lon: number }): Promise<ReverseResult | null> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/reverse');
  url.searchParams.set('latitude', String(params.lat));
  url.searchParams.set('longitude', String(params.lon));
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const json = (await res.json()) as any;
    const first = (json?.results?.[0] ?? null) as any;
    if (!first) return null;

    const name = String(first.name ?? '').trim();
    const admin1 = first.admin1 ? String(first.admin1).trim() : null;
    const country = first.country_code ? String(first.country_code).trim() : first.country ? String(first.country).trim() : null;

    const latitude = Number(first.latitude);
    const longitude = Number(first.longitude);

    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      label: buildLabel([name, admin1, country]),
      latitude,
      longitude,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function reverseWithNominatim(params: { lat: number; lon: number }): Promise<ReverseResult> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(params.lat));
  url.searchParams.set('lon', String(params.lon));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Accept-Language': 'en',
        'User-Agent': 'CoachKit',
      },
    });

    if (!res.ok) {
      throw new Error(`Reverse geocode failed (${res.status})`);
    }

    const json = (await res.json()) as any;
    const displayName = String(json?.display_name ?? '').trim();

    const latitude = Number(json?.lat);
    const longitude = Number(json?.lon);

    if (!displayName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        label: `${params.lat.toFixed(4)}, ${params.lon.toFixed(4)}`,
        latitude: params.lat,
        longitude: params.lon,
      };
    }

    return {
      label: displayName,
      latitude,
      longitude,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const { lat, lon } = querySchema.parse({
      lat: searchParams.get('lat'),
      lon: searchParams.get('lon'),
    });

    const openMeteo = await reverseWithOpenMeteo({ lat, lon });
    const resolved = openMeteo ?? (await reverseWithNominatim({ lat, lon }));

    return success(resolved, {
      headers: privateCacheHeaders({ maxAgeSeconds: 86400 }),
    });
  } catch (error) {
    return handleError(error);
  }
}
