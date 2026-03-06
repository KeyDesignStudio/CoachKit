import { z } from 'zod';

import { requireCoach, assertCoachOwnsAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import {
  listCoachWorkoutExemplars,
  promoteDraftSessionToCoachWorkoutExemplar,
  recordCoachWorkoutExemplarFeedback,
} from '@/modules/ai-plan-builder/server/reference-recipes';

const querySchema = z.object({
  discipline: z.string().trim().optional(),
  sessionType: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const promoteBodySchema = z.object({
  action: z.literal('promoteDraftSession'),
  draftPlanId: z.string().min(1),
  draftSessionId: z.string().min(1),
});

const feedbackBodySchema = z.object({
  action: z.literal('feedback'),
  exemplarId: z.string().min(1),
  feedbackType: z.enum(['PROMOTED', 'UPDATED', 'GOOD_FIT', 'EDITED', 'TOO_EASY', 'TOO_HARD', 'ARCHIVED']),
  draftPlanId: z.string().min(1).optional(),
  draftSessionId: z.string().min(1).optional(),
  note: z.string().max(1000).nullable().optional(),
});

export async function GET(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    await assertCoachOwnsAthlete(context.params.athleteId, user.id);
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      discipline: searchParams.get('discipline') ?? undefined,
      sessionType: searchParams.get('sessionType') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });

    const exemplars = await listCoachWorkoutExemplars({
      coachId: user.id,
      discipline: query.discipline ?? null,
      sessionType: query.sessionType ?? null,
      limit: query.limit,
    });

    return success({ exemplars });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    await assertCoachOwnsAthlete(context.params.athleteId, user.id);
    const body = await request.json().catch(() => ({}));

    if ((body as any)?.action === 'feedback') {
      const payload = feedbackBodySchema.parse(body);
      await recordCoachWorkoutExemplarFeedback({
        coachId: user.id,
        exemplarId: payload.exemplarId,
        feedbackType: payload.feedbackType,
        athleteId: context.params.athleteId,
        draftId: payload.draftPlanId ?? null,
        draftSessionId: payload.draftSessionId ?? null,
        note: payload.note ?? null,
      });
      return success({ ok: true });
    }

    const payload = promoteBodySchema.parse(body);
    const exemplar = await promoteDraftSessionToCoachWorkoutExemplar({
      coachId: user.id,
      athleteId: context.params.athleteId,
      draftPlanId: payload.draftPlanId,
      draftSessionId: payload.draftSessionId,
    });

    return success({ exemplar });
  } catch (error) {
    return handleError(error);
  }
}
