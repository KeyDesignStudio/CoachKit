import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';
import { planDiffSchema, type PlanDiffOp } from './adaptation-diff';
import { renderProposalDiff, type DiffViewModel } from './proposal-diff-renderer';

export const proposalPreviewQuerySchema = z.object({
  aiPlanDraftId: z.string().min(1),
});

export type ApplySafety = {
  respectsLocks: boolean;
  wouldFailDueToLocks: boolean;
  reasons: Array<{ code: 'WEEK_LOCKED' | 'SESSION_LOCKED' | 'NOT_FOUND'; message: string }>;
};

async function checkDiffLockSafety(params: {
  aiPlanDraftId: string;
  diff: PlanDiffOp[];
}): Promise<ApplySafety> {
  const weekIndicesToTouch = new Set<number>();
  const sessionIdsToTouch = new Set<string>();

  for (const op of params.diff) {
    if (op.op === 'ADJUST_WEEK_VOLUME' || (op.op === 'ADD_NOTE' && op.target === 'week')) {
      weekIndicesToTouch.add(op.weekIndex);
    }
    if (op.op === 'UPDATE_SESSION' || op.op === 'SWAP_SESSION_TYPE') {
      sessionIdsToTouch.add(op.draftSessionId);
    }
    if (op.op === 'ADD_NOTE' && op.target === 'session') {
      sessionIdsToTouch.add(op.draftSessionId);
    }
  }

  const reasons: ApplySafety['reasons'] = [];

  if (weekIndicesToTouch.size) {
    const lockedWeeks = await prisma.aiPlanDraftWeek.findMany({
      where: { draftId: params.aiPlanDraftId, weekIndex: { in: Array.from(weekIndicesToTouch) }, locked: true },
      select: { weekIndex: true },
      orderBy: [{ weekIndex: 'asc' }],
    });

    for (const w of lockedWeeks) {
      reasons.push({ code: 'WEEK_LOCKED', message: `weekIndex=${w.weekIndex} is locked.` });
    }
  }

  if (sessionIdsToTouch.size) {
    const sessions = await prisma.aiPlanDraftSession.findMany({
      where: { id: { in: Array.from(sessionIdsToTouch) }, draftId: params.aiPlanDraftId },
      select: { id: true, weekIndex: true, locked: true },
    });

    if (sessions.length !== sessionIdsToTouch.size) {
      reasons.push({ code: 'NOT_FOUND', message: 'One or more draft sessions were not found.' });
    } else {
      for (const s of sessions.filter((x) => x.locked)) {
        reasons.push({ code: 'SESSION_LOCKED', message: `sessionId=${s.id} is locked.` });
      }

      const weekIndices = Array.from(new Set(sessions.map((s) => s.weekIndex)));
      const lockedWeek = await prisma.aiPlanDraftWeek.findFirst({
        where: { draftId: params.aiPlanDraftId, weekIndex: { in: weekIndices }, locked: true },
        select: { weekIndex: true },
      });
      if (lockedWeek) {
        reasons.push({ code: 'WEEK_LOCKED', message: `weekIndex=${lockedWeek.weekIndex} is locked.` });
      }
    }
  }

  const wouldFailDueToLocks = reasons.some((r) => r.code === 'WEEK_LOCKED' || r.code === 'SESSION_LOCKED' || r.code === 'NOT_FOUND');

  return {
    // respectsLocks is the proposal's computed field; API caller will set it.
    respectsLocks: true,
    wouldFailDueToLocks,
    reasons,
  };
}

export async function getProposalPreview(params: {
  coachId: string;
  athleteId: string;
  proposalId: string;
  aiPlanDraftId: string;
}): Promise<{ preview: DiffViewModel; applySafety: ApplySafety }> {
  requireAiPlanBuilderV1Enabled();

  const proposal = await prisma.planChangeProposal.findFirst({
    where: { id: params.proposalId, athleteId: params.athleteId, coachId: params.coachId },
  });

  if (!proposal) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found.');

  const parsed = planDiffSchema.safeParse(proposal.diffJson ?? null);
  if (!parsed.success) throw new ApiError(400, 'INVALID_DIFF', 'Proposal diffJson is invalid.');

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: {
      id: true,
      athleteId: true,
      coachId: true,
      planJson: true,
      weeks: { select: { weekIndex: true, locked: true }, orderBy: [{ weekIndex: 'asc' }] },
      sessions: {
        select: {
          id: true,
          weekIndex: true,
          ordinal: true,
          dayOfWeek: true,
          discipline: true,
          type: true,
          durationMinutes: true,
          locked: true,
        },
        orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
      },
    },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  // Safety re-check is based on current lock state.
  const safety = await checkDiffLockSafety({ aiPlanDraftId: draft.id, diff: parsed.data });

  const preview = renderProposalDiff(
    {
      id: String(proposal.id),
      diffJson: proposal.diffJson,
      draftSessions: draft.sessions.map((s) => ({
        id: String(s.id),
        weekIndex: s.weekIndex,
        ordinal: s.ordinal,
        dayOfWeek: s.dayOfWeek,
        discipline: String(s.discipline ?? ''),
        type: String(s.type ?? ''),
        durationMinutes: s.durationMinutes,
        locked: Boolean(s.locked),
      })),
    },
    draft.planJson
  );

  return {
    preview,
    applySafety: {
      respectsLocks: Boolean(proposal.respectsLocks),
      wouldFailDueToLocks: safety.wouldFailDueToLocks,
      reasons: safety.reasons,
    },
  };
}
