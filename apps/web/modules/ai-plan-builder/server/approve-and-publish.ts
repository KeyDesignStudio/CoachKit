import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';
import { planDiffSchema } from './adaptation-diff';
import { applyPlanDiffToDraft } from './adaptation-diff';
import { publishAiDraftPlan } from './publish';
import { materialisePublishedAiPlanToCalendar } from './calendar-materialise';

function isRetryableInteractiveTxError(error: unknown): boolean {
  const code = typeof (error as any)?.code === 'string' ? String((error as any).code) : null;
  const name = typeof (error as any)?.name === 'string' ? String((error as any).name) : null;
  return name === 'PrismaClientKnownRequestError' && code === 'P2028';
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function rebuildDraftPlanJsonCache(params: { draftId: string }) {
  const draftSetup = await prisma.aiPlanDraft.findUnique({ where: { id: params.draftId }, select: { setupJson: true } });
  if (!draftSetup?.setupJson) return;

  const weeks = await prisma.aiPlanDraftWeek.findMany({
    where: { draftId: params.draftId },
    select: { weekIndex: true, locked: true },
  });

  const sessions = await prisma.aiPlanDraftSession.findMany({
    where: { draftId: params.draftId },
    select: {
      weekIndex: true,
      ordinal: true,
      dayOfWeek: true,
      discipline: true,
      type: true,
      durationMinutes: true,
      notes: true,
      locked: true,
    },
  });

  // NOTE: buildDraftPlanJsonV1 is intentionally imported by adaptation-diff; use the canonical cache builder via tx in that module.
  // Here we rely on the same utility by re-importing it locally to keep behavior identical.
  const { buildDraftPlanJsonV1 } = await import('../rules/plan-json');

  await prisma.aiPlanDraft.update({
    where: { id: params.draftId },
    data: { planJson: buildDraftPlanJsonV1({ setupJson: draftSetup.setupJson, weeks, sessions }) },
  });
}

export async function approveAndPublishPlanChangeProposal(params: {
  coachId: string;
  athleteId: string;
  proposalId: string;
  aiPlanDraftId: string;
  requestId?: string;
}) {
  requireAiPlanBuilderV1Enabled();

  // Pre-validate outside the transaction to minimize tx duration.
  const proposal = await prisma.planChangeProposal.findFirst({
    where: { id: params.proposalId, athleteId: params.athleteId, coachId: params.coachId },
    select: { id: true, status: true, draftPlanId: true, diffJson: true },
  });

  if (!proposal) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found.');
  if (!proposal.draftPlanId) throw new ApiError(400, 'INVALID_PROPOSAL', 'Proposal is missing draftPlanId.');
  if (String(proposal.draftPlanId) !== String(params.aiPlanDraftId)) {
    throw new ApiError(400, 'INVALID_DRAFT_PLAN', 'aiPlanDraftId does not match proposal draftPlanId.');
  }

  // Idempotency: if already applied, do not re-apply; return current state.
  if (proposal.status === 'APPLIED') {
    const currentProposal = await prisma.planChangeProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    const audit = await prisma.planChangeAudit.findFirst({
      where: { proposalId: proposal.id, eventType: 'APPLY_PROPOSAL' },
      orderBy: [{ createdAt: 'desc' }],
    });
    const draft = await prisma.aiPlanDraft.findUniqueOrThrow({
      where: { id: String(proposal.draftPlanId) },
      include: {
        weeks: { orderBy: [{ weekIndex: 'asc' }] },
        sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
      },
    });

    // Attempt publish regardless; publish is idempotent and may already be published.
    const publish = await publishAiDraftPlan({
      coachId: params.coachId,
      athleteId: params.athleteId,
      aiPlanDraftId: params.aiPlanDraftId,
    });

    let materialisation:
      | { ok: true; upsertedCount: number; softDeletedCount: number; publishedPlanId: string }
      | { ok: false; code: 'CALENDAR_MATERIALISE_FAILED'; message: string };

    try {
      const m = await materialisePublishedAiPlanToCalendar({
        coachId: params.coachId,
        athleteId: params.athleteId,
        aiPlanDraftId: params.aiPlanDraftId,
        proposalId: params.proposalId,
        requestId: params.requestId,
      });
      materialisation = {
        ok: true,
        upsertedCount: m.upsertedCount,
        softDeletedCount: m.softDeletedCount,
        publishedPlanId: m.publishedPlanId,
      };
    } catch (e) {
      console.error('APB_CALENDAR_MATERIALISE_FAILED', {
        requestId: params.requestId ?? null,
        athleteId: params.athleteId,
        coachId: params.coachId,
        proposalId: params.proposalId,
        aiPlanDraftId: params.aiPlanDraftId,
        error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : { value: e },
      });
      materialisation = {
        ok: false,
        code: 'CALENDAR_MATERIALISE_FAILED',
        message: e instanceof Error ? e.message : 'Calendar materialisation failed.',
      };
    }

    return {
      approval: { proposal: currentProposal, audit: audit ?? null, draft },
      publish: {
        ok: true as const,
        published: publish.published,
        hash: publish.hash,
        lastPublishedSummaryText: publish.summaryText,
        draft: publish.draft,
      },
      materialisation,
    };
  }

  if (proposal.status !== 'PROPOSED' && proposal.status !== 'APPROVED') {
    throw new ApiError(409, 'INVALID_STATUS', `Proposal must be PROPOSED or APPROVED (current=${proposal.status}).`);
  }

  const parsed = planDiffSchema.safeParse(proposal.diffJson ?? null);
  if (!parsed.success) {
    throw new ApiError(400, 'INVALID_DIFF', 'Proposal diffJson is invalid.');
  }

  const diff = parsed.data;

  const runApprovalTx = async () => {
    return prisma.$transaction(
      async (tx) => {
        // Ensure the draft still belongs to the same coach/athlete.
        const draft = await tx.aiPlanDraft.findUnique({
          where: { id: params.aiPlanDraftId },
          select: { id: true, athleteId: true, coachId: true },
        });

        if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
          throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
        }

        // Re-check proposal status inside tx for idempotency and safe retries.
        const freshProposal = await tx.planChangeProposal.findUniqueOrThrow({
          where: { id: proposal.id },
          select: { id: true, status: true },
        });

        if (freshProposal.status === 'APPLIED') {
          const currentProposal = await tx.planChangeProposal.findUniqueOrThrow({ where: { id: proposal.id } });
          const currentAudit = await tx.planChangeAudit.findFirst({
            where: { proposalId: proposal.id, eventType: 'APPLY_PROPOSAL' },
            orderBy: [{ createdAt: 'desc' }],
          });
          return { proposal: currentProposal, audit: currentAudit ?? null, draftId: draft.id, wasApplied: false as const };
        }

        if (freshProposal.status !== 'PROPOSED' && freshProposal.status !== 'APPROVED') {
          throw new ApiError(409, 'INVALID_STATUS', `Proposal must be PROPOSED or APPROVED (current=${freshProposal.status}).`);
        }

        await applyPlanDiffToDraft({ tx, draftId: draft.id, diff, syncPlanJson: false });

        // Idempotent audit: deterministic id prevents duplicates across retries.
        const auditId = `apb_apply_${proposal.id}`;
        const audit = await tx.planChangeAudit.upsert({
          where: { id: auditId },
          create: {
            id: auditId,
            athleteId: params.athleteId,
            coachId: params.coachId,
            proposalId: proposal.id,
            eventType: 'APPLY_PROPOSAL',
            actorType: 'COACH',
            draftPlanId: draft.id,
            changeSummaryText: 'Applied plan change proposal to AiPlanDraft.',
            diffJson: diff as unknown as Prisma.InputJsonValue,
          },
          update: {
            // Keep stable; do not create duplicates.
            changeSummaryText: 'Applied plan change proposal to AiPlanDraft.',
          },
        });

        const updatedProposal = await tx.planChangeProposal.update({
          where: { id: proposal.id },
          data: { status: 'APPLIED', coachDecisionAt: new Date(), appliedAt: new Date() },
        });

        return { proposal: updatedProposal, audit, draftId: draft.id, wasApplied: true as const };
      },
      { maxWait: 15_000, timeout: 15_000 }
    );
  };

  // 1) Approve/apply with one retry for retryable interactive transaction failures.
  let approvalTxResult: Awaited<ReturnType<typeof runApprovalTx>>;
  try {
    approvalTxResult = await runApprovalTx();
  } catch (e) {
    if (!isRetryableInteractiveTxError(e)) throw e;
    await sleep(150);
    approvalTxResult = await runApprovalTx();
  }

  // Rebuild planJson cache outside the transaction (minimizes interactive tx duration).
  // Best-effort: canonical rows are the source of truth.
  if (approvalTxResult.wasApplied) {
    await rebuildDraftPlanJsonCache({ draftId: approvalTxResult.draftId });
  }

  const updatedDraft = await prisma.aiPlanDraft.findUniqueOrThrow({
    where: { id: approvalTxResult.draftId },
    include: {
      weeks: { orderBy: [{ weekIndex: 'asc' }] },
      sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
    },
  });

  const approval = { proposal: approvalTxResult.proposal, audit: approvalTxResult.audit, draft: updatedDraft };

  // 2) Publish (best-effort; approval should remain applied even if publish fails).
  try {
    const publish = await publishAiDraftPlan({
      coachId: params.coachId,
      athleteId: params.athleteId,
      aiPlanDraftId: params.aiPlanDraftId,
    });

    let materialisation:
      | { ok: true; upsertedCount: number; softDeletedCount: number; publishedPlanId: string }
      | { ok: false; code: 'CALENDAR_MATERIALISE_FAILED'; message: string };

    try {
      const m = await materialisePublishedAiPlanToCalendar({
        coachId: params.coachId,
        athleteId: params.athleteId,
        aiPlanDraftId: params.aiPlanDraftId,
        proposalId: params.proposalId,
        requestId: params.requestId,
      });
      materialisation = {
        ok: true,
        upsertedCount: m.upsertedCount,
        softDeletedCount: m.softDeletedCount,
        publishedPlanId: m.publishedPlanId,
      };
    } catch (e) {
      console.error('APB_CALENDAR_MATERIALISE_FAILED', {
        requestId: params.requestId ?? null,
        athleteId: params.athleteId,
        coachId: params.coachId,
        proposalId: params.proposalId,
        aiPlanDraftId: params.aiPlanDraftId,
        error:
          e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : { value: e },
      });
      materialisation = {
        ok: false,
        code: 'CALENDAR_MATERIALISE_FAILED',
        message: e instanceof Error ? e.message : 'Calendar materialisation failed.',
      };
    }

    return {
      approval,
      publish: {
        ok: true as const,
        published: publish.published,
        hash: publish.hash,
        lastPublishedSummaryText: publish.summaryText,
        draft: publish.draft,
      },
      materialisation,
    };
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(500, 'PUBLISH_FAILED', e instanceof Error ? e.message : 'Publish failed.');
    return {
      approval,
      publish: {
        ok: false as const,
        code: err.code,
        message: err.message,
      },
      materialisation: {
        ok: false as const,
        code: 'CALENDAR_MATERIALISE_FAILED',
        message: 'Calendar materialisation was not attempted because publish failed.',
      },
    };
  }
}
