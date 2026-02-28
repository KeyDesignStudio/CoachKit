import { z } from 'zod';

import { assertCoachOwnsAthlete, requireAuth } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { emitFutureSelfEventServer } from '@/lib/future-self-analytics';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { requireFutureSelfV1Enabled } from '@/modules/future-self/server/flag';
import { getLatestProjectionForAthlete } from '@/modules/future-self/server/service';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  athlete_id: z.string().trim().min(1).optional(),
});

export async function GET(request: Request) {
  try {
    requireFutureSelfV1Enabled();
    const { user } = await requireAuth();
    const url = new URL(request.url);
    const query = querySchema.parse({
      athlete_id: url.searchParams.get('athlete_id') ?? undefined,
    });

    let athleteId: string;

    if (user.role === 'ATHLETE') {
      athleteId = user.id;
    } else if (user.role === 'COACH' || user.role === 'ADMIN') {
      if (!query.athlete_id) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'athlete_id is required for coach requests.');
      }
      if (user.role === 'ADMIN') {
        const athlete = await prisma.athleteProfile.findUnique({
          where: { userId: query.athlete_id },
          select: { userId: true },
        });
        if (!athlete) throw new ApiError(404, 'NOT_FOUND', 'Athlete not found.');
        athleteId = athlete.userId;
      } else {
        const athlete = await assertCoachOwnsAthlete(query.athlete_id, user.id);
        athleteId = athlete.userId;
      }
    } else {
      throw new ApiError(403, 'FORBIDDEN', 'Unsupported role for projection access.');
    }

    const latest = await getLatestProjectionForAthlete(athleteId);
    if (!latest) return success({ snapshot: null });

    if (user.role === 'ATHLETE') {
      const visibility = (latest.visibility && typeof latest.visibility === 'object' ? latest.visibility : {}) as Record<string, unknown>;
      const outputs = (latest.outputs && typeof latest.outputs === 'object' ? latest.outputs : {}) as Record<string, unknown>;
      const horizons = outputs.horizons && typeof outputs.horizons === 'object' ? (outputs.horizons as Record<string, any>) : {};

      const filteredHorizons = Object.fromEntries(
        Object.entries(horizons).map(([horizon, value]) => {
          const item = value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {};
          if (!visibility.performance) item.performance = null;
          if (!visibility.consistency) item.consistency = null;
          if (!visibility.bodyComposition) item.bodyComposition = null;
          return [horizon, item];
        })
      );

      emitFutureSelfEventServer({
        eventName: 'future_self_view',
        actorId: user.id,
        actorRole: user.role,
        payload: {
          athleteId,
          snapshotId: latest.snapshotId,
        },
      });

      return success({
        snapshot: {
          ...latest,
          outputs: {
            ...outputs,
            horizons: filteredHorizons,
          },
        },
      });
    }

    return success({ snapshot: latest });
  } catch (error) {
    return handleError(error, { where: 'GET /api/projections/latest' });
  }
}
