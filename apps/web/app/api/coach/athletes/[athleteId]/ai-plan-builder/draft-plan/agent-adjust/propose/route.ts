import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { applyAiAgentAdjustmentsToDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';
import { parseAgentAdjustRequest } from '@/modules/ai-plan-builder/server/agent-command';
import { createCoachControlProposalFromDiff } from '@/modules/ai-plan-builder/server/proposals';
import { getProposalPreview } from '@/modules/ai-plan-builder/server/proposal-preview';
import type { PlanDiffOp } from '@/modules/ai-plan-builder/server/adaptation-diff';

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const payload = parseAgentAdjustRequest(await request.json().catch(() => ({})));

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
        commandType: payload.command?.commandType ?? null,
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
