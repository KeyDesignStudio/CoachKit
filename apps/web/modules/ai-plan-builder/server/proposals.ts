import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';
import { planDiffSchema, type PlanDiffOp } from './adaptation-diff';
import { applyPlanDiffToDraft } from './adaptation-diff';
import { publishAiDraftPlan } from './publish';
import { evaluateProposalHardSafety, rewriteProposalDiffForSafeApply, summarizeProposalAction } from './adaptation-action-engine';
import { assessTriggerQuality, buildReasonChain } from './adaptation-explainability';

import { getAiPlanBuilderAIForCoachRequest } from './ai';
import type { AiAdaptationTriggerType } from '../ai/types';

type SessionBaselineSnapshot = {
  id: string;
  weekIndex: number;
  ordinal: number;
  dayOfWeek: number;
  discipline: string;
  type: string;
  durationMinutes: number;
  notes: string | null;
};

function sessionSnapshotHash(s: SessionBaselineSnapshot) {
  return JSON.stringify([
    String(s.id),
    Number(s.weekIndex),
    Number(s.ordinal),
    Number(s.dayOfWeek),
    String(s.discipline),
    String(s.type),
    Number(s.durationMinutes),
    s.notes == null ? null : String(s.notes),
  ]);
}

async function collectTouchedSessionSnapshots(params: {
  client: typeof prisma | Prisma.TransactionClient;
  aiPlanDraftId: string;
  diff: PlanDiffOp[];
}) {
  const explicitSessionIds = new Set<string>();
  const weekIndices = new Set<number>();

  for (const op of params.diff) {
    if (op.op === 'UPDATE_SESSION' || op.op === 'SWAP_SESSION_TYPE' || op.op === 'REMOVE_SESSION') {
      explicitSessionIds.add(String(op.draftSessionId));
      continue;
    }
    if (op.op === 'ADD_NOTE' && op.target === 'session') {
      explicitSessionIds.add(String(op.draftSessionId));
      continue;
    }
    if (op.op === 'ADD_NOTE' && op.target === 'week') {
      weekIndices.add(Number(op.weekIndex));
      continue;
    }
    if (op.op === 'ADJUST_WEEK_VOLUME') {
      weekIndices.add(Number(op.weekIndex));
      continue;
    }
  }

  const byId = explicitSessionIds.size
    ? await params.client.aiPlanDraftSession.findMany({
        where: { draftId: params.aiPlanDraftId, id: { in: Array.from(explicitSessionIds) } },
        select: {
          id: true,
          weekIndex: true,
          ordinal: true,
          dayOfWeek: true,
          discipline: true,
          type: true,
          durationMinutes: true,
          notes: true,
        },
      })
    : [];

  const byWeek = weekIndices.size
    ? await params.client.aiPlanDraftSession.findMany({
        where: { draftId: params.aiPlanDraftId, weekIndex: { in: Array.from(weekIndices) } },
        select: {
          id: true,
          weekIndex: true,
          ordinal: true,
          dayOfWeek: true,
          discipline: true,
          type: true,
          durationMinutes: true,
          notes: true,
        },
      })
    : [];

  const merged = [...byId, ...byWeek];
  const dedup = new Map<string, SessionBaselineSnapshot>();
  for (const s of merged) {
    const id = String(s.id);
    if (!id || dedup.has(id)) continue;
    dedup.set(id, {
      id,
      weekIndex: Number(s.weekIndex ?? 0),
      ordinal: Number(s.ordinal ?? 0),
      dayOfWeek: Number(s.dayOfWeek ?? 0),
      discipline: String(s.discipline ?? ''),
      type: String(s.type ?? ''),
      durationMinutes: Number(s.durationMinutes ?? 0),
      notes: s.notes == null ? null : String(s.notes),
    });
  }
  return Array.from(dedup.values());
}

async function buildProposalConflictBaseline(params: {
  aiPlanDraftId: string;
  diff: PlanDiffOp[];
}) {
  const snapshots = await collectTouchedSessionSnapshots({
    client: prisma,
    aiPlanDraftId: params.aiPlanDraftId,
    diff: params.diff,
  });
  return snapshots.map((s) => ({ id: s.id, hash: sessionSnapshotHash(s) }));
}

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

export async function createCoachControlProposalFromDiff(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  diffJson: PlanDiffOp[];
  rationaleText?: string;
  metadata?: Record<string, unknown>;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: { id: true, athleteId: true, coachId: true },
  });
  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  const lockSafety = await diffTouchesLockedEntities({ aiPlanDraftId: draft.id, diff: params.diffJson });
  const respectsLocks = lockSafety.ok;
  const status: 'PROPOSED' | 'DRAFT' = respectsLocks ? 'PROPOSED' : 'DRAFT';
  const baselineSessions = await buildProposalConflictBaseline({ aiPlanDraftId: draft.id, diff: params.diffJson });

  const proposal = await prisma.planChangeProposal.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      status,
      draftPlanId: draft.id,
      proposalJson: {
        source: 'coach_control_plane',
        diffJson: params.diffJson,
        baselineSessions,
        metadata: params.metadata ?? {},
      } as Prisma.InputJsonValue,
      diffJson: params.diffJson as unknown as Prisma.InputJsonValue,
      rationaleText: params.rationaleText ?? 'Coach control plane proposal',
      triggerIds: [],
      respectsLocks,
    },
  });

  return { proposal, lockSafety };
}

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

  const ai = getAiPlanBuilderAIForCoachRequest({ coachId: params.coachId, athleteId: params.athleteId });
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

  const rewriteSafety = rewriteProposalDiffForSafeApply({
    setup: (draft.setupJson as any) ?? {},
    sessions: draft.sessions.map((s) => ({
      id: String(s.id),
      weekIndex: Number(s.weekIndex ?? 0),
      type: String(s.type ?? ''),
      durationMinutes: Number(s.durationMinutes ?? 0),
    })),
    diff: suggestion.diff,
    triggerTypes,
  });
  const ops: PlanDiffOp[] = rewriteSafety.diff;
  const rationaleText = suggestion.rationaleText;
  const respectsLocks = suggestion.respectsLocks;
  const hardSafety = evaluateProposalHardSafety({
    setup: (draft.setupJson as any) ?? {},
    sessions: draft.sessions.map((s) => ({
      id: String(s.id),
      weekIndex: Number(s.weekIndex ?? 0),
      type: String(s.type ?? ''),
      durationMinutes: Number(s.durationMinutes ?? 0),
    })),
    diff: ops,
    triggerTypes,
  });
  const changeSummaryText = summarizeProposalAction({
    triggerTypes,
    metrics: hardSafety.metrics,
    rewriteSafety,
  });
  const triggerAssessment = assessTriggerQuality(
    triggers.map((t) => ({
      id: String(t.id),
      triggerType: String(t.triggerType),
      evidenceJson: t.evidenceJson,
    }))
  );
  const reasonChain = buildReasonChain({
    ranked: triggerAssessment.ranked,
    actionSummary: changeSummaryText,
  });
  const proposalStatus: 'PROPOSED' | 'DRAFT' = respectsLocks && hardSafety.ok ? 'PROPOSED' : 'DRAFT';
  const baselineSessions = await buildProposalConflictBaseline({ aiPlanDraftId: draft.id, diff: ops });

  const proposal = await prisma.planChangeProposal.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      status: proposalStatus,
      draftPlanId: draft.id,
      proposalJson: {
        diffJson: ops,
        rationaleText,
        triggerIds: triggers.map((t) => t.id),
        baselineSessions,
        hardSafety,
        rewriteSafety,
        changeSummaryText,
        triggerAssessment,
        reasonChain,
      } as Prisma.InputJsonValue,
      diffJson: ops as unknown as Prisma.InputJsonValue,
      rationaleText,
      triggerIds: triggers.map((t) => t.id),
      respectsLocks: respectsLocks && hardSafety.ok,
    },
  });

  return { proposal, diff: ops, triggerIds: triggers.map((t) => t.id), hardSafety, changeSummaryText };
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

export async function reopenPlanChangeProposalAsNew(params: {
  coachId: string;
  athleteId: string;
  proposalId: string;
  aiPlanDraftId: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const source = await prisma.planChangeProposal.findFirst({
    where: { id: params.proposalId, athleteId: params.athleteId, coachId: params.coachId },
    select: {
      id: true,
      draftPlanId: true,
      diffJson: true,
      rationaleText: true,
      triggerIds: true,
      status: true,
    },
  });
  if (!source) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found.');
  if (!source.draftPlanId || String(source.draftPlanId) !== String(params.aiPlanDraftId)) {
    throw new ApiError(400, 'INVALID_DRAFT_PLAN', 'aiPlanDraftId does not match proposal draftPlanId.');
  }

  const parsed = planDiffSchema.safeParse(source.diffJson ?? null);
  if (!parsed.success) {
    throw new ApiError(400, 'INVALID_DIFF', 'Source proposal diffJson is invalid.');
  }

  const created = await createCoachControlProposalFromDiff({
    coachId: params.coachId,
    athleteId: params.athleteId,
    aiPlanDraftId: params.aiPlanDraftId,
    diffJson: parsed.data,
    rationaleText: `${String(source.rationaleText ?? 'Proposal')} (re-opened from ${String(source.id).slice(0, 8)})`,
    metadata: {
      source: 'proposal_reopen',
      reopenedFromProposalId: String(source.id),
      reopenedFromStatus: String(source.status),
      triggerIds: source.triggerIds ?? [],
    },
  });

  await prisma.planChangeAudit.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      proposalId: String(created.proposal.id),
      eventType: 'REOPEN_PROPOSAL',
      actorType: 'COACH',
      draftPlanId: params.aiPlanDraftId,
      changeSummaryText: `Re-opened proposal ${String(source.id).slice(0, 8)} as ${String(created.proposal.id).slice(0, 8)}.`,
      diffJson: {
        sourceProposalId: String(source.id),
        newProposalId: String(created.proposal.id),
      } as Prisma.InputJsonValue,
    },
  });

  return created;
}

export async function createUndoProposalFromAppliedProposal(params: {
  coachId: string;
  athleteId: string;
  proposalId: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const source = await prisma.planChangeProposal.findFirst({
    where: { id: params.proposalId, athleteId: params.athleteId, coachId: params.coachId },
    select: { id: true, status: true, draftPlanId: true, rationaleText: true },
  });
  if (!source) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found.');
  if (!source.draftPlanId) throw new ApiError(400, 'INVALID_PROPOSAL', 'Proposal is missing draftPlanId.');
  if (source.status !== 'APPLIED') {
    throw new ApiError(409, 'INVALID_STATUS', 'Only applied proposals can be used to create an undo proposal.');
  }

  const applyAudit = await prisma.planChangeAudit.findFirst({
    where: {
      proposalId: source.id,
      athleteId: params.athleteId,
      coachId: params.coachId,
      draftPlanId: source.draftPlanId,
      eventType: 'APPLY_PROPOSAL',
    },
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true, diffJson: true },
  });
  if (!applyAudit) {
    throw new ApiError(404, 'NOT_FOUND', 'No apply audit found for this proposal.');
  }

  const diffJson = (applyAudit.diffJson ?? null) as Record<string, unknown> | null;
  const beforeSessions = Array.isArray(diffJson?.undoCheckpointBeforeSessions)
    ? (diffJson.undoCheckpointBeforeSessions as Array<SessionBaselineSnapshot>)
    : [];
  if (!beforeSessions.length) {
    throw new ApiError(409, 'UNDO_NOT_AVAILABLE', 'Undo checkpoint is not available for this proposal.');
  }

  const reverseDiff: PlanDiffOp[] = beforeSessions.map((s) => ({
    op: 'UPDATE_SESSION',
    draftSessionId: String(s.id),
    patch: {
      discipline: String(s.discipline ?? ''),
      type: String(s.type ?? ''),
      durationMinutes: Number(s.durationMinutes ?? 0),
      notes: s.notes == null ? null : String(s.notes),
    },
  }));

  const created = await createCoachControlProposalFromDiff({
    coachId: params.coachId,
    athleteId: params.athleteId,
    aiPlanDraftId: source.draftPlanId,
    diffJson: reverseDiff,
    rationaleText: `Undo checkpoint for proposal ${String(source.id).slice(0, 8)}`,
    metadata: {
      source: 'undo_checkpoint',
      fromProposalId: String(source.id),
      fromAuditId: String(applyAudit.id),
      originalRationaleText: source.rationaleText ?? null,
    },
  });

  await prisma.planChangeAudit.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      proposalId: String(created.proposal.id),
      eventType: 'UNDO_PROPOSAL_CREATED',
      actorType: 'COACH',
      draftPlanId: source.draftPlanId,
      changeSummaryText: `Undo proposal created from applied proposal ${String(source.id).slice(0, 8)}.`,
      diffJson: {
        sourceProposalId: String(source.id),
        sourceAuditId: String(applyAudit.id),
        reverseDiffCount: reverseDiff.length,
      } as Prisma.InputJsonValue,
    },
  });

  return created;
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
  const [draftForSafety, triggerRows] = await Promise.all([
    prisma.aiPlanDraft.findUnique({
      where: { id: proposal.draftPlanId },
      select: {
        id: true,
        setupJson: true,
        sessions: {
          select: { id: true, weekIndex: true, type: true, durationMinutes: true },
        },
      },
    }),
    proposal.triggerIds?.length
      ? prisma.adaptationTrigger.findMany({
          where: { id: { in: proposal.triggerIds }, athleteId: params.athleteId, coachId: params.coachId },
          select: { triggerType: true },
        })
      : Promise.resolve([] as Array<{ triggerType: string }>),
  ]);
  if (!draftForSafety) throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  const triggerTypes = Array.from(new Set(triggerRows.map((r) => String(r.triggerType)))).sort() as AiAdaptationTriggerType[];
  const hardSafety = evaluateProposalHardSafety({
    setup: (draftForSafety.setupJson as any) ?? {},
    sessions: draftForSafety.sessions.map((s) => ({
      id: String(s.id),
      weekIndex: Number(s.weekIndex ?? 0),
      type: String(s.type ?? ''),
      durationMinutes: Number(s.durationMinutes ?? 0),
    })),
    diff,
    triggerTypes,
  });
  if (!hardSafety.ok) {
    throw new ApiError(409, 'HARD_SAFETY_BLOCKED', hardSafety.reasons.slice(0, 3).join(' | '));
  }
  const changeSummaryText = summarizeProposalAction({
    triggerTypes,
    metrics: hardSafety.metrics,
  });
  const proposalJson = (proposal.proposalJson ?? null) as Record<string, unknown> | null;
  const baselineSessions = Array.isArray(proposalJson?.baselineSessions)
    ? (proposalJson?.baselineSessions as Array<{ id?: unknown; hash?: unknown }>)
        .map((s) => ({ id: String(s?.id ?? ''), hash: String(s?.hash ?? '') }))
        .filter((s) => s.id && s.hash)
    : [];
  if (baselineSessions.length) {
    const current = await prisma.aiPlanDraftSession.findMany({
      where: { draftId: proposal.draftPlanId, id: { in: baselineSessions.map((s) => s.id) } },
      select: {
        id: true,
        weekIndex: true,
        ordinal: true,
        dayOfWeek: true,
        discipline: true,
        type: true,
        durationMinutes: true,
        notes: true,
      },
    });
    const currentMap = new Map(current.map((s) => [String(s.id), s] as const));
    const conflict = baselineSessions.find((b) => {
      const c = currentMap.get(b.id);
      if (!c) return true;
      const hash = sessionSnapshotHash({
        id: String(c.id),
        weekIndex: Number(c.weekIndex ?? 0),
        ordinal: Number(c.ordinal ?? 0),
        dayOfWeek: Number(c.dayOfWeek ?? 0),
        discipline: String(c.discipline ?? ''),
        type: String(c.type ?? ''),
        durationMinutes: Number(c.durationMinutes ?? 0),
        notes: c.notes == null ? null : String(c.notes),
      });
      return hash !== b.hash;
    });
    if (conflict) {
      throw new ApiError(
        409,
        'PROPOSAL_CONFLICT',
        'Draft changed since this proposal was created. Reopen or regenerate the proposal before applying.'
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Ensure the draft still belongs to the same coach/athlete.
    const draft = await tx.aiPlanDraft.findUnique({
      where: { id: proposal.draftPlanId ?? undefined },
      select: { id: true, athleteId: true, coachId: true },
    });

    if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
      throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
    }

    const undoCheckpointBeforeSessions = await collectTouchedSessionSnapshots({
      client: tx,
      aiPlanDraftId: draft.id,
      diff,
    });

    await applyPlanDiffToDraft({ tx, draftId: draft.id, diff });

    const audit = await tx.planChangeAudit.create({
      data: {
        athleteId: params.athleteId,
        coachId: params.coachId,
        proposalId: proposal.id,
        eventType: 'APPLY_PROPOSAL',
        actorType: 'COACH',
        draftPlanId: draft.id,
        changeSummaryText,
        diffJson: {
          diff,
          undoCheckpointBeforeSessions,
          triggerTypes,
          hardSafety,
          source: 'adaptation-action-engine',
        } as Prisma.InputJsonValue,
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
    const [draftForSafety, triggerRows] = await Promise.all([
      prisma.aiPlanDraft.findUnique({
        where: { id: params.aiPlanDraftId },
        select: {
          setupJson: true,
          sessions: {
            select: { id: true, weekIndex: true, type: true, durationMinutes: true },
          },
        },
      }),
      proposal.triggerIds?.length
        ? prisma.adaptationTrigger.findMany({
            where: { id: { in: proposal.triggerIds }, athleteId: params.athleteId, coachId: params.coachId },
            select: { triggerType: true },
          })
        : Promise.resolve([] as Array<{ triggerType: string }>),
    ]);
    if (!draftForSafety) {
      results.push({ proposalId: String(proposal.id), ok: false, code: 'NOT_FOUND', message: 'Draft plan not found.' });
      continue;
    }
    const triggerTypes = Array.from(new Set(triggerRows.map((r) => String(r.triggerType)))).sort() as AiAdaptationTriggerType[];
    const hardSafety = evaluateProposalHardSafety({
      setup: (draftForSafety.setupJson as any) ?? {},
      sessions: draftForSafety.sessions.map((s) => ({
        id: String(s.id),
        weekIndex: Number(s.weekIndex ?? 0),
        type: String(s.type ?? ''),
        durationMinutes: Number(s.durationMinutes ?? 0),
      })),
      diff,
      triggerTypes,
    });
    if (!hardSafety.ok) {
      results.push({
        proposalId: String(proposal.id),
        ok: false,
        code: 'HARD_SAFETY_BLOCKED',
        message: hardSafety.reasons.slice(0, 3).join(' | '),
      });
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

export async function applySafeQueuedRecommendations(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  maxHours?: number;
  maxToApply?: number;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const queued = await prisma.planChangeProposal.findMany({
    where: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      draftPlanId: params.aiPlanDraftId,
      status: 'PROPOSED',
      respectsLocks: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: Math.max(1, Math.min(25, params.maxToApply ?? 10)),
  });
  const proposalIds = queued.map((p) => String(p.id));
  const batch = await batchApproveSafeProposals({
    coachId: params.coachId,
    athleteId: params.athleteId,
    aiPlanDraftId: params.aiPlanDraftId,
    proposalIds,
    maxHours: params.maxHours,
  });
  const appliedIds = batch.results.filter((r) => r.ok).map((r) => String(r.proposalId));
  const audits = appliedIds.length
    ? await prisma.planChangeAudit.findMany({
        where: { athleteId: params.athleteId, coachId: params.coachId, proposalId: { in: appliedIds }, eventType: 'APPLY_PROPOSAL' },
        orderBy: [{ createdAt: 'desc' }],
        select: { proposalId: true, changeSummaryText: true },
      })
    : [];
  const byProposal = new Map<string, string>();
  for (const row of audits) {
    const id = String(row.proposalId ?? '');
    if (!id || byProposal.has(id)) continue;
    byProposal.set(id, String(row.changeSummaryText ?? ''));
  }
  const appliedSummaries = appliedIds.map((id) => ({
    proposalId: id,
    summary: byProposal.get(id) || 'Applied adaptation change.',
  }));
  return {
    ...batch,
    appliedSummaries,
  };
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
