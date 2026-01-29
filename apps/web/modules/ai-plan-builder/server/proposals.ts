import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';
import { planDiffSchema, type PlanDiffOp } from './adaptation-diff';
import { applyPlanDiffToDraft } from './adaptation-diff';

export const generateProposalSchema = z.object({
  aiPlanDraftId: z.string().min(1),
  triggerIds: z.array(z.string().min(1)).optional(),
});

export const approveRejectSchema = z.object({
  // no body today; reserved for later
});

function stableSortSessions<T extends { weekIndex: number; dayOfWeek: number; ordinal: number }>(sessions: T[]) {
  return sessions.slice().sort((a, b) => a.weekIndex - b.weekIndex || a.dayOfWeek - b.dayOfWeek || a.ordinal - b.ordinal);
}

function isIntensitySession(session: { type: string }) {
  const t = String(session.type || '').toLowerCase();
  return t === 'tempo' || t === 'threshold';
}

function downgradeIntensityType(currentType: string) {
  const t = String(currentType || '').toLowerCase();
  if (t === 'threshold') return 'tempo';
  if (t === 'tempo') return 'endurance';
  return 'endurance';
}

function pctText(pctDelta: number) {
  const pct = Math.round(pctDelta * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function chooseNextUnlocked<T extends { locked: boolean; weekLocked: boolean }>(candidates: T[]) {
  return candidates.find((c) => !c.locked && !c.weekLocked);
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

  const weekLocked = new Map(draft.weeks.map((w) => [w.weekIndex, w.locked] as const));

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

  const triggerTypes = Array.from(new Set(triggers.map((t) => t.triggerType))).sort();

  const sessionViews = stableSortSessions(
    draft.sessions.map((s) => ({
      ...s,
      weekLocked: weekLocked.get(s.weekIndex) ?? false,
    }))
  );

  const ops: PlanDiffOp[] = [];
  const rationale: string[] = [];
  let respectsLocks = true;

  const addBlocked = (reason: string) => {
    respectsLocks = false;
    rationale.push(`Blocked by lock: ${reason}`);
  };

  // Helpers for selecting targets.
  const intensityCandidates = sessionViews
    .filter((s) => isIntensitySession(s))
    .map((s) => ({ ...s }));

  const nextUnlockedIntensity = chooseNextUnlocked(intensityCandidates);

  const nextWeekIndex = 1;
  const nextWeekLocked = weekLocked.get(nextWeekIndex) ?? false;

  const applyWeekVolume = (pctDelta: number, because: string) => {
    if (nextWeekLocked) {
      addBlocked(`weekIndex=${nextWeekIndex} is locked (cannot adjust week volume).`);
      return;
    }
    ops.push({ op: 'ADJUST_WEEK_VOLUME', weekIndex: nextWeekIndex, pctDelta });
    ops.push({ op: 'ADD_NOTE', target: 'week', weekIndex: nextWeekIndex, text: `Volume adjustment ${pctText(pctDelta)} (${because}).` });
    rationale.push(`${because}: adjust next week volume ${pctText(pctDelta)}.`);
  };

  const swapToRecovery = (sessionId: string, because: string) => {
    ops.push({ op: 'SWAP_SESSION_TYPE', draftSessionId: sessionId, newType: 'recovery' });
    ops.push({ op: 'ADD_NOTE', target: 'session', draftSessionId: sessionId, text: `${because}: converted to recovery.` });
  };

  // Apply rules deterministically by trigger type order.
  for (const t of triggerTypes) {
    if (t === 'SORENESS') {
      rationale.push('Trigger SORENESS: soreness reported recently.');

      if (!nextUnlockedIntensity) {
        addBlocked('no unlocked intensity session found to convert for SORENESS.');
      } else {
        swapToRecovery(nextUnlockedIntensity.id, 'SORENESS');
      }

      applyWeekVolume(-0.1, 'SORENESS');
      continue;
    }

    if (t === 'TOO_HARD') {
      rationale.push('Trigger TOO_HARD: multiple sessions felt too hard.');

      if (!nextUnlockedIntensity) {
        addBlocked('no unlocked intensity session found to downgrade for TOO_HARD.');
      } else {
        const newType = downgradeIntensityType(nextUnlockedIntensity.type);
        ops.push({ op: 'SWAP_SESSION_TYPE', draftSessionId: nextUnlockedIntensity.id, newType });
        ops.push({
          op: 'ADD_NOTE',
          target: 'session',
          draftSessionId: nextUnlockedIntensity.id,
          text: `TOO_HARD: downgraded intensity (${nextUnlockedIntensity.type} -> ${newType}).`,
        });
      }

      continue;
    }

    if (t === 'MISSED_KEY') {
      rationale.push('Trigger MISSED_KEY: multiple key sessions were skipped.');

      applyWeekVolume(-0.15, 'MISSED_KEY');

      // Replace one intensity with endurance (choose the first unlocked intensity in next week).
      if (nextWeekLocked) {
        addBlocked(`weekIndex=${nextWeekIndex} is locked (cannot replace intensity session).`);
      } else {
        const inNextWeekIntensity = sessionViews
          .filter((s) => s.weekIndex === nextWeekIndex && isIntensitySession(s))
          .map((s) => ({ ...s }));
        const target = chooseNextUnlocked(inNextWeekIntensity);
        if (!target) {
          addBlocked('no unlocked intensity session found in next week to replace for MISSED_KEY.');
        } else {
          ops.push({ op: 'SWAP_SESSION_TYPE', draftSessionId: target.id, newType: 'endurance' });
          ops.push({
            op: 'ADD_NOTE',
            target: 'session',
            draftSessionId: target.id,
            text: 'MISSED_KEY: replaced an intensity session with endurance.',
          });
        }
      }

      continue;
    }

    if (t === 'HIGH_COMPLIANCE') {
      rationale.push('Trigger HIGH_COMPLIANCE: strong completion with no negative flags.');

      if (nextWeekLocked) {
        addBlocked(`weekIndex=${nextWeekIndex} is locked (cannot apply progression).`);
        continue;
      }

      // Prefer adding +10 minutes to the longest unlocked session in next week.
      const nextWeekSessions = sessionViews
        .filter((s) => s.weekIndex === nextWeekIndex)
        .map((s) => ({ ...s }))
        .sort((a, b) => b.durationMinutes - a.durationMinutes || a.ordinal - b.ordinal);

      const target = chooseNextUnlocked(nextWeekSessions);

      if (target) {
        ops.push({
          op: 'UPDATE_SESSION',
          draftSessionId: target.id,
          patch: { durationMinutes: target.durationMinutes + 10 },
        });
        ops.push({
          op: 'ADD_NOTE',
          target: 'session',
          draftSessionId: target.id,
          text: 'HIGH_COMPLIANCE: small progression (+10 minutes).',
        });
        rationale.push('HIGH_COMPLIANCE: +10 minutes to the longest session next week.');
      } else {
        // Fallback: +5% volume (will affect unlocked sessions only).
        applyWeekVolume(0.05, 'HIGH_COMPLIANCE');
      }

      continue;
    }
  }

  // Lock accuracy check: any op that explicitly targets a locked entity makes respectsLocks=false.
  for (const op of ops) {
    if (op.op === 'ADJUST_WEEK_VOLUME' || (op.op === 'ADD_NOTE' && op.target === 'week')) {
      if (weekLocked.get(op.weekIndex)) respectsLocks = false;
    }
    if (op.op === 'UPDATE_SESSION' || op.op === 'SWAP_SESSION_TYPE') {
      const s = draft.sessions.find((x) => x.id === op.draftSessionId);
      if (s?.locked) respectsLocks = false;
      if (weekLocked.get(s?.weekIndex ?? -1)) respectsLocks = false;
    }
  }

  const rationaleText = rationale.join('\n');

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
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.planChangeProposal.findMany({
    where: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      draftPlanId: params.aiPlanDraftId,
    },
    orderBy: [{ createdAt: 'desc' }],
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
