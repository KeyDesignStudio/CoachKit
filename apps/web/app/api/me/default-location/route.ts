import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAthlete } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { forbidden } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    defaultLat: z.number().min(-90).max(90).nullable(),
    defaultLon: z.number().min(-180).max(180).nullable(),
    defaultLocationLabel: z.string().trim().max(80).nullable(),
  })
  .refine(
    (value) => {
      const hasLat = typeof value.defaultLat === 'number';
      const hasLon = typeof value.defaultLon === 'number';
      const hasEither = hasLat || hasLon;
      const hasBoth = hasLat && hasLon;
      return !hasEither || hasBoth;
    },
    {
      message: 'defaultLat and defaultLon must be provided together.',
    }
  );

export async function GET() {
  try {
    const { user } = await requireAthlete();

    const profile = await prisma.athleteProfile.findUnique({
      where: { userId: user.id },
      select: {
        defaultLat: true,
        defaultLon: true,
        defaultLocationLabel: true,
      },
    });

    if (!profile) {
      throw forbidden('Athlete profile not found.');
    }

    return success({
      defaultLat: profile.defaultLat,
      defaultLon: profile.defaultLon,
      defaultLocationLabel: profile.defaultLocationLabel,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const payload = schema.parse(await request.json());

    const updated = await prisma.athleteProfile.update({
      where: { userId: user.id },
      data: {
        defaultLat: payload.defaultLat,
        defaultLon: payload.defaultLon,
        defaultLocationLabel: payload.defaultLocationLabel,
      },
      select: {
        defaultLat: true,
        defaultLon: true,
        defaultLocationLabel: true,
      },
    });

    return success(updated);
  } catch (error) {
    return handleError(error);
  }
}
