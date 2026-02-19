import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { getStravaVitalsForAthlete } from '@/lib/strava-vitals';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(14).max(365).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const { windowDays } = querySchema.parse({
      windowDays: new URL(request.url).searchParams.get('windowDays') ?? undefined,
    });

    const vitals = await getStravaVitalsForAthlete(user.id, { windowDays });
    return success({ vitals });
  } catch (error) {
    return handleError(error);
  }
}
