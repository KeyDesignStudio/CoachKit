import { randomUUID, createHash } from 'crypto';

import { requireCoach } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import {
  createAiDraftPlan,
  generateAiDraftPlanV1,
  generateDraftPlanV1Schema,
  updateAiDraftPlan,
  updateDraftPlanV1Schema,
} from '@/modules/ai-plan-builder/server/draft-plan';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: { athleteId: string } }
) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const body = (await request.json().catch(() => ({}))) as { planJson?: unknown; setup?: unknown };

    // Tranche 2: deterministic generation.
    if (body?.setup !== undefined) {
      const { setup } = generateDraftPlanV1Schema.parse({ setup: body.setup });

      const draftPlan = await generateAiDraftPlanV1({
        coachId: user.id,
        athleteId: context.params.athleteId,
        setup,
      });

      return success({ draftPlan }, { status: 201 });
    }

    // Tranche 1: allow explicit planJson draft creation (kept for backwards compatibility).
    if (body?.planJson === undefined) {
      return failure('VALIDATION_ERROR', 'setup or planJson is required.', 400);
    }

    const draftPlan = await createAiDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      planJson: body.planJson,
    });

    return success({ draftPlan });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: { athleteId: string } }
) {
  const requestId = request.headers.get('x-request-id') ?? request.headers.get('x-vercel-id') ?? randomUUID();
  let rawBody: unknown = {};

  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    rawBody = await request.json().catch(() => ({}));
    const payload = updateDraftPlanV1Schema.parse(rawBody);

    const draftPlan = await updateAiDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      draftPlanId: payload.draftPlanId,
      weekLocks: payload.weekLocks,
      sessionEdits: payload.sessionEdits,
    });

    return success({ draftPlan });
  } catch (error) {
    // Request-scoped structured log for debugging production 500s.
    // Do not log raw notes; include only length + hash.
    try {
      const athleteId = context.params.athleteId;
      const draftPlanId = typeof (rawBody as any)?.draftPlanId === 'string' ? (rawBody as any).draftPlanId : null;
      const rawSessionEdits = Array.isArray((rawBody as any)?.sessionEdits) ? (rawBody as any).sessionEdits : [];
      const sessionEdits = rawSessionEdits.map((edit: any) => {
        const notes = typeof edit?.notes === 'string' ? edit.notes : null;
        const notesLength = notes ? notes.length : 0;
        const notesHash = notes ? createHash('sha256').update(notes, 'utf8').digest('hex') : null;
        return {
          sessionId: typeof edit?.sessionId === 'string' ? edit.sessionId : null,
          type: typeof edit?.type === 'string' ? edit.type : null,
          durationMinutes: typeof edit?.durationMinutes === 'number' ? edit.durationMinutes : null,
          notesLength,
          notesHash,
        };
      });

      const prismaCode =
        typeof (error as any)?.code === 'string' && /^P\d{4}$/.test((error as any).code) ? (error as any).code : null;

      console.error('APB_DRAFT_PLAN_PATCH_FAILED', {
        requestId,
        athleteId,
        draftPlanId,
        sessionEdits,
        prismaCode,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { value: error },
      });
    } catch (logError) {
      console.error('APB_DRAFT_PLAN_PATCH_LOG_FAILED', { requestId, logError });
    }

    return handleError(error, { requestId, where: 'PATCH /api/coach/athletes/[athleteId]/ai-plan-builder/draft-plan' });
  }
}
