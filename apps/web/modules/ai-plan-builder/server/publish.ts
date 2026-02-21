import { z } from 'zod';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';

import { computeStableSha256 } from '../rules/stable-hash';
import { summarizePlanChanges } from '../rules/publish-summary';
import { evaluateDraftQualityGate } from '../rules/constraint-validator';
import { refreshPolicyRuntimeOverridesFromDb } from './policy-tuning';

export const publishDraftPlanSchema = z.object({
  aiPlanDraftId: z.string().min(1),
});

export async function publishAiDraftPlan(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  now?: Date;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);
  await refreshPolicyRuntimeOverridesFromDb();

  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const draft = await tx.aiPlanDraft.findUnique({
      where: { id: params.aiPlanDraftId },
      select: {
        id: true,
        athleteId: true,
        coachId: true,
        planJson: true,
        setupJson: true,
        visibilityStatus: true,
        publishedAt: true,
        lastPublishedHash: true,
      },
    });

    if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
      throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
    }

    const setupCandidate = ((draft.setupJson as any) ?? (draft.planJson as any)?.setup) as any;
    const draftCandidate = draft.planJson as any;
    if (!setupCandidate || !draftCandidate?.weeks) {
      throw new ApiError(400, 'INVALID_DRAFT', 'Draft is missing setup/plan structure required for publish quality gate.');
    }
    const qualityGate = evaluateDraftQualityGate({
      setup: setupCandidate,
      draft: draftCandidate,
    });
    if (qualityGate.hardViolations.length) {
      throw new ApiError(400, 'PLAN_CONSTRAINT_VIOLATION', 'Cannot publish. Draft violates hard planning constraints.', {
        diagnostics: {
          violations: qualityGate.hardViolations.slice(0, 40),
          softWarnings: qualityGate.softWarnings.slice(0, 40),
          count: qualityGate.hardViolations.length,
          qualityScore: qualityGate.score,
          policyProfileId: qualityGate.profileId,
          policyProfileVersion: qualityGate.profileVersion,
        },
      });
    }

    const hash = computeStableSha256(draft.planJson);

    // Idempotency: if unchanged since last publish, keep publishedAt stable.
    if (draft.visibilityStatus === 'PUBLISHED' && draft.lastPublishedHash && draft.lastPublishedHash === hash) {
      const unchanged = await tx.aiPlanDraft.update({
        where: { id: draft.id },
        data: {
          visibilityStatus: 'PUBLISHED',
          lastPublishedSummaryText: 'No changes',
        },
        include: {
          weeks: { orderBy: [{ weekIndex: 'asc' }] },
          sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
        },
      });

      return { draft: unchanged, published: false, summaryText: 'No changes', hash };
    }

    const previous = await tx.aiPlanDraftPublishSnapshot.findFirst({
      where: { draftId: draft.id },
      orderBy: [{ publishedAt: 'desc' }],
      select: { hash: true, planJson: true },
    });

    const summaryText = previous ? summarizePlanChanges(previous.planJson, draft.planJson) : 'Initial publish';
    const summaryWithQuality =
      qualityGate.softWarnings.length > 0
        ? `${summaryText} | Quality score ${qualityGate.score}. Soft warnings: ${qualityGate.softWarnings.length}.`
        : `${summaryText} | Quality score ${qualityGate.score}.`;

    const legacySetupFromPlan = (draft.planJson as any)?.setup ?? null;
    const setupJsonToPersist = (draft.setupJson as any) ?? (legacySetupFromPlan ? (legacySetupFromPlan as Prisma.InputJsonValue) : undefined);

    const updated = await tx.aiPlanDraft.update({
      where: { id: draft.id },
      data: {
        visibilityStatus: 'PUBLISHED',
        publishedAt: now,
        publishedByCoachId: params.coachId ?? null,
        lastPublishedHash: hash,
        lastPublishedSummaryText: summaryWithQuality,
        ...(setupJsonToPersist ? { setupJson: setupJsonToPersist } : {}),
        publishSnapshots: {
          create: {
            athleteId: draft.athleteId,
            coachId: draft.coachId,
            hash,
            planJson: draft.planJson as Prisma.InputJsonValue,
            summaryText: summaryWithQuality,
            publishedAt: now,
            publishedByCoachId: params.coachId ?? null,
          },
        },
      },
      include: {
        weeks: { orderBy: [{ weekIndex: 'asc' }] },
        sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
      },
    });

    return { draft: updated, published: true, summaryText: summaryWithQuality, hash };
  });
}

export async function getDraftPublishStatus(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.aiPlanDraftId },
    select: {
      id: true,
      athleteId: true,
      coachId: true,
      visibilityStatus: true,
      publishedAt: true,
      publishedByCoachId: true,
      lastPublishedHash: true,
      lastPublishedSummaryText: true,
    },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  return draft;
}
