import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

function round(value: number | null, decimals = 3) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function computeOutcomeScore(params: {
  completionRate: number;
  skipRate: number;
  sorenessRate: number;
  tooHardRate: number;
  avgRpe: number | null;
}) {
  const rpePenalty = params.avgRpe == null ? 0 : Math.max(0, (params.avgRpe - 6.5) / 4);
  const score =
    params.completionRate * 0.45 +
    (1 - params.skipRate) * 0.2 +
    (1 - params.sorenessRate) * 0.15 +
    (1 - params.tooHardRate) * 0.15 +
    (1 - Math.min(1, rpePenalty)) * 0.05;

  return Math.max(0, Math.min(1, round(score, 3) ?? 0));
}

export async function recordDraftTemplateUsage(params: {
  draftId: string;
  athleteId: string;
  coachId: string;
  selectedTemplates: Array<{
    templateId: string;
    influenceScore: number;
    matchScore?: number | null;
    sourceOrigin?: string | null;
    reasons?: string[];
    athleteFitScore?: number | null;
    templateQualityScore?: number | null;
    exemplarBoostScore?: number | null;
    durationDeltaWeeks?: number | null;
  }>;
  noveltyCheck?: Record<string, unknown> | null;
}) {
  const rows = params.selectedTemplates
    .filter((row) => typeof row.templateId === 'string' && row.templateId.trim().length > 0)
    .map((row) => ({
      draftId: params.draftId,
      templateId: row.templateId,
      athleteId: params.athleteId,
      coachId: params.coachId,
      influenceScore: Number.isFinite(row.influenceScore) ? Number(row.influenceScore) : 0,
      matchScore: Number.isFinite(row.matchScore ?? Number.NaN) ? Number(row.matchScore) : null,
      sourceOrigin: row.sourceOrigin ? String(row.sourceOrigin) : null,
      matchedSignalsJson: {
        reasons: row.reasons ?? [],
        athleteFitScore: row.athleteFitScore ?? null,
        templateQualityScore: row.templateQualityScore ?? null,
        exemplarBoostScore: row.exemplarBoostScore ?? null,
        durationDeltaWeeks: row.durationDeltaWeeks ?? null,
        noveltyCheck: params.noveltyCheck ?? null,
      } as Prisma.InputJsonValue,
    }));

  if (!rows.length) return;

  await prisma.planTemplateUsageTrace.createMany({
    data: rows,
    skipDuplicates: true,
  });
}

export async function recomputeDraftOutcomeSignal(params: { draftId: string }) {
  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.draftId },
    select: {
      id: true,
      athleteId: true,
      coachId: true,
      feedback: {
        orderBy: [{ createdAt: 'desc' }],
        select: {
          completedStatus: true,
          rpe: true,
          sorenessFlag: true,
          feel: true,
          createdAt: true,
        },
      },
    },
  });

  if (!draft) return null;

  const feedback = draft.feedback;
  const sampleSize = feedback.length;
  const doneCount = feedback.filter((row) => row.completedStatus === 'DONE' || row.completedStatus === 'PARTIAL').length;
  const skippedCount = feedback.filter((row) => row.completedStatus === 'SKIPPED').length;
  const sorenessCount = feedback.filter((row) => row.sorenessFlag).length;
  const tooHardCount = feedback.filter((row) => row.feel === 'TOO_HARD' || row.feel === 'HARD').length;
  const rpeValues = feedback.map((row) => row.rpe).filter((value): value is number => typeof value === 'number');
  const avgRpe = rpeValues.length ? rpeValues.reduce((sum, value) => sum + value, 0) / rpeValues.length : null;

  const completionRate = sampleSize > 0 ? doneCount / sampleSize : 0;
  const skipRate = sampleSize > 0 ? skippedCount / sampleSize : 0;
  const sorenessRate = sampleSize > 0 ? sorenessCount / sampleSize : 0;
  const tooHardRate = sampleSize > 0 ? tooHardCount / sampleSize : 0;
  const outcomeScore = computeOutcomeScore({
    completionRate,
    skipRate,
    sorenessRate,
    tooHardRate,
    avgRpe,
  });

  const summaryJson = {
    sampleSize,
    completionRate: round(completionRate),
    skipRate: round(skipRate),
    avgRpe: round(avgRpe, 2),
    sorenessRate: round(sorenessRate),
    tooHardRate: round(tooHardRate),
    outcomeScore,
  };

  const signal = await prisma.apbOutcomeSignal.upsert({
    where: { draftId: draft.id },
    update: {
      athleteId: draft.athleteId,
      coachId: draft.coachId,
      sessionFeedbackCount: sampleSize,
      completionRate: round(completionRate),
      skipRate: round(skipRate),
      avgRpe: round(avgRpe, 2),
      sorenessRate: round(sorenessRate),
      tooHardRate: round(tooHardRate),
      outcomeScore,
      summaryJson,
    },
    create: {
      draftId: draft.id,
      athleteId: draft.athleteId,
      coachId: draft.coachId,
      sessionFeedbackCount: sampleSize,
      completionRate: round(completionRate),
      skipRate: round(skipRate),
      avgRpe: round(avgRpe, 2),
      sorenessRate: round(sorenessRate),
      tooHardRate: round(tooHardRate),
      outcomeScore,
      summaryJson,
    },
  });

  await prisma.planTemplateUsageTrace.updateMany({
    where: { draftId: draft.id },
    data: {
      feedbackCount: sampleSize,
      outcomeScore,
      lastOutcomeAt: new Date(),
    },
  });

  return signal;
}
