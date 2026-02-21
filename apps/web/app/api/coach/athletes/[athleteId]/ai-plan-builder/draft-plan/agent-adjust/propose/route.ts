import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { applyAiAgentAdjustmentsToDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';
import { createCoachControlProposalFromDiff } from '@/modules/ai-plan-builder/server/proposals';
import { getProposalPreview } from '@/modules/ai-plan-builder/server/proposal-preview';
import type { PlanDiffOp } from '@/modules/ai-plan-builder/server/adaptation-diff';

const agentAdjustProposeSchema = z
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
    const payload = agentAdjustProposeSchema.parse(await request.json().catch(() => ({})));

    const dryRun = await applyAiAgentAdjustmentsToDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      draftPlanId: payload.draftPlanId,
      scope: payload.scope,
      instruction: payload.instruction,
      weekIndex: payload.weekIndex,
      sessionId: payload.sessionId,
      dryRun: true,
    });

    const sessionEdits = Array.isArray((dryRun as any)?.sessionEdits) ? ((dryRun as any).sessionEdits as Array<any>) : [];
    const diffJson: PlanDiffOp[] = sessionEdits.map((edit) => {
      const patch: Record<string, unknown> = {};
      if (typeof edit?.type === 'string' && edit.type.trim()) patch.type = edit.type.trim();
      if (Number.isFinite(Number(edit?.durationMinutes))) patch.durationMinutes = Math.round(Number(edit.durationMinutes));
      if (edit?.notes !== undefined) patch.notes = edit.notes == null ? null : String(edit.notes);
      return {
        op: 'UPDATE_SESSION' as const,
        draftSessionId: String(edit.sessionId),
        patch: patch as {
          type?: string;
          durationMinutes?: number;
          notes?: string | null;
        },
      };
    });

    const created = await createCoachControlProposalFromDiff({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: payload.draftPlanId,
      diffJson,
      rationaleText: `CoachKit AI adjustment (${payload.scope})`,
      metadata: {
        source: 'agent_adjust',
        scope: payload.scope,
        instruction: payload.instruction,
        weekIndex: payload.weekIndex ?? null,
        sessionId: payload.sessionId ?? null,
      },
    });

    const preview = await getProposalPreview({
      coachId: user.id,
      athleteId: context.params.athleteId,
      proposalId: String(created.proposal.id),
      aiPlanDraftId: payload.draftPlanId,
    });

    return success({
      proposal: created.proposal,
      preview: preview.preview,
      applySafety: preview.applySafety,
      proposedCount: Number((dryRun as any)?.appliedCount ?? 0),
    });
  } catch (error) {
    return handleError(error);
  }
}
