import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';
import { planDiffSchema } from './adaptation-diff';
import { applyPlanDiffToDraft } from './adaptation-diff';
import { publishAiDraftPlan } from './publish';

export async function approveAndPublishPlanChangeProposal(params: {
  coachId: string;
  athleteId: string;
  proposalId: string;
  aiPlanDraftId: string;
}) {
  requireAiPlanBuilderV1Enabled();

  // 1) Approve/apply (transactional for the apply + audit + proposal state change).
  const approval = await prisma.$transaction(async (tx) => {
    const proposal = await tx.planChangeProposal.findFirst({
      where: { id: params.proposalId, athleteId: params.athleteId, coachId: params.coachId },
    });

    if (!proposal) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found.');
    if (!proposal.draftPlanId) throw new ApiError(400, 'INVALID_PROPOSAL', 'Proposal is missing draftPlanId.');

    if (String(proposal.draftPlanId) !== String(params.aiPlanDraftId)) {
      throw new ApiError(400, 'INVALID_DRAFT_PLAN', 'aiPlanDraftId does not match proposal draftPlanId.');
    }

    if (proposal.status !== 'PROPOSED') {
      throw new ApiError(409, 'INVALID_STATUS', `Proposal must be PROPOSED to approve (current=${proposal.status}).`);
    }

    const parsed = planDiffSchema.safeParse(proposal.diffJson ?? null);
    if (!parsed.success) {
      throw new ApiError(400, 'INVALID_DIFF', 'Proposal diffJson is invalid.');
    }

    // Ensure the draft still belongs to the same coach/athlete.
    const draft = await tx.aiPlanDraft.findUnique({
      where: { id: params.aiPlanDraftId },
      select: { id: true, athleteId: true, coachId: true },
    });

    if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
      throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
    }

    await applyPlanDiffToDraft({ tx, draftId: draft.id, diff: parsed.data });

    const audit = await tx.planChangeAudit.create({
      data: {
        athleteId: params.athleteId,
        coachId: params.coachId,
        proposalId: proposal.id,
        eventType: 'APPLY_PROPOSAL',
        actorType: 'COACH',
        draftPlanId: draft.id,
        changeSummaryText: 'Applied plan change proposal to AiPlanDraft.',
        diffJson: parsed.data as unknown as Prisma.InputJsonValue,
      },
    });

    const updatedProposal = await tx.planChangeProposal.update({
      where: { id: proposal.id },
      data: { status: 'APPLIED', coachDecisionAt: new Date(), appliedAt: new Date() },
    });

    const updatedDraft = await tx.aiPlanDraft.findUniqueOrThrow({
      where: { id: draft.id },
      include: {
        weeks: { orderBy: [{ weekIndex: 'asc' }] },
        sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
      },
    });

    return { proposal: updatedProposal, audit, draft: updatedDraft };
  });

  // 2) Publish (best-effort; approval should remain applied even if publish fails).
  try {
    const publish = await publishAiDraftPlan({
      coachId: params.coachId,
      athleteId: params.athleteId,
      aiPlanDraftId: params.aiPlanDraftId,
    });

    return {
      approval,
      publish: {
        ok: true as const,
        published: publish.published,
        hash: publish.hash,
        lastPublishedSummaryText: publish.summaryText,
        draft: publish.draft,
      },
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
    };
  }
}
