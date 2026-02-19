import { NextRequest } from 'next/server';
import { z } from 'zod';

import { assertCoachOwnsAthlete, requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { getStravaVitalsForAthlete } from '@/lib/strava-vitals';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(14).max(365).optional(),
});

type RouteParams = {
  params: {
    athleteId: string;
  };
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { user } = await requireCoach();
    await assertCoachOwnsAthlete(params.athleteId, user.id);

    const { windowDays } = querySchema.parse({
      windowDays: new URL(request.url).searchParams.get('windowDays') ?? undefined,
    });

    const vitals = await getStravaVitalsForAthlete(params.athleteId, { windowDays });
    return success({ vitals });
  } catch (error) {
    return handleError(error);
  }
}
