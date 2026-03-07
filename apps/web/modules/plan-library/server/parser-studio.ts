import { Prisma, type PlanSourceAnnotationType, type PlanSourceExtractionReviewStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import {
  deriveManualSessionTemplateFields,
  extractFromRawText,
  extractFromStructuredPdfDocument,
  type ExtractedPlanSource,
} from './extract';
import { ensurePlanSourceLayoutFamilies, inferLayoutFamily } from './layout-families';
import {
  buildLayoutFamilyTemplatePreview,
  compileLayoutFamilyRules,
  parseLayoutFamilyRules,
} from './layout-rules';
import { extractStructuredPdfDocument } from './pdf-layout';

const PARSER_STUDIO_EXTRACTOR_VERSION = 'parser-studio-v1';

type ReviewerContext = {
  userId: string;
  email: string;
};

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
      extractorVersion: PARSER_STUDIO_EXTRACTOR_VERSION,
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

async function getAssignedOrInferredLayoutFamily(planSource: {
  title: string;
  rawText: string;
  sourceUrl: string | null;
  layoutFamilyId: string | null;
}) {
  const layoutFamilies = await ensurePlanSourceLayoutFamilies();
  const inferred = inferLayoutFamily({
    title: planSource.title,
    rawText: planSource.rawText,
    sourceUrl: planSource.sourceUrl,
  });
  const assigned = planSource.layoutFamilyId
    ? layoutFamilies.find((family) => family.id === planSource.layoutFamilyId) ?? null
    : null;
  const recommended = layoutFamilies.find((family) => family.slug === inferred.slug) ?? null;
  return { assigned, inferred, recommended, layoutFamilies };
}

async function loadPlanSourcePdfBuffer(planSource: {
  type: string;
  storedDocumentUrl: string | null;
  sourceUrl: string | null;
}) {
  const candidates = [planSource.storedDocumentUrl, planSource.sourceUrl].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      const looksLikePdf = contentType.includes('pdf') || candidate.toLowerCase().includes('.pdf') || planSource.type === 'PDF';
      if (!looksLikePdf) continue;
      return Buffer.from(await response.arrayBuffer());
    } catch {
      continue;
    }
  }

  return null;
}

export async function listParserStudioSources() {
  const layoutFamilies = await ensurePlanSourceLayoutFamilies();
  const sources = await prisma.planSource.findMany({
    include: {
      layoutFamily: true,
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
      extractionRuns: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          layoutFamily: true,
          reviews: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return {
    layoutFamilies,
    sources: sources.map((source) => {
      const inferred = inferLayoutFamily({ title: source.title, rawText: source.rawText, sourceUrl: source.sourceUrl });
      const recommendedLayoutFamily = layoutFamilies.find((family) => family.slug === inferred.slug) ?? null;
      const latestRun = source.extractionRuns[0] ?? null;
      return {
        id: source.id,
        title: source.title,
        type: source.type,
        sport: source.sport,
        distance: source.distance,
        level: source.level,
        durationWeeks: source.durationWeeks,
        season: source.season,
        author: source.author,
        publisher: source.publisher,
        isActive: source.isActive,
        createdAt: source.createdAt.toISOString(),
        updatedAt: source.updatedAt.toISOString(),
        storedDocumentUrl: source.storedDocumentUrl,
        layoutFamily: source.layoutFamily
          ? {
              id: source.layoutFamily.id,
              slug: source.layoutFamily.slug,
              name: source.layoutFamily.name,
              familyType: source.layoutFamily.familyType,
              hasCompiledRules: Boolean(parseLayoutFamilyRules(source.layoutFamily.rulesJson)),
            }
          : null,
        recommendedLayoutFamily: recommendedLayoutFamily
          ? {
              id: recommendedLayoutFamily.id,
              slug: recommendedLayoutFamily.slug,
              name: recommendedLayoutFamily.name,
              confidence: inferred.confidence,
              reasons: inferred.reasons,
            }
          : null,
        latestVersion: source.versions[0]
          ? {
              id: source.versions[0].id,
              version: source.versions[0].version,
              extractionMetaJson: source.versions[0].extractionMetaJson,
              createdAt: source.versions[0].createdAt.toISOString(),
            }
          : null,
        latestRun: latestRun
          ? {
              id: latestRun.id,
              reviewStatus: latestRun.reviewStatus,
              confidence: latestRun.confidence,
              warningCount: latestRun.warningCount,
              sessionCount: latestRun.sessionCount,
              weekCount: latestRun.weekCount,
              createdAt: latestRun.createdAt.toISOString(),
              summaryJson: latestRun.summaryJson,
              layoutFamily: latestRun.layoutFamily
                ? {
                    id: latestRun.layoutFamily.id,
                    slug: latestRun.layoutFamily.slug,
                    name: latestRun.layoutFamily.name,
                  }
                : null,
              latestReview: latestRun.reviews[0]
                ? {
                    id: latestRun.reviews[0].id,
                    status: latestRun.reviews[0].status,
                    notes: latestRun.reviews[0].notes,
                    reviewerEmail: latestRun.reviews[0].reviewerEmail,
                    createdAt: latestRun.reviews[0].createdAt.toISOString(),
                  }
                : null,
            }
          : null,
      };
    }),
  };
}

export async function getParserStudioSourceDetail(planSourceId: string) {
  const planSource = await prisma.planSource.findUnique({
    where: { id: planSourceId },
    include: {
      layoutFamily: true,
      versions: {
        orderBy: { version: 'desc' },
        take: 5,
        include: {
          weeks: {
            orderBy: { weekIndex: 'asc' },
            include: {
              sessions: {
                orderBy: [{ dayOfWeek: 'asc' }, { ordinal: 'asc' }],
              },
            },
          },
          rules: {
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          },
        },
      },
      extractionRuns: {
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: {
          layoutFamily: true,
          reviews: {
            orderBy: { createdAt: 'desc' },
            take: 12,
          },
        },
      },
      annotations: {
        orderBy: [{ pageNumber: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!planSource) {
    throw new ApiError(404, 'PLAN_SOURCE_NOT_FOUND', 'Plan source not found.');
  }

  const { assigned, inferred, recommended, layoutFamilies } = await getAssignedOrInferredLayoutFamily(planSource);
  const latestVersion = planSource.versions[0] ?? null;
  const latestRun = planSource.extractionRuns[0] ?? null;
  const assignedRules = parseLayoutFamilyRules(assigned?.rulesJson ?? null);
  const pdfBuffer = await loadPlanSourcePdfBuffer(planSource);
  const pdfDocument = pdfBuffer ? await extractStructuredPdfDocument(pdfBuffer) : null;
  const preview = buildLayoutFamilyTemplatePreview({
    familySlug: assigned?.slug ?? recommended?.slug ?? inferred.slug,
    planSourceId: planSource.id,
    annotations: planSource.annotations as any,
    document: pdfDocument ?? undefined,
    rulesJson: assigned?.rulesJson ?? null,
  });

  return {
    layoutFamilies,
    planSource: {
      id: planSource.id,
      title: planSource.title,
      type: planSource.type,
      sport: planSource.sport,
      distance: planSource.distance,
      level: planSource.level,
      durationWeeks: planSource.durationWeeks,
      season: planSource.season,
      author: planSource.author,
      publisher: planSource.publisher,
      sourceUrl: planSource.sourceUrl,
      sourceFilePath: planSource.sourceFilePath,
      storedDocumentUrl: planSource.storedDocumentUrl,
      rawText: planSource.rawText,
      isActive: planSource.isActive,
      createdAt: planSource.createdAt.toISOString(),
      updatedAt: planSource.updatedAt.toISOString(),
      layoutFamily: assigned
        ? {
            id: assigned.id,
            slug: assigned.slug,
            name: assigned.name,
            description: assigned.description,
            hasCompiledRules: Boolean(assignedRules),
            compiledTemplateVersion: assignedRules?.version ?? null,
            templateSourcePlanId: assignedRules?.templateSourcePlanId ?? null,
          }
        : null,
      recommendedLayoutFamily: recommended
        ? {
            id: recommended.id,
            slug: recommended.slug,
            name: recommended.name,
            description: recommended.description,
            confidence: inferred.confidence,
            reasons: inferred.reasons,
          }
        : null,
      latestVersion: latestVersion
        ? {
            id: latestVersion.id,
            version: latestVersion.version,
            createdAt: latestVersion.createdAt.toISOString(),
            extractionMetaJson: latestVersion.extractionMetaJson,
            weeks: latestVersion.weeks.map((week) => ({
              id: week.id,
              weekIndex: week.weekIndex,
              phase: week.phase,
              totalMinutes: week.totalMinutes,
              totalSessions: week.totalSessions,
              notes: week.notes,
              sessions: week.sessions.map((session) => ({
                id: session.id,
                ordinal: session.ordinal,
                dayOfWeek: session.dayOfWeek,
                discipline: session.discipline,
                sessionType: session.sessionType,
                title: session.title,
                durationMinutes: session.durationMinutes,
                distanceKm: session.distanceKm,
                intensityType: session.intensityType,
                parserConfidence: session.parserConfidence,
                parserWarningsJson: session.parserWarningsJson,
                recipeV2Json: session.recipeV2Json,
                structureJson: session.structureJson,
                notes: session.notes,
              })),
            })),
            rules: latestVersion.rules.map((rule) => ({
              id: rule.id,
              ruleType: rule.ruleType,
              phase: rule.phase,
              explanation: rule.explanation,
              priority: rule.priority,
            })),
          }
        : null,
      extractionRuns: planSource.extractionRuns.map((run) => ({
        id: run.id,
        extractorVersion: run.extractorVersion,
        reviewStatus: run.reviewStatus,
        confidence: run.confidence,
        warningCount: run.warningCount,
        sessionCount: run.sessionCount,
        weekCount: run.weekCount,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        summaryJson: run.summaryJson,
        layoutFamily: run.layoutFamily
          ? {
              id: run.layoutFamily.id,
              slug: run.layoutFamily.slug,
              name: run.layoutFamily.name,
            }
          : null,
        reviews: run.reviews.map((review) => ({
          id: review.id,
          status: review.status,
          notes: review.notes,
          reviewerEmail: review.reviewerEmail,
          createdAt: review.createdAt.toISOString(),
        })),
      })),
      latestRun: latestRun
        ? {
            id: latestRun.id,
            reviewStatus: latestRun.reviewStatus,
            confidence: latestRun.confidence,
            warningCount: latestRun.warningCount,
            sessionCount: latestRun.sessionCount,
            weekCount: latestRun.weekCount,
            createdAt: latestRun.createdAt.toISOString(),
            summaryJson: latestRun.summaryJson,
          }
        : null,
      gridPreview: {
        pageNumber: preview.pageNumber,
        weekCount: preview.weekCount,
        dayCount: preview.dayCount,
        cellCount: preview.cells.length,
        diagnostics: preview.diagnostics,
        cells: preview.cells.map((cell) => ({
          pageNumber: cell.pageNumber,
          label: cell.label,
          weekIndex: cell.weekIndex,
          dayOfWeek: cell.dayOfWeek,
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
          bbox: cell.bbox,
        })),
      },
      annotations: planSource.annotations.map((annotation) => ({
        id: annotation.id,
        pageNumber: annotation.pageNumber,
        annotationType: annotation.annotationType,
        label: annotation.label,
        bboxJson: annotation.bboxJson,
        note: annotation.note,
        createdByEmail: annotation.createdByEmail,
        createdAt: annotation.createdAt.toISOString(),
        updatedAt: annotation.updatedAt.toISOString(),
      })),
    },
  };
}

export async function assignPlanSourceLayoutFamily(params: { planSourceId: string; layoutFamilyId: string | null }) {
  await ensurePlanSourceLayoutFamilies();

  if (params.layoutFamilyId) {
    const family = await prisma.planSourceLayoutFamily.findFirst({
      where: { id: params.layoutFamilyId, isActive: true },
    });
    if (!family) {
      throw new ApiError(404, 'LAYOUT_FAMILY_NOT_FOUND', 'Selected layout family was not found.');
    }
  }

  return prisma.planSource.update({
    where: { id: params.planSourceId },
    data: { layoutFamilyId: params.layoutFamilyId },
    include: { layoutFamily: true },
  });
}

export async function createPlanSourceExtractionReview(params: {
  planSourceId: string;
  reviewer: ReviewerContext;
  status: PlanSourceExtractionReviewStatus;
  notes?: string | null;
}) {
  const latestRun = await prisma.planSourceExtractionRun.findFirst({
    where: { planSourceId: params.planSourceId },
    orderBy: { createdAt: 'desc' },
  });

  if (!latestRun) {
    throw new ApiError(400, 'EXTRACTION_RUN_REQUIRED', 'No extraction run exists for this plan source yet.');
  }

  return prisma.$transaction(async (tx) => {
    const review = await tx.planSourceExtractionReview.create({
      data: {
        extractionRunId: latestRun.id,
        reviewerUserId: params.reviewer.userId,
        reviewerEmail: params.reviewer.email,
        status: params.status,
        notes: params.notes?.trim() || null,
      },
    });

    const run = await tx.planSourceExtractionRun.update({
      where: { id: latestRun.id },
      data: { reviewStatus: params.status },
    });

    return { review, run };
  });
}

export async function rerunPlanSourceExtraction(planSourceId: string) {
  const planSource = await prisma.planSource.findUnique({
    where: { id: planSourceId },
    include: {
      layoutFamily: true,
      annotations: {
        orderBy: [{ pageNumber: 'asc' }, { createdAt: 'asc' }],
      },
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });

  if (!planSource) {
    throw new ApiError(404, 'PLAN_SOURCE_NOT_FOUND', 'Plan source not found.');
  }

  const inferredLayout = inferLayoutFamily({
    title: planSource.title,
    rawText: planSource.rawText,
    sourceUrl: planSource.sourceUrl,
  });
  const pdfBuffer = await loadPlanSourcePdfBuffer(planSource);
  const pdfDocument = pdfBuffer ? await extractStructuredPdfDocument(pdfBuffer) : null;
  const compiledRules = planSource.layoutFamily
    ? compileLayoutFamilyRules({
        familySlug: planSource.layoutFamily.slug,
        planSourceId: planSource.id,
        annotations: planSource.annotations as any,
        document: pdfDocument ?? undefined,
      })
    : null;
  const layoutRulesJson = compiledRules ?? planSource.layoutFamily?.rulesJson ?? null;
  const extracted = pdfDocument
    ? extractFromStructuredPdfDocument({
        document: pdfDocument,
        durationWeeks: planSource.durationWeeks,
        rawTextFallback: planSource.rawText,
        layoutRulesJson,
        annotations: planSource.annotations as any,
      })
    : extractFromRawText(planSource.rawText, planSource.durationWeeks);
  const nextVersion = (planSource.versions[0]?.version ?? 0) + 1;

  return prisma.$transaction(
    async (tx) => {
      if (planSource.layoutFamily && compiledRules) {
        await tx.planSourceLayoutFamily.update({
          where: { id: planSource.layoutFamily.id },
          data: { rulesJson: compiledRules as Prisma.InputJsonValue },
        });
      }

      await tx.planSource.update({
        where: { id: planSource.id },
        data: {
          rawText: extracted.rawText,
          rawJson: extracted.rawJson as Prisma.InputJsonValue,
        },
      });

      return persistPlanSourceExtractionArtifacts(tx, {
        planSourceId: planSource.id,
        version: nextVersion,
        extracted,
        layoutFamily: planSource.layoutFamily
          ? {
              id: planSource.layoutFamily.id,
              slug: planSource.layoutFamily.slug,
              name: planSource.layoutFamily.name,
            }
          : null,
        inferredLayoutFamily: inferredLayout,
      });
    },
    {
      maxWait: 10_000,
      timeout: 60_000,
    }
  );
}

export async function createPlanSourceAnnotation(params: {
  planSourceId: string;
  reviewer: ReviewerContext;
  pageNumber: number;
  annotationType: PlanSourceAnnotationType;
  label?: string | null;
  note?: string | null;
  bboxJson: Prisma.InputJsonValue;
}) {
  const planSource = await prisma.planSource.findUnique({
    where: { id: params.planSourceId },
    select: { id: true },
  });
  if (!planSource) {
    throw new ApiError(404, 'PLAN_SOURCE_NOT_FOUND', 'Plan source not found.');
  }

  return prisma.planSourceAnnotation.create({
    data: {
      planSourceId: params.planSourceId,
      pageNumber: params.pageNumber,
      annotationType: params.annotationType,
      label: params.label?.trim() || null,
      note: params.note?.trim() || null,
      bboxJson: params.bboxJson,
      createdByUserId: params.reviewer.userId,
      createdByEmail: params.reviewer.email,
    },
  });
}

export async function updatePlanSourceSessionTemplate(params: {
  planSourceId: string;
  sessionId: string;
  reviewer: ReviewerContext;
  data: {
    dayOfWeek: number | null;
    discipline: 'SWIM' | 'BIKE' | 'RUN' | 'STRENGTH' | 'REST';
    sessionType: string;
    title: string | null;
    durationMinutes: number | null;
    distanceKm: number | null;
    notes: string | null;
  };
}) {
  const session = await prisma.planSourceSessionTemplate.findFirst({
    where: {
      id: params.sessionId,
      planSourceWeekTemplate: {
        planSourceVersion: {
          planSourceId: params.planSourceId,
        },
      },
    },
    include: {
      planSourceWeekTemplate: {
        include: {
          planSourceVersion: {
            select: {
              id: true,
              planSourceId: true,
              version: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw new ApiError(404, 'PLAN_SOURCE_SESSION_NOT_FOUND', 'Plan source session was not found.');
  }

  const latestVersion = await prisma.planSourceVersion.findFirst({
    where: { planSourceId: params.planSourceId },
    orderBy: { version: 'desc' },
    select: { id: true },
  });

  if (!latestVersion || latestVersion.id !== session.planSourceWeekTemplate.planSourceVersion.id) {
    throw new ApiError(400, 'SESSION_NOT_ON_LATEST_VERSION', 'Only sessions on the latest extracted version can be edited.');
  }

  const manualFields = deriveManualSessionTemplateFields({
    discipline: params.data.discipline,
    title: params.data.title,
    notes: params.data.notes,
    sessionType: params.data.sessionType,
    durationMinutes: params.data.durationMinutes,
    distanceKm: params.data.distanceKm,
    editor: {
      email: params.reviewer.email,
    },
  });

  await prisma.planSourceSessionTemplate.update({
    where: { id: session.id },
    data: {
      dayOfWeek: params.data.dayOfWeek,
      discipline: params.data.discipline,
      sessionType: manualFields.sessionType,
      title: params.data.title?.trim() || null,
      durationMinutes: manualFields.durationMinutes,
      distanceKm: manualFields.distanceKm,
      intensityType: manualFields.intensityType,
      intensityTargetJson: manualFields.intensityTargetJson as Prisma.InputJsonValue,
      recipeV2Json: manualFields.recipeV2Json as Prisma.InputJsonValue,
      parserConfidence: manualFields.parserConfidence,
      parserWarningsJson: manualFields.parserWarningsJson as Prisma.InputJsonValue,
      structureJson: manualFields.structureJson as Prisma.InputJsonValue,
      notes: manualFields.notes,
    },
  });

  return getParserStudioSourceDetail(params.planSourceId);
}

export async function deletePlanSourceAnnotation(params: { planSourceId: string; annotationId: string }) {
  const annotation = await prisma.planSourceAnnotation.findFirst({
    where: {
      id: params.annotationId,
      planSourceId: params.planSourceId,
    },
    select: { id: true },
  });

  if (!annotation) {
    throw new ApiError(404, 'PLAN_SOURCE_ANNOTATION_NOT_FOUND', 'Plan source annotation not found.');
  }

  await prisma.planSourceAnnotation.delete({ where: { id: annotation.id } });
}
