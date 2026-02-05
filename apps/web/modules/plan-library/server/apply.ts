import type { PlanPhase, PlanSourceRule, PlanSourceSessionTemplate, PlanSourceVersion } from '@prisma/client';

import type { AthleteBriefJson, AthleteProfileSnapshot } from '@/modules/ai/athlete-brief/types';
import type { DraftPlanSetupV1 } from '@/modules/ai-plan-builder/rules/draft-generator';

export type PlanSourceRuleBundleV1 = {
  planArchetype: string;
  disciplineSplitTargets?: { swim?: number; bike?: number; run?: number; strength?: number };
  weeklyMinutesByWeek?: number[];
  sessionsPerWeekOverride?: number;
  maxIntensityDaysPerWeek?: number;
  longSessionDay?: number | null;
  recoveryEveryNWeeks?: number;
  recoveryWeekMultiplier?: number;
  sessionTypeDistribution?: {
    technique?: number;
    endurance?: number;
    tempo?: number;
    threshold?: number;
    recovery?: number;
  };
  confidence: 'low' | 'med' | 'high';
  influenceNotes: string[];
};

export type PlanSourceInfluenceSummary = {
  confidence: 'low' | 'med' | 'high';
  notes: string[];
  appliedRules: string[];
  archetype?: string;
};

const DAY_MAP: Record<string, number> = {
  SUN: 0,
  SUNDAY: 0,
  MON: 1,
  MONDAY: 1,
  TUE: 2,
  TUESDAY: 2,
  WED: 3,
  WEDNESDAY: 3,
  THU: 4,
  THURSDAY: 4,
  FRI: 5,
  FRIDAY: 5,
  SAT: 6,
  SATURDAY: 6,
};

function parseDayPreference(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.min(6, Math.round(raw)));
  const key = String(raw).trim().toUpperCase();
  return DAY_MAP[key] ?? null;
}

function sum(values: number[]) {
  return values.reduce((acc, v) => acc + v, 0);
}

function normalizeSplit(split: { swim?: number; bike?: number; run?: number; strength?: number }) {
  const entries = Object.entries(split).filter(([, v]) => typeof v === 'number' && v > 0) as Array<[string, number]>;
  const total = sum(entries.map(([, v]) => v));
  if (total <= 0) return undefined;
  const normalized: Record<string, number> = {};
  for (const [k, v] of entries) normalized[k] = v / total;
  return normalized as { swim?: number; bike?: number; run?: number; strength?: number };
}

function deriveSplitFromSessions(sessions: PlanSourceSessionTemplate[]) {
  const counts: Record<string, number> = {};
  for (const session of sessions) {
    const key = session.discipline.toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return normalizeSplit({
    swim: counts.swim,
    bike: counts.bike,
    run: counts.run,
    strength: counts.strength,
  });
}

function deriveSessionTypeDistribution(sessions: PlanSourceSessionTemplate[]) {
  const counts: Record<string, number> = {};
  for (const session of sessions) {
    const key = String(session.sessionType || 'endurance').toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const distribution: Record<string, number> = {};
  const total = sum(Object.values(counts));
  if (!total) return undefined;
  Object.entries(counts).forEach(([k, v]) => {
    distribution[k] = v / total;
  });
  return {
    technique: distribution.technique,
    endurance: distribution.endurance,
    tempo: distribution.tempo,
    threshold: distribution.threshold,
    recovery: distribution.recovery,
  };
}

function deriveArchetype(planSource: { title: string; distance: string; level: string; durationWeeks: number }) {
  return `${planSource.title} (${planSource.distance} ${planSource.level} ${planSource.durationWeeks}wk)`;
}

function deriveBundleFromRules(params: {
  planSource: { title: string; distance: string; level: string; durationWeeks: number };
  rules: PlanSourceRule[];
  weeks: { totalMinutes: number | null }[];
  sessions: PlanSourceSessionTemplate[];
}) {
  const bundle: PlanSourceRuleBundleV1 = {
    planArchetype: deriveArchetype(params.planSource),
    confidence: 'low',
    influenceNotes: [],
  };

  const appliedRules: string[] = [];

  const disciplineRule = params.rules.find((r) => r.ruleType === 'DISCIPLINE_SPLIT');
  if (disciplineRule) {
    const rule = disciplineRule.ruleJson as any;
    const split = normalizeSplit({
      swim: Number(rule?.swimPct ?? 0),
      bike: Number(rule?.bikePct ?? 0),
      run: Number(rule?.runPct ?? 0),
      strength: Number(rule?.strengthPct ?? 0),
    });
    if (split) {
      bundle.disciplineSplitTargets = split;
      bundle.influenceNotes.push('Discipline split aligned with plan source.');
      appliedRules.push('DISCIPLINE_SPLIT');
    }
  }

  if (!bundle.disciplineSplitTargets) {
    const splitFromSessions = deriveSplitFromSessions(params.sessions);
    if (splitFromSessions) {
      bundle.disciplineSplitTargets = splitFromSessions;
      bundle.influenceNotes.push('Discipline split inferred from source sessions.');
      appliedRules.push('DISCIPLINE_SPLIT_INFERRED');
    }
  }

  const volumeRule = params.rules.find((r) => r.ruleType === 'WEEKLY_VOLUME');
  if (volumeRule) {
    const rule = volumeRule.ruleJson as any;
    const weekMinutes = Array.isArray(rule?.weekMinutes) ? rule.weekMinutes.map((v: any) => Number(v)).filter(Number.isFinite) : [];
    if (weekMinutes.length) {
      bundle.weeklyMinutesByWeek = weekMinutes;
      bundle.influenceNotes.push('Weekly volume progression follows plan source.');
      appliedRules.push('WEEKLY_VOLUME');
    }
    const deloadEvery = Number(rule?.deloadEveryNWeeks);
    if (Number.isFinite(deloadEvery) && deloadEvery > 1) {
      bundle.recoveryEveryNWeeks = Math.floor(deloadEvery);
      bundle.recoveryWeekMultiplier = 0.8;
      appliedRules.push('DELOAD');
    }
  }

  if (!bundle.weeklyMinutesByWeek) {
    const weekMinutes = params.weeks.map((w) => (typeof w.totalMinutes === 'number' ? w.totalMinutes : null));
    if (weekMinutes.some((v) => typeof v === 'number')) {
      bundle.weeklyMinutesByWeek = weekMinutes.map((v) => (typeof v === 'number' ? v : undefined)).filter((v) => v !== undefined) as number[];
      bundle.influenceNotes.push('Weekly volume targets inferred from source weeks.');
      appliedRules.push('WEEKLY_VOLUME_INFERRED');
    }
  }

  const longRule = params.rules.find((r) => r.ruleType === 'LONG_SESSION');
  if (longRule) {
    const rule = longRule.ruleJson as any;
    const preferred = parseDayPreference(rule?.longDayPreferred);
    if (preferred != null) {
      bundle.longSessionDay = preferred;
      bundle.influenceNotes.push('Long session day aligned with plan source.');
      appliedRules.push('LONG_SESSION');
    }
  }

  const intensityRule = params.rules.find((r) => r.ruleType === 'INTENSITY_DENSITY');
  if (intensityRule) {
    const rule = intensityRule.ruleJson as any;
    const maxIntensity = Number(rule?.maxIntensityDaysPerWeek);
    if (Number.isFinite(maxIntensity) && maxIntensity > 0) {
      bundle.maxIntensityDaysPerWeek = Math.max(1, Math.min(3, Math.round(maxIntensity)));
      bundle.influenceNotes.push('Intensity density constrained by plan source.');
      appliedRules.push('INTENSITY_DENSITY');
    }
  }

  const freqRule = params.rules.find((r) => r.ruleType === 'FREQUENCY');
  if (freqRule) {
    const rule = freqRule.ruleJson as any;
    const sessionsPerWeek = Number(rule?.sessionsPerWeek);
    if (Number.isFinite(sessionsPerWeek) && sessionsPerWeek > 0) {
      bundle.sessionsPerWeekOverride = Math.max(3, Math.min(10, Math.round(sessionsPerWeek)));
      appliedRules.push('FREQUENCY');
    }
  }

  if (!bundle.sessionTypeDistribution) {
    const inferred = deriveSessionTypeDistribution(params.sessions);
    if (inferred) {
      bundle.sessionTypeDistribution = inferred;
      bundle.influenceNotes.push('Session type mix inferred from source sessions.');
      appliedRules.push('SESSION_TYPE_INFERRED');
    }
  }

  const ruleCount = appliedRules.length;
  bundle.confidence = ruleCount >= 3 ? 'high' : ruleCount >= 1 ? 'med' : 'low';
  if (bundle.confidence === 'low') {
    bundle.influenceNotes.push('Plan source influence is limited due to sparse extraction.');
  }

  return { bundle, appliedRules };
}

export function applyPlanSourceToDraftInput(params: {
  athleteProfile: AthleteProfileSnapshot;
  athleteBrief?: AthleteBriefJson | null;
  apbSetup: DraftPlanSetupV1;
  baseDraftInput: DraftPlanSetupV1;
  selectedPlanSource: (PlanSourceVersion & {
    planSource: { title: string; distance: string; level: string; durationWeeks: number };
    weeks: { totalMinutes: number | null }[];
    sessions: PlanSourceSessionTemplate[];
    rules: PlanSourceRule[];
  }) | null;
}) {
  if (!params.selectedPlanSource) {
    return {
      adjustedDraftInput: params.baseDraftInput,
      influenceSummary: { confidence: 'low', notes: [], appliedRules: [] } as PlanSourceInfluenceSummary,
      ruleBundle: null as PlanSourceRuleBundleV1 | null,
    };
  }

  const { bundle, appliedRules } = deriveBundleFromRules({
    planSource: params.selectedPlanSource.planSource,
    rules: params.selectedPlanSource.rules,
    weeks: params.selectedPlanSource.weeks,
    sessions: params.selectedPlanSource.sessions,
  });

  const adjusted: DraftPlanSetupV1 = {
    ...params.baseDraftInput,
    disciplineEmphasis: bundle.disciplineSplitTargets
      ? (Object.entries(bundle.disciplineSplitTargets).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] as any) ?? params.baseDraftInput.disciplineEmphasis
      : params.baseDraftInput.disciplineEmphasis,
    maxIntensityDaysPerWeek: bundle.maxIntensityDaysPerWeek ?? params.baseDraftInput.maxIntensityDaysPerWeek,
    longSessionDay: bundle.longSessionDay ?? params.baseDraftInput.longSessionDay,
    weeklyMinutesByWeek: bundle.weeklyMinutesByWeek,
    recoveryEveryNWeeks: bundle.recoveryEveryNWeeks,
    recoveryWeekMultiplier: bundle.recoveryWeekMultiplier,
    disciplineSplitTargets: bundle.disciplineSplitTargets,
    sessionTypeDistribution: bundle.sessionTypeDistribution,
    sessionsPerWeekOverride: bundle.sessionsPerWeekOverride,
  } as DraftPlanSetupV1;

  return {
    adjustedDraftInput: adjusted,
    influenceSummary: {
      confidence: bundle.confidence,
      notes: bundle.influenceNotes,
      appliedRules,
      archetype: bundle.planArchetype,
    },
    ruleBundle: bundle,
  };
}
