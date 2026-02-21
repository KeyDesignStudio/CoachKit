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
import { evaluateDraftQualityGate } from '../rules/constraint-validator';
import { getAiPlanBuilderAIForCoachRequest } from './ai';
import { ensureAthleteBrief, getLatestAthleteBriefSummary, loadAthleteProfileSnapshot } from './athlete-brief';
import { mapWithConcurrency } from '@/lib/concurrency';
import { buildPlanReasoningV1 } from '@/lib/ai/plan-reasoning/buildPlanReasoningV1';
import { selectPlanSources } from '@/modules/plan-library/server/select';
import { applyPlanSourceToDraftInput } from '@/modules/plan-library/server/apply';
import { buildAdaptationMemorySummary } from './adaptation-memory';
import {
  buildDeterministicSessionDetailV1,
  normalizeSessionDetailV1DurationsToTotal,
  reflowSessionDetailV1ToNewTotal,
  sessionDetailV1Schema,
} from '../rules/session-detail';
import type { SessionDetailBlockType, SessionDetailV1 } from '../rules/session-detail';
import { getAiPlanBuilderCapabilitySpecVersion, getAiPlanBuilderEffectiveMode } from '../ai/config';
import { recordAiInvocationAudit } from './ai-invocation-audit';
import { buildEffectivePlanInputContext } from './effective-input';
import { refreshPolicyRuntimeOverridesFromDb } from './policy-tuning';

export const createDraftPlanSchema = z.object({
  planJson: z.unknown(),
});

export const draftPlanSetupV1Schema = z.object({
  weekStart: z.enum(['monday', 'sunday']).optional().default('monday'),
  // New (v1 UX): explicit plan start and completion dates.
  // Backward compatibility:
  // - `eventDate` is the legacy completion date key.
  // - `completionDate` is accepted as an alias.
  // - `startDate` may be absent for older drafts.
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  completionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Weeks are derived from dates unless overridden.
  weeksToEvent: z.number().int().min(1).max(52).optional(),
  weeksToEventOverride: z.number().int().min(1).max(52).optional(),
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
  requestContext: z
    .object({
      goalDetails: z.string().max(500).optional(),
      goalFocus: z.string().max(500).optional(),
      primaryDisciplineFocus: z.enum(['balanced', 'swim', 'bike', 'run']).optional(),
      eventName: z.string().max(500).optional(),
      eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      goalTimeline: z.string().max(120).optional(),
      weeklyMinutes: z.number().int().min(0).max(10_000).optional(),
      availabilityDays: z.array(z.string().max(16)).max(7).optional(),
      nonNegotiableDays: z.array(z.string().max(16)).max(7).optional(),
      preferredKeyDays: z.array(z.string().max(16)).max(7).optional(),
      dailyTimeWindows: z.record(z.string().max(16), z.enum(['any', 'am', 'midday', 'pm', 'evening'])).optional(),
      experienceLevel: z.string().max(120).optional(),
      injuryStatus: z.string().max(500).optional(),
      disciplineInjuryNotes: z.string().max(800).optional(),
      constraintsNotes: z.string().max(2_000).optional(),
      equipment: z.string().max(120).optional(),
      environmentTags: z.array(z.string().max(80)).max(8).optional(),
      fatigueState: z.enum(['fresh', 'normal', 'fatigued', 'cooked']).optional(),
      availableTimeMinutes: z.number().int().min(10).max(600).optional(),
    })
    .optional(),
  policyProfileId: z.enum(['coachkit-conservative-v1', 'coachkit-safe-v1', 'coachkit-performance-v1']).optional(),
  policyProfileVersion: z.literal('v1').optional(),
  programPolicy: z.enum(['COUCH_TO_5K', 'COUCH_TO_IRONMAN_26', 'HALF_TO_FULL_MARATHON']).optional(),
  selectedPlanSourceVersionIds: z.array(z.string().min(1)).max(4).optional(),
}).transform((raw) => {
  const eventDate = raw.eventDate ?? raw.completionDate;
  if (!eventDate) {
    throw new ApiError(400, 'INVALID_DRAFT_SETUP', 'Draft setup completionDate/eventDate must be YYYY-MM-DD.');
  }

  const weekStart = raw.weekStart ?? 'monday';

  const startDate = raw.startDate;
  const weeksDerived = (() => {
    if (!startDate) return undefined;
    // Derive based on week boundaries: week 1 begins at startDate's week boundary.
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${eventDate}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;

    const startJsDay = weekStart === 'sunday' ? 0 : 1;
    const startDiff = (start.getUTCDay() - startJsDay + 7) % 7;
    const startWeekStart = new Date(start);
    startWeekStart.setUTCDate(startWeekStart.getUTCDate() - startDiff);

    const endDiff = (end.getUTCDay() - startJsDay + 7) % 7;
    const endWeekStart = new Date(end);
    endWeekStart.setUTCDate(endWeekStart.getUTCDate() - endDiff);

    const diffDays = Math.floor((endWeekStart.getTime() - startWeekStart.getTime()) / (24 * 60 * 60 * 1000));
    const weeks = Math.floor(diffDays / 7) + 1;
    return Math.max(1, Math.min(52, weeks));
  })();

  const weeksToEvent = raw.weeksToEventOverride ?? raw.weeksToEvent ?? weeksDerived;
  if (!weeksToEvent) {
    throw new ApiError(400, 'INVALID_DRAFT_SETUP', 'Draft setup weeksToEvent is required (or provide startDate + completionDate).');
  }

  return {
    ...raw,
    weekStart,
    eventDate,
    weeksToEvent,
    selectedPlanSourceVersionIds: Array.isArray(raw.selectedPlanSourceVersionIds)
      ? Array.from(new Set(raw.selectedPlanSourceVersionIds.map((id) => id.trim()).filter(Boolean))).slice(0, 4)
      : [],
  };
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

function stripDurationTokens(value: string): string {
  return value
    .replace(/\(\s*\d+\s*min(?:s|utes)?\s*\)\.?/gi, '')
    .replace(/\b\d+\s*min(?:s|utes)?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function inferProgramPolicy(params: {
  guidanceText?: string | null;
  primaryGoal?: string | null;
  focus?: string | null;
  weeksToEvent?: number | null;
}) {
  const text = [params.guidanceText, params.primaryGoal, params.focus].filter(Boolean).join(' ').toLowerCase();
  const weeks = Number(params.weeksToEvent ?? 0) || 0;

  if (/couch\s*to\s*ironman|ironman/.test(text) || weeks >= 24) return 'COUCH_TO_IRONMAN_26' as const;
  if (/couch\s*to\s*5\s*k|\b5k\b/.test(text)) return 'COUCH_TO_5K' as const;
  if ((/half\s*marathon|\bhm\b/.test(text) && /marathon/.test(text)) || /half.*full|full.*half/.test(text)) {
    return 'HALF_TO_FULL_MARATHON' as const;
  }
  return undefined;
}

function applyRequestContextToSetup(params: { setup: any }) {
  const setup = { ...(params.setup ?? {}) };
  const requestContext = setup.requestContext && typeof setup.requestContext === 'object' ? setup.requestContext : null;
  if (!requestContext) return setup;

  const effects: string[] = [];
  const goalText = [requestContext.goalDetails, requestContext.goalFocus, requestContext.eventName].filter(Boolean).join(' ').toLowerCase();
  const injuryText = String(requestContext.injuryStatus ?? '').toLowerCase();
  const experienceText = String(requestContext.experienceLevel ?? '').toLowerCase();
  const constraintsText = String(requestContext.constraintsNotes ?? '').toLowerCase();

  if (
    requestContext.primaryDisciplineFocus === 'balanced' ||
    requestContext.primaryDisciplineFocus === 'swim' ||
    requestContext.primaryDisciplineFocus === 'bike' ||
    requestContext.primaryDisciplineFocus === 'run'
  ) {
    setup.disciplineEmphasis = requestContext.primaryDisciplineFocus;
    effects.push(`Primary discipline focus set to ${requestContext.primaryDisciplineFocus}.`);
  }

  if (goalText.includes('triathlon') || goalText.includes('ironman')) {
    setup.disciplineEmphasis = 'balanced';
    effects.push('Goal indicates multi-discipline event: emphasis set to Balanced.');
  } else if (goalText.includes('run') || goalText.includes('marathon') || goalText.includes('5k') || goalText.includes('10k')) {
    setup.disciplineEmphasis = 'run';
    effects.push('Goal indicates run-focused event: emphasis set to Run.');
  } else if (goalText.includes('bike') || goalText.includes('cycling')) {
    setup.disciplineEmphasis = 'bike';
    effects.push('Goal indicates bike-focused event: emphasis set to Bike.');
  } else if (goalText.includes('swim')) {
    setup.disciplineEmphasis = 'swim';
    effects.push('Goal indicates swim-focused event: emphasis set to Swim.');
  }

  if (/\bbeginner\b|\bnovice\b|\bcouch\b/.test(experienceText)) {
    setup.riskTolerance = 'low';
    setup.maxIntensityDaysPerWeek = 1;
    setup.maxDoublesPerWeek = 0;
    effects.push('Beginner profile: conservative load, no doubles, max 1 intensity day.');
  } else if (/\badvanced\b|\belite\b|\bexperienced\b/.test(experienceText) && setup.riskTolerance === 'low') {
    setup.riskTolerance = 'med';
    effects.push('Experienced profile: lifted risk tolerance to Moderate.');
  }

  if (/\binjury\b|\bpain\b|\bsplint\b|\bachilles\b|\bknee\b|\bcalf\b|\bhamstring\b/.test(injuryText)) {
    setup.riskTolerance = 'low';
    setup.maxIntensityDaysPerWeek = 1;
    setup.maxDoublesPerWeek = 0;
    effects.push('Injury/pain noted: intensity capped and doubles disabled.');
  }

  if (constraintsText.includes('travel') || constraintsText.includes('travell')) {
    effects.push('Travel constraints detected: overlapping travel weeks are reduced in volume and doubles blocked.');
  }
  if (Array.isArray(requestContext.nonNegotiableDays) && requestContext.nonNegotiableDays.length) {
    effects.push(`Non-negotiable off days set: ${requestContext.nonNegotiableDays.join(', ')}.`);
  }
  if (Array.isArray(requestContext.preferredKeyDays) && requestContext.preferredKeyDays.length) {
    effects.push(`Preferred key-session days set: ${requestContext.preferredKeyDays.join(', ')}.`);
  }
  if (requestContext.dailyTimeWindows && typeof requestContext.dailyTimeWindows === 'object') {
    const entries = Object.entries(requestContext.dailyTimeWindows as Record<string, string>)
      .filter(([, v]) => String(v).trim() && String(v) !== 'any')
      .map(([k, v]) => `${k}:${String(v).toUpperCase()}`);
    if (entries.length) effects.push(`Daily time windows captured (${entries.join(', ')}).`);
  }
  if (requestContext.equipment) effects.push(`Equipment context: ${requestContext.equipment}.`);
  if (Array.isArray(requestContext.environmentTags) && requestContext.environmentTags.length) {
    effects.push(`Environment factors: ${requestContext.environmentTags.join(', ')}.`);
  }
  if (requestContext.fatigueState) effects.push(`Readiness flag: ${requestContext.fatigueState}.`);
  if (requestContext.availableTimeMinutes) effects.push(`Typical session time available: ${requestContext.availableTimeMinutes} min.`);

  const guidanceParts = [
    setup.coachGuidanceText,
    requestContext.goalDetails ? `Goal: ${requestContext.goalDetails}` : null,
    requestContext.goalFocus ? `Focus: ${requestContext.goalFocus}` : null,
    requestContext.experienceLevel ? `Experience: ${requestContext.experienceLevel}` : null,
    requestContext.injuryStatus ? `Injury/Pain: ${requestContext.injuryStatus}` : null,
    requestContext.disciplineInjuryNotes ? `Discipline injury notes: ${requestContext.disciplineInjuryNotes}` : null,
    requestContext.constraintsNotes ? `Constraints: ${requestContext.constraintsNotes}` : null,
    requestContext.equipment ? `Equipment: ${requestContext.equipment}` : null,
    Array.isArray(requestContext.environmentTags) && requestContext.environmentTags.length
      ? `Environment: ${requestContext.environmentTags.join(', ')}`
      : null,
    requestContext.fatigueState ? `Readiness: ${requestContext.fatigueState}` : null,
    requestContext.availableTimeMinutes ? `Typical session time: ${requestContext.availableTimeMinutes} min` : null,
    Array.isArray(requestContext.nonNegotiableDays) && requestContext.nonNegotiableDays.length
      ? `Non-negotiable off days: ${requestContext.nonNegotiableDays.join(', ')}`
      : null,
    Array.isArray(requestContext.preferredKeyDays) && requestContext.preferredKeyDays.length
      ? `Preferred key days: ${requestContext.preferredKeyDays.join(', ')}`
      : null,
  ].filter(Boolean);
  setup.coachGuidanceText = Array.from(new Set(guidanceParts.map((s) => String(s)))).join('\n');

  setup.requestContextApplied = {
    goalDetails: requestContext.goalDetails ?? null,
    goalFocus: requestContext.goalFocus ?? null,
    primaryDisciplineFocus: requestContext.primaryDisciplineFocus ?? null,
    eventName: requestContext.eventName ?? null,
    eventDate: requestContext.eventDate ?? null,
    goalTimeline: requestContext.goalTimeline ?? null,
    weeklyMinutes: requestContext.weeklyMinutes ?? null,
    availabilityDays: requestContext.availabilityDays ?? [],
    nonNegotiableDays: requestContext.nonNegotiableDays ?? [],
    preferredKeyDays: requestContext.preferredKeyDays ?? [],
    dailyTimeWindows: requestContext.dailyTimeWindows ?? {},
    experienceLevel: requestContext.experienceLevel ?? null,
    injuryStatus: requestContext.injuryStatus ?? null,
    disciplineInjuryNotes: requestContext.disciplineInjuryNotes ?? null,
    constraintsNotes: requestContext.constraintsNotes ?? null,
    equipment: requestContext.equipment ?? null,
    environmentTags: requestContext.environmentTags ?? [],
    fatigueState: requestContext.fatigueState ?? null,
    availableTimeMinutes: requestContext.availableTimeMinutes ?? null,
    effects,
  };

  return setup;
}

function normalizeWeight(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return score;
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number | null {
  const usable = values.filter((v) => Number.isFinite(v.value) && Number.isFinite(v.weight) && v.weight > 0);
  if (!usable.length) return null;
  const totalWeight = usable.reduce((sum, v) => sum + v.weight, 0);
  if (!totalWeight) return null;
  return usable.reduce((sum, v) => sum + v.value * v.weight, 0) / totalWeight;
}

function weightedDistribution(
  values: Array<{ value: Record<string, number> | null | undefined; weight: number }>
): Record<string, number> | undefined {
  const sums: Record<string, number> = {};
  let total = 0;
  for (const row of values) {
    if (!row.value || !Number.isFinite(row.weight) || row.weight <= 0) continue;
    for (const [k, v] of Object.entries(row.value)) {
      if (!Number.isFinite(v) || v <= 0) continue;
      sums[k] = (sums[k] ?? 0) + v * row.weight;
      total += v * row.weight;
    }
  }
  if (!total) return undefined;
  const normalized: Record<string, number> = {};
  for (const [k, v] of Object.entries(sums)) normalized[k] = Number((v / total).toFixed(3));
  return normalized;
}

function blendAppliedPlanSources(params: {
  baseSetup: any;
  applied: Array<{ weight: number; adjustedSetup: any; influenceSummary: any }>;
}) {
  if (!params.applied.length) {
    return {
      adjustedSetup: params.baseSetup,
      influenceSummary: { confidence: 'low', notes: [], appliedRules: [] as string[] },
    };
  }

  const longDayScores = new Map<number, number>();
  for (const row of params.applied) {
    const d = row.adjustedSetup?.longSessionDay;
    if (!Number.isInteger(d)) continue;
    longDayScores.set(Number(d), (longDayScores.get(Number(d)) ?? 0) + row.weight);
  }

  const weeklyByIndex = new Map<number, Array<{ value: number; weight: number }>>();
  for (const row of params.applied) {
    const wk = Array.isArray(row.adjustedSetup?.weeklyMinutesByWeek) ? row.adjustedSetup.weeklyMinutesByWeek : [];
    wk.forEach((v: unknown, idx: number) => {
      if (!Number.isFinite(Number(v))) return;
      const bucket = weeklyByIndex.get(idx) ?? [];
      bucket.push({ value: Number(v), weight: row.weight });
      weeklyByIndex.set(idx, bucket);
    });
  }

  const weeklyMinutesByWeek = Array.from(weeklyByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, values]) => Math.max(0, Math.round(weightedAverage(values) ?? 0)));

  const maxIntensityDaysPerWeek = weightedAverage(
    params.applied.map((row) => ({ value: Number(row.adjustedSetup?.maxIntensityDaysPerWeek ?? 0), weight: row.weight }))
  );
  const sessionsPerWeekOverride = weightedAverage(
    params.applied.map((row) => ({ value: Number(row.adjustedSetup?.sessionsPerWeekOverride ?? 0), weight: row.weight }))
  );
  const recoveryEveryNWeeks = weightedAverage(
    params.applied.map((row) => ({ value: Number(row.adjustedSetup?.recoveryEveryNWeeks ?? 0), weight: row.weight }))
  );
  const recoveryWeekMultiplier = weightedAverage(
    params.applied.map((row) => ({ value: Number(row.adjustedSetup?.recoveryWeekMultiplier ?? 0), weight: row.weight }))
  );

  const disciplineSplitTargets = weightedDistribution(
    params.applied.map((row) => ({ value: row.adjustedSetup?.disciplineSplitTargets ?? null, weight: row.weight }))
  );
  const sessionTypeDistribution = weightedDistribution(
    params.applied.map((row) => ({ value: row.adjustedSetup?.sessionTypeDistribution ?? null, weight: row.weight }))
  );

  const confidenceScore = weightedAverage(
    params.applied.map((row) => ({
      value:
        row.influenceSummary?.confidence === 'high' ? 3 : row.influenceSummary?.confidence === 'med' ? 2 : row.influenceSummary?.confidence === 'low' ? 1 : 0,
      weight: row.weight,
    }))
  );
  const confidence: 'low' | 'med' | 'high' = confidenceScore && confidenceScore >= 2.4 ? 'high' : confidenceScore && confidenceScore >= 1.6 ? 'med' : 'low';
  const notes = params.applied.flatMap((row) => (Array.isArray(row.influenceSummary?.notes) ? row.influenceSummary.notes : [])).slice(0, 6);
  const appliedRules = Array.from(
    new Set(params.applied.flatMap((row) => (Array.isArray(row.influenceSummary?.appliedRules) ? row.influenceSummary.appliedRules : [])))
  );

  return {
    adjustedSetup: {
      ...params.baseSetup,
      ...(disciplineSplitTargets ? { disciplineSplitTargets } : {}),
      ...(sessionTypeDistribution ? { sessionTypeDistribution } : {}),
      ...(weeklyMinutesByWeek.length ? { weeklyMinutesByWeek } : {}),
      ...(maxIntensityDaysPerWeek != null ? { maxIntensityDaysPerWeek: Math.max(1, Math.min(3, Math.round(maxIntensityDaysPerWeek))) } : {}),
      ...(sessionsPerWeekOverride != null ? { sessionsPerWeekOverride: Math.max(3, Math.min(10, Math.round(sessionsPerWeekOverride))) } : {}),
      ...(recoveryEveryNWeeks != null ? { recoveryEveryNWeeks: Math.max(2, Math.min(8, Math.round(recoveryEveryNWeeks))) } : {}),
      ...(recoveryWeekMultiplier != null ? { recoveryWeekMultiplier: Number(Math.max(0.5, Math.min(0.95, recoveryWeekMultiplier)).toFixed(2)) } : {}),
      ...(longDayScores.size
        ? {
            longSessionDay: Array.from(longDayScores.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? params.baseSetup.longSessionDay,
          }
        : {}),
    },
    influenceSummary: {
      confidence,
      notes,
      appliedRules,
      archetype: `${params.applied.length}-source blend`,
    },
  };
}

function applyAdaptationMemoryToSetup(params: { setup: any; memory: Awaited<ReturnType<typeof buildAdaptationMemorySummary>> }) {
  const setup = { ...(params.setup ?? {}) };
  const memory = params.memory;
  if (!memory || memory.sampleSize <= 0) return setup;

  setup.maxIntensityDaysPerWeek = Math.max(
    1,
    Math.min(3, Number(setup.maxIntensityDaysPerWeek ?? 1) + Number(memory.recommendedMaxIntensityDaysPerWeekDelta ?? 0))
  );

  if (typeof setup.sessionsPerWeekOverride === 'number' && Number.isFinite(setup.sessionsPerWeekOverride)) {
    setup.sessionsPerWeekOverride = Math.max(
      3,
      Math.min(10, Math.round(setup.sessionsPerWeekOverride + Number(memory.recommendedSessionsPerWeekDelta ?? 0)))
    );
  }

  if (Array.isArray(setup.weeklyMinutesByWeek) && setup.weeklyMinutesByWeek.length) {
    setup.weeklyMinutesByWeek = setup.weeklyMinutesByWeek.map((v: unknown) =>
      Math.max(45, Math.round(Number(v || 0) * Number(memory.recommendedWeeklyMinutesMultiplier || 1)))
    );
  } else if (typeof setup.weeklyAvailabilityMinutes === 'number' && Number.isFinite(setup.weeklyAvailabilityMinutes)) {
    setup.weeklyAvailabilityMinutes = Math.max(
      60,
      Math.round(setup.weeklyAvailabilityMinutes * Number(memory.recommendedWeeklyMinutesMultiplier || 1))
    );
  }

  if (typeof memory.recommendedRecoveryEveryNWeeks === 'number' && Number.isFinite(memory.recommendedRecoveryEveryNWeeks)) {
    setup.recoveryEveryNWeeks = memory.recommendedRecoveryEveryNWeeks;
    if (setup.recoveryWeekMultiplier == null) {
      setup.recoveryWeekMultiplier = memory.recommendedWeeklyMinutesMultiplier < 1 ? 0.78 : 0.84;
    }
  }

  return setup;
}

function enforceCoachHardConstraints(params: { baseSetup: any; adjustedSetup: any }) {
  const base = params.baseSetup ?? {};
  const adjusted = { ...(params.adjustedSetup ?? {}) };

  const requestedDays: number[] = Array.isArray(base.weeklyAvailabilityDays)
    ? Array.from(
        new Set<number>(
          base.weeklyAvailabilityDays
            .map((d: unknown) => Number(d))
            .filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)
        )
      ).sort((a: number, b: number) => a - b)
    : [];

  if (requestedDays.length) {
    adjusted.weeklyAvailabilityDays = requestedDays;
  }

  if (typeof base.maxDoublesPerWeek === 'number' && Number.isFinite(base.maxDoublesPerWeek)) {
    adjusted.maxDoublesPerWeek = Math.max(0, Math.min(3, Math.round(base.maxDoublesPerWeek)));
  }

  if (typeof base.maxIntensityDaysPerWeek === 'number' && Number.isFinite(base.maxIntensityDaysPerWeek)) {
    adjusted.maxIntensityDaysPerWeek = Math.max(1, Math.min(3, Math.round(base.maxIntensityDaysPerWeek)));
  }

  if (typeof base.weeklyAvailabilityMinutes === 'number' && Number.isFinite(base.weeklyAvailabilityMinutes)) {
    adjusted.weeklyAvailabilityMinutes = Math.max(0, Math.round(base.weeklyAvailabilityMinutes));
  } else if (base.weeklyAvailabilityMinutes && typeof base.weeklyAvailabilityMinutes === 'object') {
    adjusted.weeklyAvailabilityMinutes = base.weeklyAvailabilityMinutes;
  }
  const coachWeeklyBudget: number = (() => {
    if (typeof adjusted.weeklyAvailabilityMinutes === 'number' && Number.isFinite(adjusted.weeklyAvailabilityMinutes)) {
      return Math.max(0, Math.round(adjusted.weeklyAvailabilityMinutes));
    }
    if (adjusted.weeklyAvailabilityMinutes && typeof adjusted.weeklyAvailabilityMinutes === 'object') {
      return Object.values(adjusted.weeklyAvailabilityMinutes as Record<string, unknown>).reduce<number>((sum, value) => {
        const n = Number(value);
        return sum + (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
      }, 0);
    }
    return 0;
  })();
  if (Array.isArray(adjusted.weeklyMinutesByWeek) && adjusted.weeklyMinutesByWeek.length && coachWeeklyBudget > 0) {
    // Keep source/policy influence, but never let expected weekly targets drift far beyond coach-requested budget.
    const maxTarget = Math.max(60, Math.round(coachWeeklyBudget * 1.15));
    adjusted.weeklyMinutesByWeek = adjusted.weeklyMinutesByWeek.map((value: unknown) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return 60;
      return Math.max(45, Math.min(maxTarget, Math.round(n)));
    });
  }

  if (typeof base.weeksToEvent === 'number' && Number.isFinite(base.weeksToEvent)) {
    adjusted.weeksToEvent = Math.max(1, Math.min(52, Math.round(base.weeksToEvent)));
  }
  if (typeof base.weeksToEventOverride === 'number' && Number.isFinite(base.weeksToEventOverride)) {
    adjusted.weeksToEventOverride = Math.max(1, Math.min(52, Math.round(base.weeksToEventOverride)));
  }
  if (typeof base.eventDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(base.eventDate)) {
    adjusted.eventDate = base.eventDate;
  }
  if (typeof base.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(base.startDate)) {
    adjusted.startDate = base.startDate;
  }
  if (typeof base.weekStart === 'string' && (base.weekStart === 'monday' || base.weekStart === 'sunday')) {
    adjusted.weekStart = base.weekStart;
  }

  return adjusted;
}

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
  setup: unknown;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);
  await refreshPolicyRuntimeOverridesFromDb();

  const parsedSetup = draftPlanSetupV1Schema.parse(params.setup);
  const setup = applyRequestContextToSetup({
    setup: {
    ...parsedSetup,
    weekStart: parsedSetup.weekStart ?? 'monday',
    coachGuidanceText: parsedSetup.coachGuidanceText ?? '',
    },
  });

  const ai = getAiPlanBuilderAIForCoachRequest({ coachId: params.coachId, athleteId: params.athleteId });
  const ensured = await ensureAthleteBrief({ coachId: params.coachId, athleteId: params.athleteId });
  const effectiveInput = await buildEffectivePlanInputContext({
    coachId: params.coachId,
    athleteId: params.athleteId,
  });
  const athleteProfile = {
    ...(effectiveInput.athleteProfileSnapshot ?? ({} as any)),
    ...effectiveInput.mergedSignals,
  } as any;

  if (!setup.coachGuidanceText && athleteProfile?.primaryGoal) {
    const bits = [athleteProfile.primaryGoal, athleteProfile.focus, athleteProfile.timelineWeeks ? `${athleteProfile.timelineWeeks} weeks` : null]
      .filter(Boolean)
      .join(' · ');
    setup.coachGuidanceText = bits;
  }

  setup.programPolicy =
    setup.programPolicy ??
    inferProgramPolicy({
      guidanceText: setup.coachGuidanceText,
      primaryGoal: athleteProfile?.primaryGoal,
      focus: athleteProfile?.focus,
      weeksToEvent: setup.weeksToEvent,
    });

  const planSourceMatches = await selectPlanSources({
    athleteProfile: athleteProfile as any,
    durationWeeks: setup.weeksToEvent,
    queryText: [setup.coachGuidanceText, athleteProfile?.primaryGoal, athleteProfile?.focus].filter(Boolean).join(' · '),
    coachId: params.coachId,
  });
  type PlanSourceMatch = {
    planSourceVersionId: string;
    planSourceId: string;
    title: string;
    score: number;
    semanticScore: number;
    metadataScore: number;
    reasons: string[];
  };
  const planSourceMatchesNormalized: PlanSourceMatch[] = planSourceMatches.map((m) => ({
    planSourceVersionId: m.planSourceVersionId,
    planSourceId: m.planSourceId,
    title: m.title,
    score: m.score,
    semanticScore: m.semanticScore,
    metadataScore: m.metadataScore,
    reasons: [...m.reasons],
  }));

  const selectedPlanSourceVersionIdsRaw: unknown[] = Array.isArray(setup.selectedPlanSourceVersionIds) ? setup.selectedPlanSourceVersionIds : [];
  const requestedVersionIds: string[] = selectedPlanSourceVersionIdsRaw
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .slice(0, 4)
    .map((id) => id.trim())
    .filter(Boolean);
  const selectedMatches: PlanSourceMatch[] =
    requestedVersionIds.length > 0
      ? requestedVersionIds
          .map((id: string) => planSourceMatchesNormalized.find((m: PlanSourceMatch) => m.planSourceVersionId === id) ?? null)
          .filter((m): m is PlanSourceMatch => m != null)
      : planSourceMatchesNormalized.slice(0, 4);
  const selectedVersionIds: string[] =
    requestedVersionIds.length > 0 ? requestedVersionIds : selectedMatches.map((m: PlanSourceMatch) => m.planSourceVersionId);
  const selectedPlanSources = selectedVersionIds.length
    ? await prisma.planSourceVersion.findMany({
        where: { id: { in: selectedVersionIds }, planSource: { isActive: true } },
        include: {
          planSource: {
            select: {
              id: true,
              title: true,
              distance: true,
              level: true,
              durationWeeks: true,
              checksumSha256: true,
            },
          },
          weeks: { select: { totalMinutes: true, sessions: true } },
          rules: true,
        },
      })
    : [];
  const selectedPlanSourcesOrdered = selectedVersionIds
    .map((id: string) => selectedPlanSources.find((row) => row.id === id) ?? null)
    .filter(Boolean) as typeof selectedPlanSources;

  const sourceById = new Map(selectedPlanSourcesOrdered.map((s) => [s.id, s]));
  const effectiveSelectedMatches: PlanSourceMatch[] =
    requestedVersionIds.length > 0
      ? selectedPlanSourcesOrdered.map((source) => {
          const existing = selectedMatches.find((m: PlanSourceMatch) => m.planSourceVersionId === source.id);
          if (existing) return existing;
          return {
            planSourceVersionId: source.id,
            planSourceId: source.planSource.id,
            title: source.planSource.title,
            score: 99,
            semanticScore: 0,
            metadataScore: 0,
            reasons: ['coach selected'],
          };
        })
      : selectedMatches;
  const appliedBySource = effectiveSelectedMatches
    .map((match: PlanSourceMatch) => {
      const source = sourceById.get(match.planSourceVersionId);
      if (!source) return null;
      const selectedPlanSourceForApply = {
        ...source,
        sessions: source.weeks.flatMap((w) => w.sessions ?? []),
      };
      const applied = applyPlanSourceToDraftInput({
        athleteProfile: athleteProfile as any,
        athleteBrief: ensured.brief ?? null,
        apbSetup: setup as any,
        baseDraftInput: setup as any,
        selectedPlanSource: selectedPlanSourceForApply as any,
      });
      return {
        match,
        source,
        weight: normalizeWeight(match.score),
        adjustedSetup: applied.adjustedDraftInput as any,
        influenceSummary: applied.influenceSummary,
        ruleBundle: applied.ruleBundle,
      };
    })
    .filter(Boolean) as Array<{
    match: (typeof selectedMatches)[number];
    source: (typeof selectedPlanSources)[number];
    weight: number;
    adjustedSetup: any;
    influenceSummary: any;
    ruleBundle: any;
  }>;

  const blended = blendAppliedPlanSources({
    baseSetup: setup as any,
    applied: appliedBySource.map((row) => ({
      weight: row.weight || 1,
      adjustedSetup: row.adjustedSetup,
      influenceSummary: row.influenceSummary,
    })),
  });
  const adaptationMemory = await buildAdaptationMemorySummary({
    coachId: params.coachId,
    athleteId: params.athleteId,
  });
  const adaptedSetup = applyAdaptationMemoryToSetup({
    setup: blended.adjustedSetup as any,
    memory: adaptationMemory,
  }) as any;
  const adjustedSetup = enforceCoachHardConstraints({
    baseSetup: setup as any,
    adjustedSetup: adaptedSetup,
  }) as any;
  adjustedSetup.effectiveInputV1 = {
    generatedAt: new Date().toISOString(),
    preflight: effectiveInput.preflight,
    mergedSignals: effectiveInput.mergedSignals,
    conflicts: effectiveInput.conflicts,
  };
  const primarySelected = appliedBySource[0] ?? null;

  const suggestion = await ai.suggestDraftPlan({
    setup: adjustedSetup,
    athleteProfile: athleteProfile as any,
    athleteBrief: ensured.brief ?? null,
  });
  const draftRaw: DraftPlanV1 = normalizeDraftPlanJsonDurations({ setup: adjustedSetup, planJson: suggestion.planJson });
  const aiReturnedSetup = ((draftRaw as any)?.setup ?? adjustedSetup) as any;
  const effectiveSetupForValidation = enforceCoachHardConstraints({
    baseSetup: setup as any,
    adjustedSetup: aiReturnedSetup,
  }) as any;
  const draft: DraftPlanV1 = {
    ...(draftRaw as any),
    setup: effectiveSetupForValidation,
  } as DraftPlanV1;
  const qualityGate = evaluateDraftQualityGate({
    setup: effectiveSetupForValidation,
    draft,
  });
  if (qualityGate.hardViolations.length) {
    throw new ApiError(400, 'PLAN_CONSTRAINT_VIOLATION', 'Draft plan violates hard planning constraints.', {
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
  (effectiveSetupForValidation as any).qualityGate = {
    score: qualityGate.score,
    policyProfileId: qualityGate.profileId,
    policyProfileVersion: qualityGate.profileVersion,
    hardViolationCount: qualityGate.hardViolations.length,
    softWarningCount: qualityGate.softWarnings.length,
    softWarnings: qualityGate.softWarnings.slice(0, 20),
    generatedAt: new Date().toISOString(),
  };
  const setupHash = computeStableSha256(effectiveSetupForValidation);
  const planSourceMatchesForReasoning =
    requestedVersionIds.length > 0
      ? [
          ...effectiveSelectedMatches,
          ...planSourceMatchesNormalized.filter(
            (m: PlanSourceMatch) => !effectiveSelectedMatches.some((sel: PlanSourceMatch) => sel.planSourceVersionId === m.planSourceVersionId)
          ),
        ].slice(0, 6)
      : planSourceMatchesNormalized;
  const reasoning = buildPlanReasoningV1({
    athleteProfile: athleteProfile as any,
    setup: effectiveSetupForValidation,
    draftPlanJson: draft as any,
    planSources: planSourceMatchesForReasoning,
    planSourceInfluence: blended.influenceSummary,
  });

  const created = await prisma.aiPlanDraft.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      source: 'AI_DRAFT',
      status: 'DRAFT',
      planJson: draft as unknown as Prisma.InputJsonValue,
      setupJson: effectiveSetupForValidation as unknown as Prisma.InputJsonValue,
      setupHash,
      reasoningJson: reasoning as unknown as Prisma.InputJsonValue,
      planSourceSelectionJson: {
        selectedPlanSourceVersionIds: effectiveSelectedMatches.map((m: PlanSourceMatch) => m.planSourceVersionId),
        selectedPlanSource: primarySelected
          ? {
              planSourceId: primarySelected.source.planSource.id,
              planSourceVersionId: primarySelected.source.id,
              planSourceVersion: primarySelected.source.version,
              title: primarySelected.source.planSource.title,
              checksumSha256: primarySelected.source.planSource.checksumSha256,
              archetype: primarySelected.ruleBundle?.planArchetype ?? null,
            }
          : null,
        selectedPlanSources: appliedBySource.map((row) => ({
          planSourceId: row.source.planSource.id,
          planSourceVersionId: row.source.id,
          planSourceVersion: row.source.version,
          title: row.source.planSource.title,
          checksumSha256: row.source.planSource.checksumSha256,
          score: row.match.score,
          semanticScore: row.match.semanticScore,
          metadataScore: row.match.metadataScore,
          reasons: row.match.reasons,
        })),
        matchScores: planSourceMatchesForReasoning.map((m: PlanSourceMatch) => ({
          planSourceVersionId: m.planSourceVersionId,
          planSourceId: m.planSourceId,
          title: m.title,
          score: m.score,
          semanticScore: m.semanticScore,
          metadataScore: m.metadataScore,
          reasons: m.reasons,
        })),
        influenceSummary: blended.influenceSummary,
        adaptationMemory,
      } as unknown as Prisma.InputJsonValue,
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

  // Fire-and-forget enrichment so draft generation latency is not blocked by per-session detail calls.
  // NOTE: session details are also lazily generated on demand via API.
  void generateSessionDetailsForDraftPlan({
    coachId: params.coachId,
    athleteId: params.athleteId,
    draftPlanId: created.id,
    limit: 12,
  }).catch(() => {});

  return created;
}

export async function listReferencePlansForAthlete(params: { coachId: string; athleteId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const athleteProfile =
    (await loadAthleteProfileSnapshot({ coachId: params.coachId, athleteId: params.athleteId })) ?? ({} as any);
  const matches = await selectPlanSources({
    athleteProfile: athleteProfile as any,
    durationWeeks: Number(athleteProfile?.timelineWeeks ?? 12) || 12,
    queryText: [athleteProfile?.primaryGoal, athleteProfile?.focus].filter(Boolean).join(' · '),
    coachId: params.coachId,
  });
  const recommendedMap = new Map(matches.map((m) => [m.planSourceVersionId, m]));

  const versions = await prisma.planSourceVersion.findMany({
    where: { planSource: { isActive: true } },
    include: {
      planSource: {
        select: {
          id: true,
          title: true,
          sport: true,
          distance: true,
          level: true,
          durationWeeks: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 80,
  });

  return versions.map((v) => {
    const rec = recommendedMap.get(v.id);
    return {
      planSourceVersionId: v.id,
      planSourceId: v.planSource.id,
      title: v.planSource.title,
      sport: v.planSource.sport,
      distance: v.planSource.distance,
      level: v.planSource.level,
      durationWeeks: v.planSource.durationWeeks,
      recommended: Boolean(rec),
      score: rec?.score ?? null,
      reasons: rec?.reasons ?? [],
    };
  });
}

async function getAthleteSummaryTextForSessionDetail(params: { coachId: string; athleteId: string; setup: any }) {
  const ensured = await ensureAthleteBrief({ coachId: params.coachId, athleteId: params.athleteId });
  if (ensured.summaryText) return ensured.summaryText;
  const summary = await getLatestAthleteBriefSummary({ coachId: params.coachId, athleteId: params.athleteId });
  return summary ?? '';
}

export async function generateSessionDetailsForDraftPlan(params: {
  coachId: string;
  athleteId: string;
  draftPlanId: string;
  onlySessionIds?: string[];
  limit?: number;
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
        where: params.onlySessionIds?.length ? { id: { in: params.onlySessionIds } } : undefined,
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
  const ensured = await ensureAthleteBrief({ coachId: params.coachId, athleteId: params.athleteId });
  const athleteBrief = ensured.brief ?? null;
  const athleteProfile =
    (await loadAthleteProfileSnapshot({ coachId: params.coachId, athleteId: params.athleteId })) ?? ({} as any);
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
  const requestContext = setup?.requestContext && typeof setup.requestContext === 'object' ? (setup.requestContext as Record<string, unknown>) : null;
  const guidanceText = String(setup?.coachGuidanceText ?? '').toLowerCase();
  const environmentTags: string[] = [];
  if (guidanceText.includes('heat') || guidanceText.includes('humid')) environmentTags.push('heat');
  if (guidanceText.includes('hill') || guidanceText.includes('climb')) environmentTags.push('hills');
  if (guidanceText.includes('wind')) environmentTags.push('wind');
  const contextForDetails = {
    availableTimeMinutes: Number(requestContext?.weeklyMinutes ?? 0) || undefined,
    equipment: typeof requestContext?.equipment === 'string' ? String(requestContext.equipment) : undefined,
    environmentTags,
    fatigueState:
      typeof requestContext?.fatigueState === 'string'
        ? String(requestContext.fatigueState)
        : guidanceText.includes('cooked') || guidanceText.includes('fatigue')
          ? 'fatigued'
          : 'normal',
  };

  const ai = getAiPlanBuilderAIForCoachRequest({ coachId: params.coachId, athleteId: params.athleteId });
  const effectiveMode = getAiPlanBuilderEffectiveMode('generateSessionDetail');
  const now = new Date();

  const selectedSessions = params.limit && params.limit > 0 ? draft.sessions.slice(0, params.limit) : draft.sessions;

  await mapWithConcurrency(selectedSessions, 4, async (s) => {
    // Coach edits are authoritative; never overwrite them during background enrichment.
    if (String((s as any)?.detailMode || '') === 'coach') return;

    const input = {
      athleteSummaryText,
      athleteProfile,
      athleteBrief,
      constraints: {
        riskTolerance: setup?.riskTolerance,
        maxIntensityDaysPerWeek: setup?.maxIntensityDaysPerWeek,
        longSessionDay: setup?.longSessionDay ?? null,
        weeklyMinutesTarget,
        nonNegotiableDays: Array.isArray(requestContext?.nonNegotiableDays) ? (requestContext.nonNegotiableDays as string[]) : undefined,
        preferredKeyDays: Array.isArray(requestContext?.preferredKeyDays) ? (requestContext.preferredKeyDays as string[]) : undefined,
        dailyTimeWindows:
          requestContext?.dailyTimeWindows && typeof requestContext.dailyTimeWindows === 'object'
            ? (requestContext.dailyTimeWindows as Record<string, 'any' | 'am' | 'midday' | 'pm' | 'evening'>)
            : undefined,
        equipment: typeof requestContext?.equipment === 'string' ? requestContext.equipment : undefined,
        environmentTags: environmentTags.length ? environmentTags : undefined,
        fatigueState: contextForDetails.fatigueState as 'fresh' | 'normal' | 'fatigued' | 'cooked' | undefined,
        availableTimeMinutes: Number(requestContext?.availableTimeMinutes ?? 0) || undefined,
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
            context: {
              ...contextForDetails,
              weekIndex: Number(s.weekIndex ?? 0),
              dayOfWeek: Number(s.dayOfWeek ?? 0),
              sessionOrdinal: Number(s.ordinal ?? 0),
            },
          });

      const candidateDetail = normalizeSessionDetailV1DurationsToTotal({ detail: baseDetail, totalMinutes: s.durationMinutes });
      const validatedCandidate = sessionDetailV1Schema.safeParse(candidateDetail);
      const detail = validatedCandidate.success
        ? validatedCandidate.data
        : normalizeSessionDetailV1DurationsToTotal({
          detail: buildDeterministicSessionDetailV1({
              discipline: s.discipline as any,
              type: s.type,
              durationMinutes: s.durationMinutes,
              context: {
                ...contextForDetails,
                weekIndex: Number(s.weekIndex ?? 0),
                dayOfWeek: Number(s.dayOfWeek ?? 0),
                sessionOrdinal: Number(s.ordinal ?? 0),
              },
            }),
            totalMinutes: s.durationMinutes,
          });

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
        context: {
          ...contextForDetails,
          weekIndex: Number(s.weekIndex ?? 0),
          dayOfWeek: Number(s.dayOfWeek ?? 0),
          sessionOrdinal: Number(s.ordinal ?? 0),
        },
      });

      const candidateDetail = normalizeSessionDetailV1DurationsToTotal({ detail: baseDetail, totalMinutes: s.durationMinutes });
      const validatedCandidate = sessionDetailV1Schema.safeParse(candidateDetail);
      const detail = validatedCandidate.success
        ? validatedCandidate.data
        : normalizeSessionDetailV1DurationsToTotal({
            detail: buildDeterministicSessionDetailV1({
              discipline: s.discipline as any,
              type: s.type,
              durationMinutes: s.durationMinutes,
              context: {
                ...contextForDetails,
                weekIndex: Number(s.weekIndex ?? 0),
                dayOfWeek: Number(s.dayOfWeek ?? 0),
                sessionOrdinal: Number(s.ordinal ?? 0),
              },
            }),
            totalMinutes: s.durationMinutes,
          });

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


export async function getLatestAiDraftPlan(params: {
  coachId: string;
  athleteId: string;
  includeDetails?: boolean;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.aiPlanDraft.findFirst({
    where: { athleteId: params.athleteId, coachId: params.coachId },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      athleteId: true,
      coachId: true,
      source: true,
      status: true,
      visibilityStatus: true,
      publishedAt: true,
      publishedByCoachId: true,
      lastPublishedHash: true,
      lastPublishedSummaryText: true,
      setupJson: true,
      setupHash: true,
      planJson: true,
      reasoningJson: true,
      planSourceSelectionJson: true,
      createdAt: true,
      updatedAt: true,
      weeks: { orderBy: [{ weekIndex: 'asc' }] },
      sessions: {
        orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
        select: {
          id: true,
          draftId: true,
          weekIndex: true,
          ordinal: true,
          dayOfWeek: true,
          discipline: true,
          type: true,
          durationMinutes: true,
          notes: true,
          locked: true,
          detailMode: true,
          detailGeneratedAt: true,
          ...(params.includeDetails
            ? {
                detailJson: true,
                detailInputHash: true,
              }
            : {}),
        },
      },
    },
  });
}

export async function getOrGenerateDraftSessionDetail(params: {
  coachId: string;
  athleteId: string;
  draftPlanId: string;
  sessionId: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const session = await prisma.aiPlanDraftSession.findUnique({
    where: { id: params.sessionId },
    select: {
      id: true,
      draftId: true,
      detailJson: true,
      detailMode: true,
      detailGeneratedAt: true,
    },
  });

  if (!session || session.draftId !== params.draftPlanId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft session not found.');
  }

  if (session.detailJson) {
    return {
      detail: session.detailJson,
      detailMode: session.detailMode ?? null,
      detailGeneratedAt: session.detailGeneratedAt ?? null,
      generatedNow: false,
    };
  }

  await generateSessionDetailsForDraftPlan({
    coachId: params.coachId,
    athleteId: params.athleteId,
    draftPlanId: params.draftPlanId,
    onlySessionIds: [params.sessionId],
    limit: 1,
  });

  const refreshed = await prisma.aiPlanDraftSession.findUnique({
    where: { id: params.sessionId },
    select: {
      detailJson: true,
      detailMode: true,
      detailGeneratedAt: true,
    },
  });

  return {
    detail: refreshed?.detailJson ?? null,
    detailMode: refreshed?.detailMode ?? null,
    detailGeneratedAt: refreshed?.detailGeneratedAt ?? null,
    generatedNow: true,
  };
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
            dayOfWeek: true,
            ordinal: true,
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
          const detailContext = {
            weekIndex: Number(existing.weekIndex ?? 0),
            dayOfWeek: Number(existing.dayOfWeek ?? 0),
            sessionOrdinal: Number(existing.ordinal ?? 0),
          };
          // If discipline/type changes, rebuild a fresh deterministic template so text stays coherent.
          const baseDetail = (() => {
            if (disciplineChanged || typeChanged) {
              return buildDeterministicSessionDetailV1({
                discipline: nextDiscipline as any,
                type: nextType,
                durationMinutes: nextDurationMinutes,
                context: detailContext,
              });
            }

            const parsed = sessionDetailV1Schema.safeParse(existing.detailJson);
            if (parsed.success) return parsed.data;
            return buildDeterministicSessionDetailV1({
              discipline: nextDiscipline as any,
              type: nextType,
              durationMinutes: nextDurationMinutes,
              context: detailContext,
            });
          })();

          let updatedDetail = durationChanged
            ? reflowSessionDetailV1ToNewTotal({ detail: baseDetail, newTotalMinutes: nextDurationMinutes })
            : normalizeSessionDetailV1DurationsToTotal({ detail: baseDetail, totalMinutes: nextDurationMinutes });

          if (edit.objective !== undefined) {
            const v = edit.objective === null ? '' : String(edit.objective);
            const trimmed = stripDurationTokens(v);
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
          const updatedParsed = sessionDetailV1Schema.safeParse(updatedDetail);
          if (!updatedParsed.success) {
            updatedDetail = normalizeSessionDetailV1DurationsToTotal({
              detail: buildDeterministicSessionDetailV1({
                discipline: nextDiscipline as any,
                type: nextType,
                durationMinutes: nextDurationMinutes,
                context: detailContext,
              }),
              totalMinutes: nextDurationMinutes,
            });
          } else {
            updatedDetail = updatedParsed.data;
          }

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

const DAY_SHORT_TO_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parseDurationDeltaMinutes(instruction: string): number | null {
  const lower = instruction.toLowerCase();
  const m = lower.match(/(\d+)\s*(?:min|mins|minutes)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (/\b(reduce|cut|decrease|shorter|less)\b/.test(lower)) return -n;
  if (/\b(increase|add|longer|more)\b/.test(lower)) return n;
  return null;
}

function findBlockIndex(detail: SessionDetailV1, blockType: SessionDetailBlockType): number {
  return detail.structure.findIndex((b: SessionDetailV1['structure'][number]) => b.blockType === blockType);
}

function buildAgentSessionEdit(params: {
  instruction: string;
  session: {
    id: string;
    discipline: string;
    type: string;
    durationMinutes: number;
    notes: string | null;
    detailJson: Prisma.JsonValue | null;
  };
}) {
  const instruction = String(params.instruction ?? '').trim();
  if (!instruction) return null;
  const lower = instruction.toLowerCase();
  const next: {
    sessionId: string;
    discipline?: string;
    type?: string;
    durationMinutes?: number;
    notes?: string | null;
    objective?: string | null;
    blockEdits?: Array<{ blockIndex: number; steps: string }>;
  } = { sessionId: params.session.id };

  if (/\bswim\b/.test(lower)) next.discipline = 'swim';
  else if (/\bbike\b|\bcycle\b|\bcycling\b/.test(lower)) next.discipline = 'bike';
  else if (/\brun\b|\brunning\b/.test(lower)) next.discipline = 'run';
  else if (/\bstrength\b/.test(lower)) next.discipline = 'strength';

  if (/\brecovery\b/.test(lower)) next.type = 'recovery';
  else if (/\btechnique\b|\bskills?\b/.test(lower)) next.type = 'technique';
  else if (/\bthreshold\b/.test(lower)) next.type = 'threshold';
  else if (/\btempo\b/.test(lower)) next.type = 'tempo';
  else if (/\bendurance\b|\baerobic\b/.test(lower)) next.type = 'endurance';
  else if (/\bstrength\b/.test(lower)) next.type = 'strength';

  if (/\b(easier|reduce intensity|dial back|lower intensity)\b/.test(lower)) {
    if (params.session.type === 'threshold') next.type = 'tempo';
    else if (params.session.type === 'tempo') next.type = 'endurance';
    else if (params.session.type === 'endurance') next.type = 'recovery';
  } else if (/\b(harder|increase intensity|push)\b/.test(lower)) {
    if (params.session.type === 'recovery') next.type = 'endurance';
    else if (params.session.type === 'endurance') next.type = 'tempo';
    else if (params.session.type === 'tempo') next.type = 'threshold';
  }

  const delta = parseDurationDeltaMinutes(instruction);
  if (delta != null) {
    next.durationMinutes = Math.max(20, Math.min(240, Number(params.session.durationMinutes ?? 0) + delta));
  } else if (/\bshorter\b/.test(lower)) {
    next.durationMinutes = Math.max(20, Math.round(Number(params.session.durationMinutes ?? 0) * 0.85));
  } else if (/\blonger\b/.test(lower)) {
    next.durationMinutes = Math.min(240, Math.round(Number(params.session.durationMinutes ?? 0) * 1.15));
  }

  const objectiveMatch = instruction.match(/(?:objective|purpose)\s*:\s*(.+)$/i);
  if (objectiveMatch?.[1]) next.objective = objectiveMatch[1].trim().slice(0, 240);

  const notesMatch = instruction.match(/(?:note|notes)\s*:\s*(.+)$/i);
  if (notesMatch?.[1]) {
    const merged = [String(params.session.notes ?? '').trim(), notesMatch[1].trim()].filter(Boolean).join(' | ');
    next.notes = merged.slice(0, 10_000);
  } else if (/\btravel\b/.test(lower)) {
    const merged = [String(params.session.notes ?? '').trim(), 'Travel-adjusted session.'].filter(Boolean).join(' | ');
    next.notes = merged.slice(0, 10_000);
  }

  const detailParsed = sessionDetailV1Schema.safeParse(params.session.detailJson ?? null);
  if (detailParsed.success) {
    const blockEdits: Array<{ blockIndex: number; steps: string }> = [];
    const detail = detailParsed.data;
    const lineParts = instruction.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
    for (const line of lineParts) {
      const warm = line.match(/^warmup\s*:\s*(.+)$/i);
      if (warm?.[1]) {
        const idx = findBlockIndex(detail, 'warmup');
        if (idx >= 0) blockEdits.push({ blockIndex: idx, steps: warm[1].trim().slice(0, 1_000) });
      }
      const main = line.match(/^(?:main|main set|set)\s*:\s*(.+)$/i);
      if (main?.[1]) {
        const idx = (() => {
          const m = findBlockIndex(detail, 'main');
          if (m >= 0) return m;
          return findBlockIndex(detail, 'strength');
        })();
        if (idx >= 0) blockEdits.push({ blockIndex: idx, steps: main[1].trim().slice(0, 1_000) });
      }
      const cool = line.match(/^cooldown\s*:\s*(.+)$/i);
      if (cool?.[1]) {
        const idx = findBlockIndex(detail, 'cooldown');
        if (idx >= 0) blockEdits.push({ blockIndex: idx, steps: cool[1].trim().slice(0, 1_000) });
      }
    }
    if (blockEdits.length) next.blockEdits = blockEdits;
  }

  const changed =
    next.discipline !== undefined ||
    next.type !== undefined ||
    next.durationMinutes !== undefined ||
    next.notes !== undefined ||
    next.objective !== undefined ||
    (Array.isArray(next.blockEdits) && next.blockEdits.length > 0);
  return changed ? next : null;
}

export async function applyAiAgentAdjustmentsToDraftPlan(params: {
  coachId: string;
  athleteId: string;
  draftPlanId: string;
  scope: 'session' | 'week' | 'plan';
  instruction: string;
  weekIndex?: number;
  sessionId?: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const draft = await prisma.aiPlanDraft.findUnique({
    where: { id: params.draftPlanId },
    select: {
      id: true,
      athleteId: true,
      coachId: true,
      sessions: {
        orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
        select: {
          id: true,
          weekIndex: true,
          dayOfWeek: true,
          discipline: true,
          type: true,
          durationMinutes: true,
          notes: true,
          detailJson: true,
        },
      },
    },
  });

  if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
  }

  const sessions = draft.sessions;
  const scopedSessions = (() => {
    if (params.scope === 'session') return sessions.filter((s) => s.id === params.sessionId);
    if (params.scope === 'week') return sessions.filter((s) => s.weekIndex === Number(params.weekIndex ?? -1));
    return sessions;
  })();

  if (!scopedSessions.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'No sessions found for selected AI adjustment scope.');
  }

  const sessionEdits = scopedSessions
    .map((session) =>
      buildAgentSessionEdit({
        instruction: params.instruction,
        session: {
          id: session.id,
          discipline: String(session.discipline),
          type: String(session.type),
          durationMinutes: Number(session.durationMinutes ?? 0),
          notes: session.notes,
          detailJson: session.detailJson,
        },
      })
    )
    .filter((edit): edit is NonNullable<typeof edit> => Boolean(edit));

  if (!sessionEdits.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Instruction did not produce any editable changes.');
  }

  const draftPlan = await updateAiDraftPlan({
    coachId: params.coachId,
    athleteId: params.athleteId,
    draftPlanId: params.draftPlanId,
    sessionEdits,
  });

  return {
    draftPlan,
    appliedCount: sessionEdits.length,
  };
}
