import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { createCoachControlProposalFromDiff } from '@/modules/ai-plan-builder/server/proposals';
import { getProposalPreview } from '@/modules/ai-plan-builder/server/proposal-preview';
import type { PlanDiffOp } from '@/modules/ai-plan-builder/server/adaptation-diff';

const sessionEditSchema = z.object({
  sessionId: z.string().min(1),
  discipline: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  durationMinutes: z.number().int().min(0).max(10_000).optional(),
  notes: z.string().max(10_000).nullable().optional(),
  objective: z.string().max(500).nullable().optional(),
  blockEdits: z
    .array(
      z.object({
        blockIndex: z.number().int().min(0).max(100),
        steps: z.string().max(1_000),
      })
    )
    .optional(),
});

const manualEditProposeSchema = z.object({
  draftPlanId: z.string().min(1),
  scope: z.enum(['session', 'week', 'plan']).optional(),
  sessionEdits: z.array(sessionEditSchema).min(1),
});

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const payload = manualEditProposeSchema.parse(await request.json().catch(() => ({})));

    const sessionIds = payload.sessionEdits.map((e) => String(e.sessionId));
    const sessions = await prisma.aiPlanDraftSession.findMany({
      where: { draftId: payload.draftPlanId, id: { in: sessionIds } },
      select: { id: true, discipline: true, type: true, durationMinutes: true, notes: true },
    });
    const byId = new Map(sessions.map((s) => [String(s.id), s] as const));
    if (sessions.length !== sessionIds.length) throw new ApiError(400, 'VALIDATION_ERROR', 'One or more session edits target missing sessions.');

    const unsupportedEdits: string[] = [];
    const diffJson: PlanDiffOp[] = [];
    for (const edit of payload.sessionEdits) {
      const current = byId.get(String(edit.sessionId));
      if (!current) continue;
      const patch: Record<string, unknown> = {};
      if (typeof edit.discipline === 'string' && edit.discipline.trim() && edit.discipline.trim() !== String(current.discipline ?? '')) {
        patch.discipline = edit.discipline.trim();
      }
      if (typeof edit.type === 'string' && edit.type.trim() && edit.type.trim() !== String(current.type ?? '')) {
        patch.type = edit.type.trim();
      }
      if (typeof edit.durationMinutes === 'number' && Number.isFinite(edit.durationMinutes) && Math.round(edit.durationMinutes) !== Number(current.durationMinutes ?? 0)) {
        patch.durationMinutes = Math.round(edit.durationMinutes);
      }
      if (edit.notes !== undefined) {
        const nextNotes = edit.notes == null ? null : String(edit.notes);
        if (nextNotes !== (current.notes ?? null)) patch.notes = nextNotes;
      }
      if (edit.objective !== undefined || (Array.isArray(edit.blockEdits) && edit.blockEdits.length)) {
        unsupportedEdits.push(String(edit.sessionId));
      }
      if (!Object.keys(patch).length) continue;
      diffJson.push({
        op: 'UPDATE_SESSION',
        draftSessionId: String(edit.sessionId),
        patch: patch as { discipline?: string; type?: string; durationMinutes?: number; notes?: string | null },
      });
    }

    if (!diffJson.length) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        unsupportedEdits.length
          ? 'No diff-eligible edits found. Objective/block edits currently apply directly outside diff pipeline.'
          : 'No effective edits found to propose.'
      );
    }

    const created = await createCoachControlProposalFromDiff({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: payload.draftPlanId,
      diffJson,
      rationaleText: `Coach manual edit proposal (${payload.scope ?? 'session'})`,
      metadata: {
        source: 'manual_edit',
        scope: payload.scope ?? 'session',
        unsupportedEdits,
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
      proposedCount: diffJson.length,
      unsupportedEdits,
    });
  } catch (error) {
    return handleError(error);
  }
}
