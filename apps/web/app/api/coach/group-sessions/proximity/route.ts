import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { haversineDistanceKm } from '@/lib/geo-distance';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(200).default(15),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const { searchParams } = new URL(request.url);
    const { lat, lon, radiusKm, limit } = querySchema.parse({
      lat: searchParams.get('lat'),
      lon: searchParams.get('lon'),
      radiusKm: searchParams.get('radiusKm') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });

    const profiles = await prisma.athleteProfile.findMany({
      where: {
        coachId: user.id,
        defaultLat: { not: null },
        defaultLon: { not: null },
      },
      select: {
        userId: true,
        defaultLat: true,
        defaultLon: true,
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    const nearby = profiles
      .map((profile) => {
        const athleteLat = profile.defaultLat;
        const athleteLon = profile.defaultLon;
        if (athleteLat == null || athleteLon == null) return null;

        const distanceKm = haversineDistanceKm(lat, lon, athleteLat, athleteLon);
        return {
          athleteId: profile.userId,
          name: profile.user.name ?? profile.userId,
          distanceKm,
          defaultLat: athleteLat,
          defaultLon: athleteLon,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => row.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit)
      .map((row) => ({
        ...row,
        distanceKm: Math.round(row.distanceKm * 10) / 10,
      }));

    return success({
      center: { lat, lon },
      radiusKm,
      athletes: nearby,
      totalCandidates: profiles.length,
    });
  } catch (error) {
    return handleError(error);
  }
}
