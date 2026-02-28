import { z } from 'zod';

import { assertCoachOwnsAthlete, requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { emitFutureSelfEventServer } from '@/lib/future-self-analytics';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { requireFutureSelfV1Enabled } from '@/modules/future-self/server/flag';
import { runProjection } from '@/modules/future-self/server/service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  athlete_id: z.string().trim().min(1),
  horizon_weeks: z.number().int().min(4).max(24).default(12),
  scenario: z
    .object({
      adherencePct: z.union([z.literal(70), z.literal(85), z.literal(95)]).optional(),
      volumePct: z.union([z.literal(-10), z.literal(0), z.literal(10)]).optional(),
      intensityMode: z.union([z.literal('BASELINE'), z.literal('PLUS_ONE_HARD_SESSION')]).optional(),
      taperDays: z.union([z.literal(7), z.literal(10), z.null()]).optional(),
    })
    .optional(),
  visibility: z
    .object({
      performance: z.boolean().optional(),
      consistency: z.boolean().optional(),
      bodyComposition: z.boolean().optional(),
    })
    .optional(),
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

    const result = await runProjection({
      athleteId: payload.athlete_id,
      createdBy: user.id,
      createdByType: 'COACH',
      scenario: payload.scenario,
      horizonWeeks: payload.horizon_weeks,
      visibility: payload.visibility,
    });

    emitFutureSelfEventServer({
      eventName: 'future_self_run_projection',
      actorId: user.id,
      actorRole: user.role,
      payload: {
        athleteId: payload.athlete_id,
        horizonWeeks: payload.horizon_weeks,
        scenario: payload.scenario ?? {},
      },
    });

    return success(result);
  } catch (error) {
    return handleError(error, { where: 'POST /api/projections/run' });
  }
}
