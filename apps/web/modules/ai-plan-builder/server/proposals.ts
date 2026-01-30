import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';
import { planDiffSchema, type PlanDiffOp } from './adaptation-diff';
import { applyPlanDiffToDraft } from './adaptation-diff';
import { publishAiDraftPlan } from './publish';

import { getAiPlanBuilderAI } from '../ai/factory';
import type { AiAdaptationTriggerType } from '../ai/types';

export const generateProposalSchema = z.object({
  aiPlanDraftId: z.string().min(1),
  triggerIds: z.array(z.string().min(1)).optional(),
});

export const approveRejectSchema = z.object({
  // no body today; reserved for later
});

export const batchApproveSchema = z.object({
  aiPlanDraftId: z.string().min(1),
  proposalIds: z.array(z.string().min(1)).optional(),
  maxHours: z.number().int().min(1).max(168).optional(),
  mode: z.enum(['approve', 'approve_and_publish']).optional(),
});

export const updateProposalDiffSchema = z.object({
  diffJson: planDiffSchema,
});

export async function generatePlanChangeProposal(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  triggerIds?: string[];
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: {
      id: true,
      athleteId: true,
      coachId: true,
      setupJson: true,
      weeks: { select: { weekIndex: true, locked: true }, orderBy: [{ weekIndex: 'asc' }] },
      sessions: {
        select: { id: true, weekIndex: true, ordinal: true, dayOfWeek: true, type: true, durationMinutes: true, notes: true, locked: true },
        orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
      },
    },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  // Choose triggers: either explicit IDs, or the latest windowEnd set.
  let triggers = params.triggerIds?.length
    ? await prisma.adaptationTrigger.findMany({
        where: { id: { in: params.triggerIds }, athleteId: params.athleteId, coachId: params.coachId, draftId: draft.id },
        orderBy: [{ triggerType: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      })
    : [];

  if (!triggers.length) {
    const latest = await prisma.adaptationTrigger.findFirst({
      where: { athleteId: params.athleteId, coachId: params.coachId, draftId: draft.id },
      orderBy: [{ windowEnd: 'desc' }, { createdAt: 'desc' }],
      select: { windowEnd: true },
    });

    if (latest?.windowEnd) {
      triggers = await prisma.adaptationTrigger.findMany({
        where: {
          athleteId: params.athleteId,
          coachId: params.coachId,
          draftId: draft.id,
          windowEnd: latest.windowEnd,
        },
        orderBy: [{ triggerType: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
    }
  }

  const triggerTypes = Array.from(new Set(triggers.map((t) => String(t.triggerType)))).sort() as AiAdaptationTriggerType[];

  const ai = getAiPlanBuilderAI();
  const suggestion = await ai.suggestProposalDiffs({
    triggerTypes,
    draft: {
      weeks: draft.weeks.map((w) => ({ weekIndex: w.weekIndex, locked: Boolean(w.locked) })),
      sessions: draft.sessions.map((s) => ({
        id: String(s.id),
        weekIndex: s.weekIndex,
        ordinal: s.ordinal,
        dayOfWeek: s.dayOfWeek,
        type: String(s.type ?? ''),
        durationMinutes: s.durationMinutes,
        notes: (s.notes ?? null) as string | null,
        locked: Boolean(s.locked),
      })),
    },
  });

  const ops: PlanDiffOp[] = suggestion.diff;
  const rationaleText = suggestion.rationaleText;
  const respectsLocks = suggestion.respectsLocks;

  const proposal = await prisma.planChangeProposal.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      status: 'PROPOSED',
      draftPlanId: draft.id,
      proposalJson: { diffJson: ops, rationaleText, triggerIds: triggers.map((t) => t.id) } as Prisma.InputJsonValue,
      diffJson: ops as unknown as Prisma.InputJsonValue,
      rationaleText,
      triggerIds: triggers.map((t) => t.id),
      respectsLocks,
    },
  });

  return { proposal, diff: ops, triggerIds: triggers.map((t) => t.id) };
}

export async function listPlanChangeProposals(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  limit?: number;
  offset?: number;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const limit = Math.max(1, Math.min(200, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);

  return prisma.planChangeProposal.findMany({
    where: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      draftPlanId: params.aiPlanDraftId,
    },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    skip: offset,
  });
}

export async function getPlanChangeProposal(params: {
  coachId: string;
  athleteId: string;
  proposalId: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.planChangeProposal.findFirst({
    where: { id: params.proposalId, athleteId: params.athleteId, coachId: params.coachId },
  });
}

export async function rejectPlanChangeProposal(params: {
  coachId: string;
  athleteId: string;
  proposalId: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const proposal = await prisma.planChangeProposal.findFirst({
    where: { id: params.proposalId, athleteId: params.athleteId, coachId: params.coachId },
    select: { id: true, status: true },
  });

  if (!proposal) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found.');

  if (proposal.status === 'APPLIED') {
    throw new ApiError(409, 'INVALID_STATUS', 'Proposal is already applied.');
  }

  return prisma.planChangeProposal.update({
    where: { id: proposal.id },
    data: { status: 'REJECTED', coachDecisionAt: new Date() },
  });
}

export async function approvePlanChangeProposal(params: {
  coachId: string;
  athleteId: string;
  proposalId: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const proposal = await prisma.planChangeProposal.findFirst({
    where: { id: params.proposalId, athleteId: params.athleteId, coachId: params.coachId },
  });

  if (!proposal) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found.');
  if (!proposal.draftPlanId) throw new ApiError(400, 'INVALID_PROPOSAL', 'Proposal is missing draftPlanId.');

  if (proposal.status !== 'PROPOSED') {
    throw new ApiError(409, 'INVALID_STATUS', `Proposal must be PROPOSED to approve (current=${proposal.status}).`);
  }

  const parsed = planDiffSchema.safeParse(proposal.diffJson ?? null);
  if (!parsed.success) {
    throw new ApiError(400, 'INVALID_DIFF', 'Proposal diffJson is invalid.');
  }

  const diff = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    // Ensure the draft still belongs to the same coach/athlete.
    const draft = await tx.aiPlanDraft.findUnique({
      where: { id: proposal.draftPlanId ?? undefined },
      select: { id: true, athleteId: true, coachId: true },
    });

    if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
      throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
    }

    await applyPlanDiffToDraft({ tx, draftId: draft.id, diff });

    const audit = await tx.planChangeAudit.create({
      data: {
        athleteId: params.athleteId,
        coachId: params.coachId,
        proposalId: proposal.id,
        eventType: 'APPLY_PROPOSAL',
        actorType: 'COACH',
        draftPlanId: draft.id,
        changeSummaryText: 'Applied plan change proposal to AiPlanDraft.',
        diffJson: diff as unknown as Prisma.InputJsonValue,
      },
    });

    const updatedProposal = await tx.planChangeProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'APPLIED',
        coachDecisionAt: new Date(),
        appliedAt: new Date(),
      },
    });

    const updatedDraft = await tx.aiPlanDraft.findUniqueOrThrow({
      where: { id: draft.id },
      include: {
        weeks: { orderBy: [{ weekIndex: 'asc' }] },
        sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
      },
    });

    return { updatedDraft, audit, updatedProposal };
  });

  return result;
}

async function diffTouchesLockedEntities(params: {
  aiPlanDraftId: string;
  diff: PlanDiffOp[];
}): Promise<{ ok: true } | { ok: false; code: 'WEEK_LOCKED' | 'SESSION_LOCKED' | 'NOT_FOUND'; message: string }>
{
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

  if (weekIndicesToTouch.size) {
    const lockedWeek = await prisma.aiPlanDraftWeek.findFirst({
      where: { draftId: params.aiPlanDraftId, weekIndex: { in: Array.from(weekIndicesToTouch) }, locked: true },
      select: { weekIndex: true },
    });
    if (lockedWeek) {
      return { ok: false, code: 'WEEK_LOCKED', message: `weekIndex=${lockedWeek.weekIndex} is locked.` };
    }
  }

  if (sessionIdsToTouch.size) {
    const sessions = await prisma.aiPlanDraftSession.findMany({
      where: { id: { in: Array.from(sessionIdsToTouch) }, draftId: params.aiPlanDraftId },
      select: { id: true, weekIndex: true, locked: true },
    });

    if (sessions.length !== sessionIdsToTouch.size) {
      return { ok: false, code: 'NOT_FOUND', message: 'One or more draft sessions were not found.' };
    }

    const lockedSession = sessions.find((s) => s.locked);
    if (lockedSession) {
      return { ok: false, code: 'SESSION_LOCKED', message: `sessionId=${lockedSession.id} is locked.` };
    }

    const weekIndices = Array.from(new Set(sessions.map((s) => s.weekIndex)));
    const lockedWeek = await prisma.aiPlanDraftWeek.findFirst({
      where: { draftId: params.aiPlanDraftId, weekIndex: { in: weekIndices }, locked: true },
      select: { weekIndex: true },
    });
    if (lockedWeek) {
      return { ok: false, code: 'WEEK_LOCKED', message: `weekIndex=${lockedWeek.weekIndex} is locked.` };
    }
  }

  return { ok: true };
}

export async function batchApproveSafeProposals(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  proposalIds?: string[];
  maxHours?: number;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const now = new Date();
  const since = params.maxHours ? new Date(now.getTime() - params.maxHours * 60 * 60 * 1000) : null;

  const proposals = await prisma.planChangeProposal.findMany({
    where: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      draftPlanId: params.aiPlanDraftId,
      status: 'PROPOSED',
      respectsLocks: true,
      ...(params.proposalIds?.length ? { id: { in: params.proposalIds } } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const results: Array<{
    proposalId: string;
    ok: boolean;
    code?: string;
    message?: string;
    auditId?: string;
  }> = [];

  let lastDraft: any | null = null;

  for (const proposal of proposals) {
    const parsed = planDiffSchema.safeParse(proposal.diffJson ?? null);
    if (!parsed.success) {
      results.push({ proposalId: String(proposal.id), ok: false, code: 'INVALID_DIFF', message: 'Proposal diffJson is invalid.' });
      continue;
    }

    const diff = parsed.data;

    const safety = await diffTouchesLockedEntities({ aiPlanDraftId: params.aiPlanDraftId, diff });
    if (!safety.ok) {
      results.push({ proposalId: String(proposal.id), ok: false, code: safety.code, message: safety.message });
      continue;
    }

    try {
      const approved = await approvePlanChangeProposal({
        coachId: params.coachId,
        athleteId: params.athleteId,
        proposalId: String(proposal.id),
      });
      lastDraft = approved.updatedDraft;
      results.push({ proposalId: String(proposal.id), ok: true, auditId: String(approved.audit.id) });
    } catch (e) {
      if (e instanceof ApiError) {
        results.push({ proposalId: String(proposal.id), ok: false, code: e.code, message: e.message });
        continue;
      }
      results.push({ proposalId: String(proposal.id), ok: false, code: 'UNKNOWN', message: e instanceof Error ? e.message : 'Unknown error' });
    }
  }

  const approvedCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - approvedCount;

  return { results, approvedCount, failedCount, draft: lastDraft };
}

export async function batchApproveSafeProposalsWithMode(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  proposalIds?: string[];
  maxHours?: number;
  mode?: 'approve' | 'approve_and_publish';
}) {
  const batch = await batchApproveSafeProposals({
    coachId: params.coachId,
    athleteId: params.athleteId,
    aiPlanDraftId: params.aiPlanDraftId,
    proposalIds: params.proposalIds,
    maxHours: params.maxHours,
  });

  if ((params.mode ?? 'approve') !== 'approve_and_publish') {
    return { batch };
  }

  if (Number(batch.approvedCount ?? 0) <= 0) {
    return { batch, publish: { ok: true as const, published: false, hash: null as string | null, lastPublishedSummaryText: null as string | null, skipped: true as const } };
  }

  try {
    const publish = await publishAiDraftPlan({
      coachId: params.coachId,
      athleteId: params.athleteId,
      aiPlanDraftId: params.aiPlanDraftId,
    });

    return {
      batch,
      publish: {
        ok: true as const,
        published: publish.published,
        hash: publish.hash,
        lastPublishedSummaryText: publish.summaryText,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Publish failed.';
    return { batch, publish: { ok: false as const, code: 'PUBLISH_FAILED', message } };
  }
}

export async function updatePlanChangeProposalDiff(params: {
  coachId: string;
  athleteId: string;
  proposalId: string;
  diffJson: PlanDiffOp[];
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const proposal = await prisma.planChangeProposal.findFirst({
    where: { id: params.proposalId, athleteId: params.athleteId, coachId: params.coachId },
    select: { id: true, status: true, draftPlanId: true, proposalJson: true },
  });

  if (!proposal) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found.');
  if (proposal.status !== 'PROPOSED') {
    throw new ApiError(409, 'INVALID_STATUS', `Proposal must be PROPOSED to edit (current=${proposal.status}).`);
  }
  if (!proposal.draftPlanId) {
    throw new ApiError(400, 'INVALID_PROPOSAL', 'Proposal is missing draftPlanId.');
  }

  // Recompute respectsLocks based on current lock state.
  const safety = await diffTouchesLockedEntities({ aiPlanDraftId: proposal.draftPlanId, diff: params.diffJson });
  const respectsLocks = safety.ok;

  const nextProposalJson = {
    ...(proposal.proposalJson as any),
    diffJson: params.diffJson,
  } as Prisma.InputJsonValue;

  return prisma.planChangeProposal.update({
    where: { id: proposal.id },
    data: {
      diffJson: params.diffJson as unknown as Prisma.InputJsonValue,
      proposalJson: nextProposalJson,
      respectsLocks,
    },
  });
}
