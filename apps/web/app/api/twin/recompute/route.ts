import { z } from 'zod';

import { assertCoachOwnsAthlete, requireAuth } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { requireFutureSelfV1Enabled } from '@/modules/future-self/server/flag';
import { recomputeTwin } from '@/modules/future-self/server/service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  athlete_id: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    requireFutureSelfV1Enabled();
    const { user } = await requireAuth();
    const payload = schema.parse(await request.json());

    let athleteId: string;

    if (user.role === 'ATHLETE') {
      athleteId = user.id;
    } else if (user.role === 'COACH' || user.role === 'ADMIN') {
      if (!payload.athlete_id) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'athlete_id is required for coach/admin requests.');
      }
      if (user.role === 'ADMIN') {
        const athlete = await prisma.athleteProfile.findUnique({
          where: { userId: payload.athlete_id },
          select: { userId: true },
        });
        if (!athlete) throw new ApiError(404, 'NOT_FOUND', 'Athlete not found.');
        athleteId = athlete.userId;
      } else {
        const athlete = await assertCoachOwnsAthlete(payload.athlete_id, user.id);
        athleteId = athlete.userId;
      }
    } else {
      throw new ApiError(403, 'FORBIDDEN', 'Unsupported role for twin recompute.');
    }

    const twin = await recomputeTwin(athleteId);
    return success(twin);
  } catch (error) {
    return handleError(error, { where: 'POST /api/twin/recompute' });
  }
}
