import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import type { DraftPlanV1 } from '../rules/draft-generator';

import { requireAiPlanBuilderV1Enabled } from './flag';

import { computeStableSha256 } from '../rules/stable-hash';
import { buildDraftPlanJsonV1 } from '../rules/plan-json';
import { normalizeDraftPlanJsonDurations } from '../rules/duration-rounding';
import { getAiPlanBuilderAIForCoachRequest } from './ai';
import { mapWithConcurrency } from '@/lib/concurrency';
import {
  buildDeterministicSessionDetailV1,
  normalizeSessionDetailV1DurationsToTotal,
  reflowSessionDetailV1ToNewTotal,
  sessionDetailV1Schema,
} from '../rules/session-detail';
import { getAiPlanBuilderCapabilitySpecVersion, getAiPlanBuilderEffectiveMode } from '../ai/config';
import { recordAiInvocationAudit } from './ai-invocation-audit';

export const createDraftPlanSchema = z.object({
  planJson: z.unknown(),
});

export const draftPlanSetupV1Schema = z.object({
  weekStart: z.enum(['monday', 'sunday']).optional().default('monday'),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weeksToEvent: z.number().int().min(1).max(52),
  weeklyAvailabilityDays: z.array(z.number().int().min(0).max(6)).min(1),
  weeklyAvailabilityMinutes: z.union([
    z.number().int().min(0).max(10_000),
    z.record(z.string(), z.number().int().min(0).max(10_000)),
  ]),
  disciplineEmphasis: z.enum(['balanced', 'swim', 'bike', 'run']),
  riskTolerance: z.enum(['low', 'med', 'high']),
  maxIntensityDaysPerWeek: z.number().int().min(1).max(3),
  maxDoublesPerWeek: z.number().int().min(0).max(3),
  longSessionDay: z.number().int().min(0).max(6).nullable().optional(),
  coachGuidanceText: z.string().max(2_000).optional(),
});

export const generateDraftPlanV1Schema = z.object({
  setup: draftPlanSetupV1Schema,
});

export const updateDraftPlanV1Schema = z.object({
  draftPlanId: z.string().min(1),
  weekLocks: z
    .array(
      z.object({
        weekIndex: z.number().int().min(0).max(52),
        locked: z.boolean(),
      })
    )
    .optional(),
  sessionEdits: z
    .array(
      z.object({
        sessionId: z.string().min(1),
        discipline: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        durationMinutes: z.number().int().min(0).max(10_000).optional(),
        notes: z.string().max(10_000).nullable().optional(),
        objective: z.string().max(240).nullable().optional(),
        blockEdits: z
          .array(
            z.object({
              blockIndex: z.number().int().min(0).max(19),
              steps: z.string().min(1).max(1_000),
            })
          )
          .optional(),
        locked: z.boolean().optional(),
      })
    )
    .optional(),
});

export async function createAiDraftPlan(params: { coachId: string; athleteId: string; planJson: unknown }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.aiPlanDraft.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      source: 'AI_DRAFT',
      status: 'DRAFT',
      planJson: params.planJson as Prisma.InputJsonValue,
    },
  });
}

export async function generateAiDraftPlanV1(params: {
  coachId: string;
  athleteId: string;
  setup: z.infer<typeof draftPlanSetupV1Schema>;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const setup = {
    ...params.setup,
    weekStart: params.setup.weekStart ?? 'monday',
    coachGuidanceText: params.setup.coachGuidanceText ?? '',
  };

  const ai = getAiPlanBuilderAIForCoachRequest({ coachId: params.coachId, athleteId: params.athleteId });
  const suggestion = await ai.suggestDraftPlan({ setup: setup as any });
  const draft: DraftPlanV1 = normalizeDraftPlanJsonDurations({ setup, planJson: suggestion.planJson });
  const setupHash = computeStableSha256(setup);

  const created = await prisma.aiPlanDraft.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      source: 'AI_DRAFT',
      status: 'DRAFT',
      planJson: draft as unknown as Prisma.InputJsonValue,
      setupJson: setup as unknown as Prisma.InputJsonValue,
      setupHash,
      weeks: {
        create: draft.weeks.map((w) => ({
          weekIndex: w.weekIndex,
          locked: w.locked,
          sessionsCount: w.sessions.length,
          totalMinutes: w.sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
        })),
      },
      sessions: {
        create: draft.weeks.flatMap((w) =>
          w.sessions.map((s) => ({
            weekIndex: w.weekIndex,
            ordinal: s.ordinal,
            dayOfWeek: s.dayOfWeek,
            discipline: s.discipline,
            type: s.type,
            durationMinutes: s.durationMinutes,
            notes: s.notes ?? null,
            locked: s.locked,
          }))
        ),
      },
    },
    include: {
      weeks: { orderBy: [{ weekIndex: 'asc' }] },
      sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
    },
  });

  // Enrich sessions with schema-validated detail JSON after deterministic rows are persisted.
  // IMPORTANT: do not do this inside an interactive transaction.
  try {
    await generateSessionDetailsForDraftPlan({
      coachId: params.coachId,
      athleteId: params.athleteId,
      draftPlanId: created.id,
    });
  } catch {
    // Draft generation should still succeed even if enrichment fails.
  }

  return prisma.aiPlanDraft.findUniqueOrThrow({
    where: { id: created.id },
    include: {
      weeks: { orderBy: [{ weekIndex: 'asc' }] },
      sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
    },
  });
}

async function getAthleteSummaryTextForSessionDetail(params: { coachId: string; athleteId: string; setup: any }) {
  const row = await prisma.athleteProfileAI.findFirst({
    where: { coachId: params.coachId, athleteId: params.athleteId, status: 'APPROVED' as any },
    orderBy: [{ approvedAt: 'desc' }, { createdAt: 'desc' }],
    select: { extractedSummaryText: true },
  });

  if (row?.extractedSummaryText) return row.extractedSummaryText;

  const weeklyMinutesTarget = (() => {
    const v = params.setup?.weeklyAvailabilityMinutes;
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object') {
      return Object.values(v as Record<string, number>).reduce((sum, n) => sum + (Number(n) || 0), 0);
    }
    return 0;
  })();

  const days = Array.isArray(params.setup?.weeklyAvailabilityDays) ? params.setup.weeklyAvailabilityDays.length : 0;
  const risk = String(params.setup?.riskTolerance ?? 'med');
  const emphasis = String(params.setup?.disciplineEmphasis ?? 'balanced');

  return `Athlete summary (fallback): ${days} days/week, ~${weeklyMinutesTarget} min/week target, riskTolerance=${risk}, emphasis=${emphasis}.`;
}

export async function generateSessionDetailsForDraftPlan(params: {
  coachId: string;
  athleteId: string;
  draftPlanId: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.draftPlanId },
    select: {
      id: true,
      athleteId: true,
      coachId: true,
      setupJson: true,
      sessions: {
        orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
        select: {
          id: true,
          weekIndex: true,
          ordinal: true,
          dayOfWeek: true,
          discipline: true,
          type: true,
          durationMinutes: true,
          detailJson: true,
          detailInputHash: true,
          detailGeneratedAt: true,
          detailMode: true,
        },
      },
    },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  const setup = draft.setupJson as any;
  const athleteSummaryText = await getAthleteSummaryTextForSessionDetail({
    coachId: params.coachId,
    athleteId: params.athleteId,
    setup,
  });

  const weeklyMinutesTarget = (() => {
    const v = setup?.weeklyAvailabilityMinutes;
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object') {
      return Object.values(v as Record<string, number>).reduce((sum, n) => sum + (Number(n) || 0), 0);
    }
    return 0;
  })();

  const ai = getAiPlanBuilderAIForCoachRequest({ coachId: params.coachId, athleteId: params.athleteId });
  const effectiveMode = getAiPlanBuilderEffectiveMode('generateSessionDetail');
  const now = new Date();

  await mapWithConcurrency(draft.sessions, 4, async (s) => {
    // Coach edits are authoritative; never overwrite them during background enrichment.
    if (String((s as any)?.detailMode || '') === 'coach') return;

    const input = {
      athleteSummaryText,
      constraints: {
        riskTolerance: setup?.riskTolerance,
        maxIntensityDaysPerWeek: setup?.maxIntensityDaysPerWeek,
        longSessionDay: setup?.longSessionDay ?? null,
        weeklyMinutesTarget,
      },
      session: {
        weekIndex: s.weekIndex,
        dayOfWeek: s.dayOfWeek,
        discipline: s.discipline,
        type: s.type,
        durationMinutes: s.durationMinutes,
      },
    };

    const detailInputHash = computeStableSha256(input);

    if (s.detailJson && s.detailInputHash === detailInputHash) return;

    try {
      const result = await ai.generateSessionDetail(input as any);
      const parsed = sessionDetailV1Schema.safeParse((result as any)?.detail);
      const baseDetail = parsed.success
        ? parsed.data
        : buildDeterministicSessionDetailV1({
            discipline: s.discipline as any,
            type: s.type,
            durationMinutes: s.durationMinutes,
          });

      const detail = normalizeSessionDetailV1DurationsToTotal({ detail: baseDetail, totalMinutes: s.durationMinutes });

      await prisma.aiPlanDraftSession.update({
        where: { id: s.id },
        data: {
          detailJson: detail as unknown as Prisma.InputJsonValue,
          detailInputHash,
          detailGeneratedAt: now,
          detailMode: effectiveMode,
        },
      });
    } catch {
      // Defensive catch-all: persist deterministic minimal detail and write a metadata-only audit row.
      const baseDetail = buildDeterministicSessionDetailV1({
        discipline: s.discipline as any,
        type: s.type,
        durationMinutes: s.durationMinutes,
      });

      const detail = normalizeSessionDetailV1DurationsToTotal({ detail: baseDetail, totalMinutes: s.durationMinutes });

      await prisma.aiPlanDraftSession.update({
        where: { id: s.id },
        data: {
          detailJson: detail as unknown as Prisma.InputJsonValue,
          detailInputHash,
          detailGeneratedAt: now,
          detailMode: 'deterministic',
        },
      });

      await recordAiInvocationAudit(
        {
          capability: 'generateSessionDetail',
          specVersion: getAiPlanBuilderCapabilitySpecVersion('generateSessionDetail'),
          effectiveMode,
          provider: 'unknown',
          model: null,
          inputHash: computeStableSha256(input),
          outputHash: computeStableSha256({ detail }),
          durationMs: 0,
          maxOutputTokens: null,
          timeoutMs: null,
          retryCount: 0,
          fallbackUsed: true,
          errorCode: 'PIPELINE_EXCEPTION',
        },
        {
          actorType: 'COACH',
          actorId: params.coachId,
          coachId: params.coachId,
          athleteId: params.athleteId,
        }
      );
    }
  });
}


export async function getLatestAiDraftPlan(params: { coachId: string; athleteId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.aiPlanDraft.findFirst({
    where: { athleteId: params.athleteId, coachId: params.coachId },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      weeks: { orderBy: [{ weekIndex: 'asc' }] },
      sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
    },
  });
}

export async function updateAiDraftPlan(params: {
  coachId: string;
  athleteId: string;
  draftPlanId: string;
  weekLocks?: Array<{ weekIndex: number; locked: boolean }>;
  sessionEdits?: Array<{
    sessionId: string;
    discipline?: string;
    type?: string;
    durationMinutes?: number;
    notes?: string | null;
    objective?: string | null;
    blockEdits?: Array<{ blockIndex: number; steps: string }>;
    locked?: boolean;
  }>;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.draftPlanId },
    select: { id: true, athleteId: true, coachId: true },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  await prisma.$transaction(
    async (tx) => {
    if (params.weekLocks?.length) {
      for (const wl of params.weekLocks) {
        await tx.aiPlanDraftWeek.updateMany({
          where: { draftId: draft.id, weekIndex: wl.weekIndex },
          data: { locked: wl.locked },
        });
      }
    }

    if (params.sessionEdits?.length) {
      // Week lock enforcement: if a week is locked, sessions within that week are immutable
      // (including lock/unlock toggles).
      const editedWeekIndexSet = new Set<number>();
      for (const edit of params.sessionEdits) {
        const existing = await tx.aiPlanDraftSession.findUnique({
          where: { id: edit.sessionId },
          select: { id: true, draftId: true, weekIndex: true },
        });
        if (!existing || existing.draftId !== draft.id) {
          throw new ApiError(404, 'NOT_FOUND', 'Draft session not found.');
        }
        if (Number.isInteger(existing.weekIndex)) editedWeekIndexSet.add(existing.weekIndex);
      }
      const editedWeekIndices = Array.from(editedWeekIndexSet);

      if (editedWeekIndices.length) {
        const lockedWeek = await tx.aiPlanDraftWeek.findFirst({
          where: { draftId: draft.id, weekIndex: { in: editedWeekIndices }, locked: true },
          select: { weekIndex: true },
        });

        if (lockedWeek) {
          throw new ApiError(409, 'WEEK_LOCKED', 'Week is locked and sessions cannot be modified.', {
            weekIndex: lockedWeek.weekIndex,
          });
        }
      }

      const roundDurationTo5TowardChange = (next: number, previous: number) => {
        const v = Number.isFinite(next) ? Math.trunc(next) : 0;
        const prev = Number.isFinite(previous) ? Math.trunc(previous) : 0;

        if (v === prev) return Math.max(0, Math.min(10_000, v));
        if (v > prev) return Math.max(0, Math.min(10_000, Math.ceil(v / 5) * 5));
        return Math.max(0, Math.min(10_000, Math.floor(v / 5) * 5));
      };

      for (const edit of params.sessionEdits) {
        const existing = await tx.aiPlanDraftSession.findUnique({
          where: { id: edit.sessionId },
          select: {
            id: true,
            draftId: true,
            locked: true,
            weekIndex: true,
            discipline: true,
            type: true,
            durationMinutes: true,
            detailJson: true,
            detailMode: true,
          },
        });

        if (!existing || existing.draftId !== draft.id) {
          throw new ApiError(404, 'NOT_FOUND', 'Draft session not found.');
        }

        const wantsContentChange =
          edit.discipline !== undefined ||
          edit.type !== undefined ||
          edit.durationMinutes !== undefined ||
          edit.notes !== undefined ||
          edit.objective !== undefined ||
          (Array.isArray(edit.blockEdits) && edit.blockEdits.length > 0);

        // Locked sessions are immutable unless the only change is toggling locked=false.
        if (existing.locked && wantsContentChange) {
          throw new ApiError(409, 'SESSION_LOCKED', 'Session is locked and cannot be edited.');
        }

        const nextDiscipline = edit.discipline !== undefined ? String(edit.discipline) : String(existing.discipline);
        const nextType = edit.type !== undefined ? String(edit.type) : String(existing.type);
        const nextDurationMinutes =
          edit.durationMinutes !== undefined
            ? roundDurationTo5TowardChange(edit.durationMinutes, Number(existing.durationMinutes ?? 0))
            : Number(existing.durationMinutes ?? 0);

        const disciplineChanged = edit.discipline !== undefined && String(edit.discipline) !== String(existing.discipline);
        const typeChanged = edit.type !== undefined && String(edit.type) !== String(existing.type);
        const durationChanged = edit.durationMinutes !== undefined && nextDurationMinutes !== Number(existing.durationMinutes ?? 0);
        const objectiveChanged = edit.objective !== undefined;
        const hasBlockEdits = Array.isArray(edit.blockEdits) && edit.blockEdits.length > 0;

        const shouldEditDetail = disciplineChanged || typeChanged || durationChanged || objectiveChanged || hasBlockEdits;

        let nextDetailJson: any = undefined;
        let nextDetailMode: string | undefined = undefined;
        let nextDetailGeneratedAt: Date | undefined = undefined;
        let nextDetailInputHash: string | null | undefined = undefined;

        if (shouldEditDetail) {
          // If discipline/type changes, rebuild a fresh deterministic template so text stays coherent.
          const baseDetail = (() => {
            if (disciplineChanged || typeChanged) {
              return buildDeterministicSessionDetailV1({
                discipline: nextDiscipline as any,
                type: nextType,
                durationMinutes: nextDurationMinutes,
              });
            }

            const parsed = sessionDetailV1Schema.safeParse(existing.detailJson);
            if (parsed.success) return parsed.data;
            return buildDeterministicSessionDetailV1({
              discipline: nextDiscipline as any,
              type: nextType,
              durationMinutes: nextDurationMinutes,
            });
          })();

          let updatedDetail = durationChanged
            ? reflowSessionDetailV1ToNewTotal({ detail: baseDetail, newTotalMinutes: nextDurationMinutes })
            : normalizeSessionDetailV1DurationsToTotal({ detail: baseDetail, totalMinutes: nextDurationMinutes });

          if (edit.objective !== undefined) {
            const v = edit.objective === null ? '' : String(edit.objective);
            const trimmed = v.trim();
            if (trimmed) {
              updatedDetail = { ...updatedDetail, objective: trimmed };
            }
          }

          if (Array.isArray(edit.blockEdits) && edit.blockEdits.length) {
            const structure = updatedDetail.structure.map((b) => ({ ...b }));
            for (const be of edit.blockEdits) {
              const idx = Number(be.blockIndex);
              if (!Number.isInteger(idx) || idx < 0 || idx >= structure.length) continue;
              const steps = String(be.steps ?? '').trim();
              if (!steps) continue;
              structure[idx] = { ...structure[idx], steps };
            }
            updatedDetail = { ...updatedDetail, structure };
          }

          updatedDetail = normalizeSessionDetailV1DurationsToTotal({ detail: updatedDetail, totalMinutes: nextDurationMinutes });

          nextDetailJson = updatedDetail as unknown as Prisma.InputJsonValue;
          nextDetailMode = 'coach';
          nextDetailGeneratedAt = new Date();
          nextDetailInputHash = computeStableSha256({
            coachEdited: true,
            discipline: nextDiscipline,
            type: nextType,
            durationMinutes: nextDurationMinutes,
            detail: updatedDetail,
          });
        }

        await tx.aiPlanDraftSession.update({
          where: { id: existing.id },
          data: {
            discipline: edit.discipline !== undefined ? nextDiscipline : undefined,
            type: edit.type,
            durationMinutes: edit.durationMinutes !== undefined ? nextDurationMinutes : undefined,
            notes: edit.notes === undefined ? undefined : edit.notes,
            locked: edit.locked,
            ...(shouldEditDetail
              ? {
                  detailJson: nextDetailJson,
                  detailMode: nextDetailMode,
                  detailGeneratedAt: nextDetailGeneratedAt,
                  detailInputHash: nextDetailInputHash,
                }
              : {}),
          },
        });
      }
    }

    // Recompute week summaries (count + minutes) for all weeks in the draft.
    const byWeek = await tx.aiPlanDraftSession.groupBy({
      by: ['weekIndex'],
      where: { draftId: draft.id },
      _count: { _all: true },
      _sum: { durationMinutes: true },
    });

    for (const w of byWeek) {
      await tx.aiPlanDraftWeek.updateMany({
        where: { draftId: draft.id, weekIndex: w.weekIndex },
        data: {
          sessionsCount: w._count._all,
          totalMinutes: w._sum.durationMinutes ?? 0,
        },
      });
    }

    // Keep planJson in sync with canonical week/session rows.
    const draftSetup = await tx.aiPlanDraft.findUnique({ where: { id: draft.id }, select: { setupJson: true } });
    const weeks = await tx.aiPlanDraftWeek.findMany({
      where: { draftId: draft.id },
      select: { weekIndex: true, locked: true },
    });
    const sessions = await tx.aiPlanDraftSession.findMany({
      where: { draftId: draft.id },
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

    if (draftSetup?.setupJson) {
      await tx.aiPlanDraft.update({
        where: { id: draft.id },
        data: {
          planJson: buildDraftPlanJsonV1({ setupJson: draftSetup.setupJson, weeks, sessions }),
        },
      });
    }
    },
    // Production safety: interactive transactions can time out under serverless latency spikes.
    // This path is user-facing and should be resilient to occasional DB slowness.
    { maxWait: 15_000, timeout: 15_000 }
  );

  return prisma.aiPlanDraft.findUniqueOrThrow({
    where: { id: draft.id },
    include: {
      weeks: { orderBy: [{ weekIndex: 'asc' }] },
      sessions: { orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }] },
    },
  });
}
