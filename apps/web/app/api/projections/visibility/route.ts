import { z } from 'zod';

import { assertCoachOwnsAthlete, requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { emitFutureSelfEventServer } from '@/lib/future-self-analytics';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { requireFutureSelfV1Enabled } from '@/modules/future-self/server/flag';
import { updateProjectionVisibility } from '@/modules/future-self/server/service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  snapshot_id: z.string().trim().min(1),
  athlete_id: z.string().trim().min(1),
  visibility: z.object({
    performance: z.boolean().optional(),
    consistency: z.boolean().optional(),
    bodyComposition: z.boolean().optional(),
  }),
});

export async function POST(request: Request) {
  try {
    requireFutureSelfV1Enabled();
    const { user } = await requireCoach();
    const payload = schema.parse(await request.json());

    if (user.role === 'ADMIN') {
      const exists = await prisma.athleteProfile.findUnique({
        where: { userId: payload.athlete_id },
        select: { userId: true },
      });
      if (!exists) throw new ApiError(404, 'NOT_FOUND', 'Athlete not found.');
    } else {
      await assertCoachOwnsAthlete(payload.athlete_id, user.id);
    }

    const result = await updateProjectionVisibility({
      snapshotId: payload.snapshot_id,
      athleteId: payload.athlete_id,
      visibility: payload.visibility,
    });

    emitFutureSelfEventServer({
      eventName: 'future_self_toggle_visibility',
      actorId: user.id,
      actorRole: user.role,
      payload: {
        athleteId: payload.athlete_id,
        snapshotId: payload.snapshot_id,
        visibility: payload.visibility,
      },
    });

    return success(result);
  } catch (error) {
    return handleError(error, { where: 'POST /api/projections/visibility' });
  }
}
