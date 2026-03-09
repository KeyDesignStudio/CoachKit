import type { CoachWorkoutExemplarFeedbackType, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import type { SessionReferenceRecipe } from '../ai/types';
import { sessionRecipeV2Schema, type SessionRecipeV2 } from '../rules/session-recipe';
import { sessionDetailV1Schema } from '../rules/session-detail';
import { computeStableSha256 } from '../rules/stable-hash';
import { syncSessionRecipeV2WithDetail } from '../rules/session-detail-recipe';

type DbClient = typeof prisma | Prisma.TransactionClient;

type ReferenceRecipePool = {
  planLibrary: Array<{
    id: string;
    discipline: string;
    sessionType: string;
    title: string | null;
    durationMinutes: number | null;
    distanceKm: number | null;
    notes: string | null;
    recipeV2: SessionRecipeV2;
    parserConfidence: number | null;
    parserWarnings: string[];
  }>;
  exemplars: Array<{
    id: string;
    discipline: string;
    sessionType: string;
    title: string | null;
    durationMinutes: number | null;
    distanceKm: number | null;
    notes: string | null;
    recipeV2: SessionRecipeV2;
  }>;
};

const INTENSE_TYPES = new Set(['tempo', 'threshold', 'vo2', 'time-trial']);
const EASY_TYPES = new Set(['easy', 'recovery', 'endurance', 'run-walk']);

function normalizeSessionType(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

function typeBucket(value: string | null | undefined) {
  const normalized = normalizeSessionType(value);
  if (normalized === 'long') return 'long';
  if (normalized === 'technique') return 'technique';
  if (normalized === 'brick') return 'brick';
  if (normalized === 'strength') return 'strength';
  if (INTENSE_TYPES.has(normalized)) return 'intense';
  if (EASY_TYPES.has(normalized)) return 'easy';
  return normalized || 'other';
}

function parseRecipeV2(value: unknown): SessionRecipeV2 | null {
  const direct = sessionRecipeV2Schema.safeParse(value);
  if (direct.success) return direct.data;

  const nested = sessionRecipeV2Schema.safeParse((value as any)?.recipeV2 ?? null);
  if (nested.success) return nested.data;

  return null;
}

function parseParserWarnings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  if (Array.isArray((value as any)?.parser?.warnings)) {
    return (value as any).parser.warnings.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  return [];
}

function parseParserConfidence(value: unknown): number | null {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const nested = Number((value as any)?.parser?.confidence);
  return Number.isFinite(nested) ? nested : null;
}

async function applyTemplateExemplarWeightDelta(params: {
  tx: Prisma.TransactionClient;
  coachId: string;
  discipline: string;
  sessionType: string;
  delta: number;
  deactivate?: boolean;
  exemplarId?: string | null;
  feedbackType?: CoachWorkoutExemplarFeedbackType | 'PROMOTED' | 'UPDATED' | null;
  draftId?: string | null;
  draftSessionId?: string | null;
  reason?: string;
}) {
  const discipline = String(params.discipline ?? '').trim().toUpperCase();
  const sessionType = normalizeSessionType(params.sessionType) || 'endurance';
  if (!discipline) return;

  const keys = [
    `coach:${params.coachId}|disc:${discipline}|type:${sessionType}`,
    `global|disc:${discipline}|type:${sessionType}`,
  ];

  const links = await params.tx.planLibraryTemplateExemplarLink.findMany({
    where: {
      planTemplate: {
        createdBy: params.coachId,
      },
      retrievalKey: {
        in: keys,
      },
      isActive: true,
    },
    select: {
      id: true,
      retrievalKey: true,
      retrievalWeight: true,
    },
  });

  for (const link of links) {
    const oldWeight = Number(link.retrievalWeight ?? 1);
    const nextWeight = Math.max(0.05, Math.min(5, oldWeight + params.delta));
    await params.tx.planLibraryTemplateExemplarLink.update({
      where: { id: link.id },
      data: {
        retrievalWeight: nextWeight,
        ...(params.deactivate ? { isActive: false } : {}),
      },
    });
    await params.tx.exemplarWeightHistory.create({
      data: {
        exemplarId: params.exemplarId ?? null,
        coachId: params.coachId,
        discipline,
        sessionType,
        retrievalKey: link.retrievalKey,
        oldWeight,
        newWeight: nextWeight,
        delta: Number((nextWeight - oldWeight).toFixed(3)),
        reason: params.reason ?? 'Template exemplar weight adjusted from coach feedback.',
        feedbackType: params.feedbackType ?? null,
        draftId: params.draftId ?? null,
        draftSessionId: params.draftSessionId ?? null,
      },
    });
  }
}

function extractSelectedTemplateIds(params: { planSourceSelectionJson: Prisma.JsonValue | null; setupJson: Prisma.JsonValue | null }) {
  const fromSelection = Array.isArray((params.planSourceSelectionJson as any)?.selectedPlanSourceVersionIds)
    ? (params.planSourceSelectionJson as any).selectedPlanSourceVersionIds
    : [];
  const fromSetup = Array.isArray((params.setupJson as any)?.selectedPlanSourceVersionIds)
    ? (params.setupJson as any).selectedPlanSourceVersionIds
    : [];

  return Array.from(
    new Set(
      [...fromSelection, ...fromSetup]
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim())
    )
  );
}

export async function buildReferenceRecipePool(params: {
  coachId: string;
  planSourceSelectionJson: Prisma.JsonValue | null;
  setupJson: Prisma.JsonValue | null;
  sessions: Array<{ discipline: string; type: string }>;
}) {
  const disciplines = Array.from(
    new Set(
      params.sessions
        .map((session) => String(session.discipline ?? '').trim().toUpperCase())
        .filter((discipline) => discipline.length > 0)
    )
  );
  const selectedTemplateIds = extractSelectedTemplateIds({
    planSourceSelectionJson: params.planSourceSelectionJson,
    setupJson: params.setupJson,
  });

  const [planLibraryRows, exemplarRows] = await Promise.all([
    selectedTemplateIds.length
      ? prisma.planLibraryTemplateSession.findMany({
          where: {
            planTemplateWeek: {
              planTemplateId: {
                in: selectedTemplateIds,
              },
              planTemplate: {
                isPublished: true,
              },
            },
            discipline: {
              in: disciplines as any,
            },
          },
          select: {
            id: true,
            discipline: true,
            sessionType: true,
            title: true,
            durationMinutes: true,
            distanceKm: true,
            notes: true,
            recipeV2Json: true,
            sourceConfidence: true,
          },
        })
      : Promise.resolve([]),
    disciplines.length
      ? prisma.coachWorkoutExemplar.findMany({
          where: {
            coachId: params.coachId,
            isActive: true,
            discipline: {
              in: disciplines,
            },
          },
          select: {
            id: true,
            discipline: true,
            sessionType: true,
            title: true,
            durationMinutes: true,
            distanceKm: true,
            notes: true,
            recipeV2Json: true,
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    planLibrary: planLibraryRows
      .map((row) => {
        const recipeV2 = parseRecipeV2(row.recipeV2Json ?? null);
        if (!recipeV2) return null;
        return {
          id: row.id,
          discipline: String(row.discipline),
          sessionType: String(row.sessionType),
          title: row.title ?? null,
          durationMinutes: row.durationMinutes ?? null,
          distanceKm: row.distanceKm ?? null,
          notes: row.notes ?? null,
          recipeV2,
          parserConfidence: row.sourceConfidence ?? null,
          parserWarnings: [],
        };
      })
      .filter(Boolean) as ReferenceRecipePool['planLibrary'],
    exemplars: exemplarRows
      .map((row) => {
        const recipeV2 = parseRecipeV2(row.recipeV2Json ?? null);
        if (!recipeV2) return null;
        return {
          id: row.id,
          discipline: String(row.discipline),
          sessionType: String(row.sessionType),
          title: row.title ?? null,
          durationMinutes: row.durationMinutes ?? null,
          distanceKm: row.distanceKm ?? null,
          notes: row.notes ?? null,
          recipeV2,
        };
      })
      .filter(Boolean) as ReferenceRecipePool['exemplars'],
  };
}

function scoreReferenceRecipe(params: {
  session: { discipline: string; type: string; durationMinutes: number };
  recipe: { discipline: string; sessionType: string; durationMinutes: number | null };
  sourceKind: SessionReferenceRecipe['sourceKind'];
  parserConfidence?: number | null;
}) {
  if (String(params.recipe.discipline).toUpperCase() !== String(params.session.discipline).toUpperCase()) return Number.NEGATIVE_INFINITY;

  const sessionType = normalizeSessionType(params.session.type);
  const recipeType = normalizeSessionType(params.recipe.sessionType);
  let score = params.sourceKind === 'coach-exemplar' ? 35 : 18;

  if (recipeType === sessionType) score += 24;
  else if (typeBucket(recipeType) === typeBucket(sessionType)) score += 10;

  const durationDelta = Math.abs(Number(params.recipe.durationMinutes ?? params.session.durationMinutes) - Number(params.session.durationMinutes ?? 0));
  score += Math.max(0, 18 - Math.min(18, durationDelta));

  if (params.sourceKind === 'plan-library') score += Math.max(0, Math.min(6, Number(params.parserConfidence ?? 0) * 6));
  return score;
}

export function selectReferenceRecipesForSession(params: {
  pool: ReferenceRecipePool;
  session: { discipline: string; type: string; durationMinutes: number };
  limit?: number;
}) {
  const candidates: Array<SessionReferenceRecipe & { score: number; exemplarId?: string }> = [];

  for (const row of params.pool.exemplars) {
    const score = scoreReferenceRecipe({
      session: params.session,
      recipe: row,
      sourceKind: 'coach-exemplar',
    });
    if (!Number.isFinite(score)) continue;
    candidates.push({
      referenceId: row.id,
      sourceKind: 'coach-exemplar',
      title: row.title ?? null,
      discipline: row.discipline,
      sessionType: row.sessionType,
      durationMinutes: row.durationMinutes ?? null,
      distanceKm: row.distanceKm ?? null,
      notes: row.notes ?? null,
      recipeV2: row.recipeV2,
      score,
      exemplarId: row.id,
    });
  }

  for (const row of params.pool.planLibrary) {
    const score = scoreReferenceRecipe({
      session: params.session,
      recipe: row,
      sourceKind: 'plan-library',
      parserConfidence: row.parserConfidence,
    });
    if (!Number.isFinite(score)) continue;
    candidates.push({
      referenceId: row.id,
      sourceKind: 'plan-library',
      title: row.title ?? null,
      discipline: row.discipline,
      sessionType: row.sessionType,
      durationMinutes: row.durationMinutes ?? null,
      distanceKm: row.distanceKm ?? null,
      notes: row.notes ?? null,
      recipeV2: row.recipeV2,
      parserConfidence: row.parserConfidence ?? null,
      parserWarnings: row.parserWarnings,
      score,
    });
  }

  const ranked = candidates
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.referenceId.localeCompare(b.referenceId)))
    .slice(0, Math.max(1, Math.min(4, params.limit ?? 3)));

  return {
    referenceRecipes: ranked.map(({ score, exemplarId, ...rest }) => rest),
    usedExemplarIds: ranked.map((candidate) => candidate.exemplarId).filter((value): value is string => Boolean(value)),
  };
}

export async function markCoachWorkoutExemplarsUsed(params: { exemplarIds: string[] }) {
  const exemplarIds = Array.from(new Set(params.exemplarIds.filter(Boolean)));
  if (!exemplarIds.length) return;

  await prisma.coachWorkoutExemplar.updateMany({
    where: { id: { in: exemplarIds } },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

export async function upsertCoachWorkoutExemplarFromSessionDetail(params: {
  db?: DbClient;
  coachId: string;
  athleteId?: string | null;
  draftId?: string | null;
  draftSessionId?: string | null;
  discipline: string;
  sessionType: string;
  durationMinutes: number;
  distanceKm?: number | null;
  title?: string | null;
  notes?: string | null;
  detail: unknown;
}) {
  const db = params.db ?? prisma;
  const parsed = sessionDetailV1Schema.safeParse(params.detail);
  if (!parsed.success) return null;

  const recipeV2 = syncSessionRecipeV2WithDetail(parsed.data);
  const fingerprintSha256 = computeStableSha256({
    discipline: params.discipline,
    sessionType: params.sessionType,
    durationMinutes: params.durationMinutes,
    recipeV2,
  });

  const existing = await db.coachWorkoutExemplar.findUnique({
    where: {
      coachId_fingerprintSha256: {
        coachId: params.coachId,
        fingerprintSha256,
      },
    },
    select: { id: true },
  });

  const exemplar = await db.coachWorkoutExemplar.upsert({
    where: {
      coachId_fingerprintSha256: {
        coachId: params.coachId,
        fingerprintSha256,
      },
    },
    update: {
      athleteId: params.athleteId ?? null,
      sourceType: 'COACH_EDIT',
      sourceDraftId: params.draftId ?? null,
      sourceDraftSessionId: params.draftSessionId ?? null,
      discipline: params.discipline,
      sessionType: params.sessionType,
      title: params.title ?? null,
      durationMinutes: params.durationMinutes,
      distanceKm: params.distanceKm ?? null,
      objective: parsed.data.objective,
      notes: params.notes ?? null,
      recipeV2Json: recipeV2 as unknown as Prisma.InputJsonValue,
      detailJson: parsed.data as unknown as Prisma.InputJsonValue,
      isActive: true,
    },
    create: {
      coachId: params.coachId,
      athleteId: params.athleteId ?? null,
      sourceType: 'COACH_EDIT',
      sourceDraftId: params.draftId ?? null,
      sourceDraftSessionId: params.draftSessionId ?? null,
      fingerprintSha256,
      discipline: params.discipline,
      sessionType: params.sessionType,
      title: params.title ?? null,
      durationMinutes: params.durationMinutes,
      distanceKm: params.distanceKm ?? null,
      objective: parsed.data.objective,
      notes: params.notes ?? null,
      recipeV2Json: recipeV2 as unknown as Prisma.InputJsonValue,
      detailJson: parsed.data as unknown as Prisma.InputJsonValue,
    },
  });

  await db.coachWorkoutExemplarFeedback.create({
    data: {
      exemplarId: exemplar.id,
      coachId: params.coachId,
      athleteId: params.athleteId ?? null,
      draftId: params.draftId ?? null,
      draftSessionId: params.draftSessionId ?? null,
      feedbackType: existing ? 'UPDATED' : 'PROMOTED',
    },
  });

  if ('planLibraryTemplateExemplarLink' in db) {
    const tx = db as Prisma.TransactionClient;
    await applyTemplateExemplarWeightDelta({
      tx,
      coachId: params.coachId,
      discipline: params.discipline,
      sessionType: params.sessionType,
      delta: existing ? 0.06 : 0.12,
      exemplarId: exemplar.id,
      feedbackType: existing ? 'UPDATED' : 'PROMOTED',
      draftId: params.draftId ?? null,
      draftSessionId: params.draftSessionId ?? null,
      reason: existing ? 'Coach updated an exemplar from a draft session.' : 'Coach promoted a draft session into the exemplar library.',
    });
  }

  return exemplar;
}

export async function recordCoachWorkoutExemplarFeedback(params: {
  coachId: string;
  exemplarId: string;
  feedbackType: CoachWorkoutExemplarFeedbackType;
  athleteId?: string | null;
  draftId?: string | null;
  draftSessionId?: string | null;
  note?: string | null;
}) {
  const exemplar = await prisma.coachWorkoutExemplar.findFirst({
    where: { id: params.exemplarId, coachId: params.coachId },
    select: { id: true },
  });
  if (!exemplar) {
    throw new ApiError(404, 'EXEMPLAR_NOT_FOUND', 'Workout exemplar not found.');
  }

  await prisma.$transaction(async (tx) => {
    const exemplarRow = await tx.coachWorkoutExemplar.findUnique({
      where: { id: params.exemplarId },
      select: { discipline: true, sessionType: true },
    });

    await tx.coachWorkoutExemplarFeedback.create({
      data: {
        exemplarId: params.exemplarId,
        coachId: params.coachId,
        athleteId: params.athleteId ?? null,
        draftId: params.draftId ?? null,
        draftSessionId: params.draftSessionId ?? null,
        feedbackType: params.feedbackType,
        note: params.note ?? null,
      },
    });

    await tx.coachWorkoutExemplar.update({
      where: { id: params.exemplarId },
      data: {
        ...(params.feedbackType === 'GOOD_FIT' ? { positiveFeedbackCount: { increment: 1 } } : {}),
        ...(['EDITED', 'TOO_EASY', 'TOO_HARD'].includes(params.feedbackType) ? { editFeedbackCount: { increment: 1 } } : {}),
        ...(params.feedbackType === 'ARCHIVED' ? { isActive: false } : {}),
      },
    });

    if (exemplarRow) {
      const deltaByFeedback: Partial<Record<CoachWorkoutExemplarFeedbackType, number>> = {
        GOOD_FIT: 0.14,
        EDITED: 0.05,
        TOO_EASY: -0.12,
        TOO_HARD: -0.12,
        ARCHIVED: -0.2,
      };
      const delta = deltaByFeedback[params.feedbackType] ?? 0;
      if (delta !== 0 || params.feedbackType === 'ARCHIVED') {
        await applyTemplateExemplarWeightDelta({
          tx,
          coachId: params.coachId,
          discipline: exemplarRow.discipline,
          sessionType: exemplarRow.sessionType,
          delta,
          deactivate: params.feedbackType === 'ARCHIVED',
          exemplarId: params.exemplarId,
          feedbackType: params.feedbackType,
          draftId: params.draftId ?? null,
          draftSessionId: params.draftSessionId ?? null,
          reason: `Coach exemplar feedback: ${params.feedbackType}.`,
        });
      }
    }
  });
}

export async function promoteDraftSessionToCoachWorkoutExemplar(params: {
  coachId: string;
  athleteId: string;
  draftPlanId: string;
  draftSessionId: string;
}) {
  const session = await prisma.aiPlanDraftSession.findFirst({
    where: {
      id: params.draftSessionId,
      draftId: params.draftPlanId,
      draft: {
        coachId: params.coachId,
        athleteId: params.athleteId,
      },
    },
    select: {
      id: true,
      draftId: true,
      discipline: true,
      type: true,
      durationMinutes: true,
      notes: true,
      detailJson: true,
    },
  });

  if (!session?.detailJson) {
    throw new ApiError(404, 'DRAFT_SESSION_DETAIL_NOT_FOUND', 'Draft session detail not found.');
  }

  return upsertCoachWorkoutExemplarFromSessionDetail({
    coachId: params.coachId,
    athleteId: params.athleteId,
    draftId: params.draftPlanId,
    draftSessionId: session.id,
    discipline: session.discipline,
    sessionType: session.type,
    durationMinutes: session.durationMinutes,
    notes: session.notes ?? null,
    detail: session.detailJson,
  });
}

export async function listCoachWorkoutExemplars(params: {
  coachId: string;
  discipline?: string | null;
  sessionType?: string | null;
  limit?: number;
}) {
  return prisma.coachWorkoutExemplar.findMany({
    where: {
      coachId: params.coachId,
      isActive: true,
      ...(params.discipline ? { discipline: { equals: params.discipline, mode: 'insensitive' } } : {}),
      ...(params.sessionType ? { sessionType: { equals: params.sessionType, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: Math.max(1, Math.min(100, params.limit ?? 20)),
  });
}
