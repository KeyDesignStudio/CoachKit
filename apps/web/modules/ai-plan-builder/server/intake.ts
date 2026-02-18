import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';
import { getAiPlanBuilderAIWithHooks } from '../ai/factory';
import { getAiPlanBuilderLlmRateLimitPerHourForCapabilityFromEnv } from '../ai/config';

import { consumeLlmRateLimitOrThrow } from './llm-rate-limit';
import { recordAiInvocationAudit } from './ai-invocation-audit';

export const intakeDraftSchema = z.object({
  draftJson: z.unknown().optional(),
});

export const intakeSubmitSchema = z.object({
  intakeResponseId: z.string().min(1),
});

export async function getLatestSubmittedIntake(params: { coachId: string; athleteId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.athleteIntakeResponse.findFirst({
    where: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      submittedAt: { not: null },
    },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function createIntakeDraft(params: { coachId: string; athleteId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.athleteIntakeResponse.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      status: 'DRAFT',
      source: 'manual',
      aiMode: null,
      draftJson: {},
    } as Prisma.AthleteIntakeResponseUncheckedCreateInput,
  });
}

export async function generateSubmittedIntakeFromProfile(params: { coachId: string; athleteId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const profile = await prisma.athleteProfile.findUnique({
    where: { userId: params.athleteId },
    select: {
      disciplines: true,
      primaryGoal: true,
      secondaryGoals: true,
      focus: true,
      timelineWeeks: true,
      experienceLevel: true,
      weeklyMinutesTarget: true,
      consistencyLevel: true,
      availableDays: true,
      scheduleVariability: true,
      sleepQuality: true,
      trainingPlanSchedule: true,
      coachNotes: true,
    },
  });

  if (!profile) {
    throw new ApiError(404, 'NOT_FOUND', 'Athlete profile not found.');
  }

  let invocationMeta: { effectiveMode: 'deterministic' | 'llm'; fallbackUsed: boolean } | null = null;
  const ctx = {
    actorType: 'COACH' as const,
    actorId: params.coachId,
    coachId: params.coachId,
    athleteId: params.athleteId,
  };

  const ai = getAiPlanBuilderAIWithHooks({
    beforeLlmCall: async ({ capability }) => {
      await consumeLlmRateLimitOrThrow({
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        capability,
        coachId: ctx.coachId,
        athleteId: ctx.athleteId,
      }, {
        limitPerHour: getAiPlanBuilderLlmRateLimitPerHourForCapabilityFromEnv(capability),
      });
    },
    onInvocation: async (meta) => {
      invocationMeta = meta as any;
      try {
        await recordAiInvocationAudit(meta, ctx);
      } catch (err) {
        // Do not block the workflow if auditing fails.
        // eslint-disable-next-line no-console
        console.warn('AI_INVOCATION_AUDIT_FAILED', {
          capability: meta.capability,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  const generated = await ai.generateIntakeFromProfile({
    profile: {
      disciplines: Array.isArray(profile.disciplines) ? profile.disciplines.map(String) : [],
      primaryGoal: profile.primaryGoal ?? null,
      secondaryGoals: profile.secondaryGoals ?? [],
      focus: profile.focus ?? null,
      timelineWeeks: profile.timelineWeeks ?? null,
      experienceLevel: profile.experienceLevel ?? null,
      weeklyMinutesTarget: profile.weeklyMinutesTarget ?? null,
      consistencyLevel: profile.consistencyLevel ?? null,
      availableDays: profile.availableDays ?? [],
      scheduleVariability: profile.scheduleVariability ?? null,
      sleepQuality: profile.sleepQuality ?? null,
      trainingPlanSchedule: (profile.trainingPlanSchedule as any) ?? null,
      coachNotes: profile.coachNotes ?? null,
    },
  });

  const draftJson = (generated?.draftJson ?? {}) as unknown;
  if (draftJson === null || typeof draftJson !== 'object' || Array.isArray(draftJson)) {
    throw new ApiError(500, 'INVALID_AI_OUTPUT', 'AI intake output must be an object.');
  }

  const entries = Object.entries(draftJson as Record<string, unknown>);

  const aiMode = (() => {
    // Note: invocationMeta is set via hook callback; TS flow analysis cannot "see" that.
    // Use a snapshot to avoid narrowing to `never`.
    const meta = invocationMeta as any;

    // Requirement: when deterministic (or fallback), label as deterministic_fallback.
    if (!meta) return 'unknown';
    if (meta.effectiveMode === 'deterministic') return 'deterministic_fallback';
    if (meta.effectiveMode === 'llm' && meta.fallbackUsed) return 'deterministic_fallback';
    if (meta.effectiveMode === 'llm') return 'llm';
    return String(meta.effectiveMode);
  })();

  const created = await prisma.$transaction(async (tx) => {
    const intakeResponse = await tx.athleteIntakeResponse.create({
      data: {
        athleteId: params.athleteId,
        coachId: params.coachId,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        source: 'ai_generated',
        aiMode,
        draftJson: draftJson as Prisma.InputJsonValue,
      } as Prisma.AthleteIntakeResponseUncheckedCreateInput,
    });

    if (entries.length > 0) {
      await tx.intakeEvidence.createMany({
        data: entries.map(([questionKey, answerJson]) => ({
          athleteId: params.athleteId,
          coachId: params.coachId,
          intakeResponseId: intakeResponse.id,
          questionKey,
          answerJson: answerJson as Prisma.InputJsonValue,
        })),
      });
    }

    return { intakeResponse, evidenceCreatedCount: entries.length };
  });

  return created;
}

export async function updateIntakeDraft(params: {
  coachId: string;
  athleteId: string;
  intakeResponseId: string;
  draftJson: unknown;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const existing = await prisma.athleteIntakeResponse.findUnique({
    where: { id: params.intakeResponseId },
    select: { id: true, athleteId: true, coachId: true, status: true },
  });

  if (!existing || existing.athleteId !== params.athleteId || existing.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Intake draft not found.');
  }

  if (existing.status !== 'DRAFT') {
    throw new ApiError(409, 'INTAKE_NOT_DRAFT', 'Only DRAFT intake responses can be edited.');
  }

  return prisma.athleteIntakeResponse.update({
    where: { id: existing.id },
    data: {
      draftJson: params.draftJson as Prisma.InputJsonValue,
    },
  });
}

export async function submitIntake(params: { coachId: string; athleteId: string; intakeResponseId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const response = await prisma.athleteIntakeResponse.findUnique({
    where: { id: params.intakeResponseId },
    select: { id: true, athleteId: true, coachId: true, status: true, draftJson: true },
  });

  if (!response || response.athleteId !== params.athleteId || response.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Intake response not found.');
  }

  if (response.status !== 'DRAFT') {
    throw new ApiError(409, 'INTAKE_ALREADY_SUBMITTED', 'This intake response has already been submitted.');
  }

  const draft = response.draftJson ?? {};
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new ApiError(400, 'INVALID_DRAFT', 'draftJson must be an object.');
  }

  const entries = Object.entries(draft as Record<string, unknown>);

  const submitted = await prisma.$transaction(async (tx) => {
    const updated = await tx.athleteIntakeResponse.update({
      where: { id: response.id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });

    if (entries.length > 0) {
      await tx.intakeEvidence.createMany({
        data: entries.map(([questionKey, answerJson]) => ({
          athleteId: params.athleteId,
          coachId: params.coachId,
          intakeResponseId: response.id,
          questionKey,
          answerJson: answerJson as Prisma.InputJsonValue,
        })),
      });
    }

    return updated;
  });

  return {
    intakeResponse: submitted,
    evidenceCreatedCount: entries.length,
  };
}

export async function listEvidenceForIntake(params: { coachId: string; athleteId: string; intakeResponseId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.intakeEvidence.findMany({
    where: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      intakeResponseId: params.intakeResponseId,
    },
    orderBy: [{ createdAt: 'asc' }, { questionKey: 'asc' }],
  });
}
