import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z
    .string({ required_error: 'q is required.' })
    .trim()
    .min(2, { message: 'q must be at least 2 characters.' })
    .max(64, { message: 'q must be at most 64 characters.' }),
});

type OpenMeteoSearchResult = {
  name?: string;
  admin1?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
};

type GeocodeResult = {
  label: string;
  name: string;
  admin1: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
};

function buildLabel(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const { q } = querySchema.parse({ q: searchParams.get('q') });

    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', q);
    url.searchParams.set('count', '8');
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

      if (!res.ok) {
        throw new Error(`Geocoding request failed (${res.status})`);
      }

      const json = (await res.json()) as any;
      const raw = (json?.results ?? []) as OpenMeteoSearchResult[];

      const results: GeocodeResult[] = raw
        .map((item) => {
          const name = String(item.name ?? '').trim();
          const admin1 = item.admin1 ? String(item.admin1).trim() : null;
          const country = item.country_code ? String(item.country_code).trim() : item.country ? String(item.country).trim() : null;
          const latitude = Number(item.latitude);
          const longitude = Number(item.longitude);

          if (!name) return null;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

          const label = buildLabel([name, admin1, country]);

          return {
            label,
            name,
            admin1,
            country,
            latitude,
            longitude,
          };
        })
        .filter((v): v is GeocodeResult => Boolean(v));

      return success(
        { results },
        {
          headers: privateCacheHeaders({ maxAgeSeconds: 86400 }),
        }
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return handleError(error);
  }
}
