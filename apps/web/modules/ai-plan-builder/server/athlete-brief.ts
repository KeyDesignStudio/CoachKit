import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { computeStableSha256 } from '../rules/stable-hash';
import { athleteBriefSchema, type AthleteBriefJson, type AthleteIntakeSubmissionPayload } from '../rules/athlete-brief';
import { getAiPlanBuilderAIWithHooks } from '../ai/factory';
import { consumeLlmRateLimitOrThrow } from './llm-rate-limit';
import { recordAiInvocationAudit } from './ai-invocation-audit';

export async function getLatestAthleteBrief(params: { coachId: string; athleteId: string }) {
  return (prisma as any).athleteBrief.findFirst({
    where: { coachId: params.coachId, athleteId: params.athleteId },
    orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getLatestAthleteBriefJson(params: { coachId: string; athleteId: string }): Promise<AthleteBriefJson | null> {
  const row = await getLatestAthleteBrief(params);
  if (!row?.briefJson) return null;
  const parsed = athleteBriefSchema.safeParse(row.briefJson);
  return parsed.success ? parsed.data : null;
}

export async function ensureAthleteBrief(params: {
  coachId: string;
  athleteId: string;
  intake: AthleteIntakeSubmissionPayload;
}): Promise<{ brief: AthleteBriefJson; briefRowId: string; inputHash: string; aiMode: string }> {
  const profile = await prisma.athleteProfile.findUnique({
    where: { userId: params.athleteId },
    select: {
      disciplines: true,
      goalsText: true,
      trainingPlanFrequency: true,
      trainingPlanDayOfWeek: true,
      trainingPlanWeekOfMonth: true,
      coachNotes: true,
    },
  });

  const input = {
    intake: params.intake,
    profile: profile
      ? {
          disciplines: profile.disciplines ?? [],
          goalsText: profile.goalsText ?? null,
          trainingPlanFrequency: String(profile.trainingPlanFrequency ?? 'AD_HOC'),
          trainingPlanDayOfWeek: profile.trainingPlanDayOfWeek ?? null,
          trainingPlanWeekOfMonth: profile.trainingPlanWeekOfMonth ?? null,
          coachNotes: profile.coachNotes ?? null,
        }
      : null,
  };

  const inputHash = computeStableSha256(input);

  const existing = await (prisma as any).athleteBrief.findUnique({
    where: { athleteId_inputHash: { athleteId: params.athleteId, inputHash } },
  });

  if (existing) {
    const parsed = athleteBriefSchema.safeParse(existing.briefJson);
    if (!parsed.success) {
      throw new ApiError(500, 'INVALID_BRIEF', 'Stored Athlete Brief failed validation.');
    }
    return {
      brief: parsed.data,
      briefRowId: existing.id,
      inputHash,
      aiMode: existing.aiMode ?? 'unknown',
    };
  }

  let invocationMeta: { effectiveMode: 'deterministic' | 'llm'; fallbackUsed: boolean } | null = null;
  const ctx = {
    actorType: 'ATHLETE' as const,
    actorId: params.athleteId,
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
      });
    },
    onInvocation: async (meta) => {
      invocationMeta = meta as any;
      try {
        await recordAiInvocationAudit(meta, ctx);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('AI_INVOCATION_AUDIT_FAILED', {
          capability: meta.capability,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  const generated = await ai.generateAthleteBriefFromIntake(input as any);
  const parsed = athleteBriefSchema.safeParse((generated as any)?.brief);
  if (!parsed.success) {
    throw new ApiError(500, 'INVALID_BRIEF', 'Athlete Brief validation failed.');
  }

  const aiMode = (() => {
    const meta = invocationMeta as any;
    if (!meta) return 'unknown';
    if (meta.effectiveMode === 'deterministic') return 'deterministic_fallback';
    if (meta.effectiveMode === 'llm' && meta.fallbackUsed) return 'deterministic_fallback';
    if (meta.effectiveMode === 'llm') return 'llm';
    return String(meta.effectiveMode);
  })();

  const created = await (prisma as any).athleteBrief.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      generatedAt: new Date(),
      inputHash,
      aiMode,
      briefJson: parsed.data as unknown as Prisma.InputJsonValue,
    },
  });

  return { brief: parsed.data, briefRowId: created.id, inputHash, aiMode };
}
