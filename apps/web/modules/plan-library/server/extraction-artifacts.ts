import { Prisma } from '@prisma/client';

import type { ExtractedPlanSource } from './extract';

const PLAN_LIBRARY_EXTRACTOR_VERSION = 'plan-library-v2';

type ExtractionSummaryJson = {
  warnings: string[];
  rawConfidence: number;
  adjustedConfidence: number;
  warningCount: number;
  sessionCount: number;
  weekCount: number;
  recommendedAction: 'approve' | 'spot-check' | 'manual-review';
  inferredLayoutFamily: {
    slug: string;
    confidence: number;
    reasons: string[];
  };
  appliedLayoutFamily: {
    id: string | null;
    slug: string | null;
    name: string | null;
  };
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function computeAdjustedConfidence(rawConfidence: number, warningCount: number) {
  const penalty = Math.min(0.72, warningCount * 0.0225);
  return clamp(rawConfidence - penalty, 0, 1);
}

function summarizeExtraction(params: {
  extracted: ExtractedPlanSource;
  assignedLayoutFamily:
    | { id: string; slug: string; name: string }
    | null;
  inferredLayoutFamily: { slug: string; confidence: number; reasons: string[] };
}): ExtractionSummaryJson {
  const warningCount = params.extracted.warnings.length;
  const adjustedConfidence = computeAdjustedConfidence(params.extracted.confidence, warningCount);
  const recommendedAction: ExtractionSummaryJson['recommendedAction'] =
    warningCount >= 8 || adjustedConfidence < 0.45
      ? 'manual-review'
      : warningCount >= 3 || adjustedConfidence < 0.72
        ? 'spot-check'
        : 'approve';

  return {
    warnings: params.extracted.warnings,
    rawConfidence: params.extracted.confidence,
    adjustedConfidence,
    warningCount,
    sessionCount: params.extracted.sessions.length,
    weekCount: params.extracted.weeks.length,
    recommendedAction,
    inferredLayoutFamily: params.inferredLayoutFamily,
    appliedLayoutFamily: {
      id: params.assignedLayoutFamily?.id ?? null,
      slug: params.assignedLayoutFamily?.slug ?? null,
      name: params.assignedLayoutFamily?.name ?? null,
    },
  };
}

export async function persistPlanSourceExtractionArtifacts(
  tx: Prisma.TransactionClient,
  params: {
    planSourceId: string;
    version: number;
    extracted: ExtractedPlanSource;
    contentType?: string | null;
    layoutFamily:
      | { id: string; slug: string; name: string }
      | null;
    inferredLayoutFamily: { slug: string; confidence: number; reasons: string[] };
  }
) {
  const summary = summarizeExtraction({
    extracted: params.extracted,
    assignedLayoutFamily: params.layoutFamily,
    inferredLayoutFamily: params.inferredLayoutFamily,
  });

  const version = await tx.planSourceVersion.create({
    data: {
      planSourceId: params.planSourceId,
      version: params.version,
      extractionMetaJson: {
        contentType: params.contentType ?? null,
        warnings: summary.warnings,
        confidence: summary.adjustedConfidence,
        rawConfidence: summary.rawConfidence,
        sessionCount: summary.sessionCount,
        weekCount: summary.weekCount,
        recommendedAction: summary.recommendedAction,
        inferredLayoutFamily: summary.inferredLayoutFamily,
        appliedLayoutFamily: summary.appliedLayoutFamily,
      } as Prisma.InputJsonValue,
    },
  });

  if (params.extracted.weeks.length) {
    await tx.planSourceWeekTemplate.createMany({
      data: params.extracted.weeks.map((week) => ({
        planSourceVersionId: version.id,
        weekIndex: week.weekIndex,
        phase: week.phase ?? null,
        totalMinutes: week.totalMinutes ?? null,
        totalSessions: week.totalSessions ?? null,
        notes: week.notes ?? null,
      })),
    });
  }

  if (params.extracted.sessions.length) {
    const weekIds = await tx.planSourceWeekTemplate.findMany({
      where: { planSourceVersionId: version.id },
      select: { id: true, weekIndex: true },
    });
    const weekMap = new Map(weekIds.map((week) => [week.weekIndex, week.id]));

    await tx.planSourceSessionTemplate.createMany({
      data: params.extracted.sessions
        .filter((session) => weekMap.has(session.weekIndex))
        .map((session) => ({
          planSourceWeekTemplateId: weekMap.get(session.weekIndex)!,
          ordinal: session.ordinal,
          dayOfWeek: session.dayOfWeek ?? null,
          discipline: session.discipline as any,
          sessionType: session.sessionType,
          title: session.title ?? null,
          durationMinutes: session.durationMinutes ?? null,
          distanceKm: session.distanceKm ?? null,
          intensityType: session.intensityType ?? null,
          intensityTargetJson: session.intensityTargetJson as Prisma.InputJsonValue,
          recipeV2Json: session.recipeV2Json as Prisma.InputJsonValue,
          parserConfidence: session.parserConfidence ?? null,
          parserWarningsJson: session.parserWarningsJson as Prisma.InputJsonValue,
          structureJson: session.structureJson as Prisma.InputJsonValue,
          notes: session.notes ?? null,
        })),
    });
  }

  if (params.extracted.rules.length) {
    await tx.planSourceRule.createMany({
      data: params.extracted.rules.map((rule) => ({
        planSourceVersionId: version.id,
        ruleType: rule.ruleType as any,
        phase: rule.phase ?? null,
        appliesJson: rule.appliesJson as Prisma.InputJsonValue,
        ruleJson: rule.ruleJson as Prisma.InputJsonValue,
        explanation: rule.explanation,
        priority: rule.priority,
      })),
    });
  }

  const run = await tx.planSourceExtractionRun.create({
    data: {
      planSourceId: params.planSourceId,
      planSourceVersionId: version.id,
      layoutFamilyId: params.layoutFamily?.id ?? null,
      extractorVersion: PLAN_LIBRARY_EXTRACTOR_VERSION,
      reviewStatus: 'NEEDS_REVIEW',
      summaryJson: summary as Prisma.InputJsonValue,
      confidence: summary.adjustedConfidence,
      warningCount: summary.warningCount,
      sessionCount: summary.sessionCount,
      weekCount: summary.weekCount,
    },
  });

  return { version, run, summary };
}
