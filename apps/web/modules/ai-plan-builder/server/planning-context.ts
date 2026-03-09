import { AssistantDetectionState } from '@prisma/client';

import { assertCoachOwnsAthlete } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { ensureAthleteBrief, loadAthleteProfileSnapshot } from './athlete-brief';
import { getLatestAiDraftPlan, listReferencePlansForAthlete } from './draft-plan';
import { buildEffectivePlanInputContext } from './effective-input';
import { requireAiPlanBuilderV1Enabled } from './flag';
import { getLatestSubmittedIntake, getOpenIntakeDraft } from './intake';
import { getPerformanceModelPreview } from './performance-model';

export async function getCoachPlanningContext(params: { coachId: string; athleteId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const [athleteProfile, briefGenerated, effectiveInput, latestSubmittedIntake, openDraftIntake, draftPlan, referencePlans] = await Promise.all([
    loadAthleteProfileSnapshot({ coachId: params.coachId, athleteId: params.athleteId }),
    ensureAthleteBrief({ coachId: params.coachId, athleteId: params.athleteId }),
    buildEffectivePlanInputContext({ coachId: params.coachId, athleteId: params.athleteId }),
    getLatestSubmittedIntake({ coachId: params.coachId, athleteId: params.athleteId }),
    getOpenIntakeDraft({ coachId: params.coachId, athleteId: params.athleteId }),
    getLatestAiDraftPlan({ coachId: params.coachId, athleteId: params.athleteId }),
    listReferencePlansForAthlete({ coachId: params.coachId, athleteId: params.athleteId }),
  ]);

  const [performanceModel, detections] = await Promise.all([
    getPerformanceModelPreview({
      coachId: params.coachId,
      athleteId: params.athleteId,
      aiPlanDraftId: draftPlan?.id ?? null,
    }),
    prisma.assistantDetection.findMany({
      where: {
        coachId: params.coachId,
        athleteId: params.athleteId,
        state: {
          in: [AssistantDetectionState.NEW, AssistantDetectionState.VIEWED],
        },
      },
      orderBy: [{ detectedAt: 'desc' }, { createdAt: 'desc' }],
      take: 3,
      select: {
        id: true,
        severity: true,
        confidenceScore: true,
        detectedAt: true,
        patternDefinition: {
          select: {
            name: true,
            key: true,
            category: true,
          },
        },
      },
    }),
  ]);

  const selectedKnowledgeSources = Array.isArray((draftPlan as any)?.planSourceSelectionJson?.selectedPlanSources)
    ? ((draftPlan as any).planSourceSelectionJson.selectedPlanSources as Array<Record<string, unknown>>)
    : [];
  const influenceSummary =
    (draftPlan as any)?.planSourceSelectionJson &&
    typeof (draftPlan as any).planSourceSelectionJson === 'object' &&
    (draftPlan as any).planSourceSelectionJson.influenceSummary &&
    typeof (draftPlan as any).planSourceSelectionJson.influenceSummary === 'object'
      ? ((draftPlan as any).planSourceSelectionJson.influenceSummary as Record<string, unknown>)
      : null;
  const noveltyCheck =
    (draftPlan as any)?.planSourceSelectionJson &&
    typeof (draftPlan as any).planSourceSelectionJson === 'object' &&
    (draftPlan as any).planSourceSelectionJson.noveltyCheck &&
    typeof (draftPlan as any).planSourceSelectionJson.noveltyCheck === 'object'
      ? ((draftPlan as any).planSourceSelectionJson.noveltyCheck as Record<string, unknown>)
      : null;

  return {
    athleteProfile,
    athleteBrief: briefGenerated.brief ?? null,
    effectiveInput: {
      mergedSignals: effectiveInput.mergedSignals,
      conflicts: effectiveInput.conflicts,
      preflight: effectiveInput.preflight,
    },
    intakeLifecycle: {
      latestSubmittedIntake,
      openDraftIntake,
      hasOpenRequest: Boolean(openDraftIntake),
      canOpenNewRequest: !openDraftIntake,
    },
    draftPlan: draftPlan
      ? {
          id: draftPlan.id,
          status: draftPlan.status,
          visibilityStatus: draftPlan.visibilityStatus,
          createdAt: draftPlan.createdAt,
          updatedAt: draftPlan.updatedAt,
          publishedAt: draftPlan.publishedAt,
          lastPublishedSummaryText: draftPlan.lastPublishedSummaryText,
          weeksCount: Array.isArray(draftPlan.weeks) ? draftPlan.weeks.length : 0,
          sessionsCount: Array.isArray(draftPlan.sessions) ? draftPlan.sessions.length : 0,
          selectedKnowledgeSources,
          influenceSummary,
          noveltyCheck,
        }
      : null,
    referencePlans,
    recommendedReferencePlan: referencePlans.find((plan) => plan.recommended) ?? referencePlans[0] ?? null,
    performanceModel,
    coachSuggestions: {
      waitingCount: detections.length,
      items: detections.map((detection) => ({
        id: detection.id,
        title: detection.patternDefinition.name,
        patternKey: detection.patternDefinition.key,
        category: detection.patternDefinition.category,
        severity: detection.severity,
        confidenceScore: detection.confidenceScore,
        detectedAt: detection.detectedAt,
      })),
    },
  };
}
