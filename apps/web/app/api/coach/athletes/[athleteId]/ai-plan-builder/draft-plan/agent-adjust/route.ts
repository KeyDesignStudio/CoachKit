import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { applyAiAgentAdjustmentsToDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';

export const runtime = 'nodejs';

const agentAdjustSchema = z
  .object({
    draftPlanId: z.string().min(1),
    scope: z.enum(['session', 'week', 'plan']),
    instruction: z.string().min(3).max(2_000),
    weekIndex: z.number().int().min(0).max(52).optional(),
    sessionId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === 'week' && value.weekIndex == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weekIndex'],
        message: 'weekIndex is required for week scope.',
      });
    }
    if (value.scope === 'session' && !value.sessionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sessionId'],
        message: 'sessionId is required for session scope.',
      });
    }
  });

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const payload = agentAdjustSchema.parse(await request.json().catch(() => ({})));

    const result = await applyAiAgentAdjustmentsToDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      draftPlanId: payload.draftPlanId,
      scope: payload.scope,
      instruction: payload.instruction,
      weekIndex: payload.weekIndex,
      sessionId: payload.sessionId,
    });

    return success(result);
  } catch (error) {
    return handleError(error);
  }
}

