import type { PlanPhase, PlanSourceDiscipline, RuleType } from '@prisma/client';

type WeekTemplate = {
  weekIndex: number;
  phase?: PlanPhase | null;
  totalMinutes?: number | null;
  totalSessions?: number | null;
  notes?: string | null;
};

type SessionTemplate = {
  weekIndex: number;
  ordinal: number;
  dayOfWeek?: number | null;
  discipline: PlanSourceDiscipline;
  sessionType: string;
  title?: string | null;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  intensityType?: string | null;
  intensityTargetJson?: unknown | null;
  structureJson?: unknown | null;
  notes?: string | null;
};

type ExtractedRule = {
  ruleType: RuleType;
  phase?: PlanPhase | null;
  appliesJson: unknown;
  ruleJson: unknown;
  explanation: string;
  priority: number;
};

export type CompiledPlanLogic = {
  graph: {
    confidence: number;
    inferredPhases: Array<{ weekIndex: number; phase: PlanPhase }>;
    weeklyMinutes: number[];
    disciplineSplit: { swim?: number; bike?: number; run?: number; strength?: number };
    sessionTypeMix: Record<string, number>;
    longSessionDayPreferred: number | null;
    sessionsPerWeek: number | null;
    maxIntensityDaysPerWeek: number | null;
    progressionCapPct: number;
    recoveryEveryNWeeks: number | null;
    detectedProgramTags: string[];
  };
  rules: ExtractedRule[];
};

function round(value: number, decimals = 3) {
  const p = Math.pow(10, decimals);
  return Math.round(value * p) / p;
}

function normalizeDistribution(input: Record<string, number>) {
  const entries = Object.entries(input).filter(([, v]) => Number.isFinite(v) && v > 0);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (!total) return {};
  return Object.fromEntries(entries.map(([k, v]) => [k, round(v / total)]));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid] ?? null;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function detectProgramTags(rawText: string): string[] {
  const lower = rawText.toLowerCase();
  const tags: string[] = [];
  if (/couch\s*to\s*5\s*k|5k/.test(lower)) tags.push('COUCH_TO_5K');
  if (/couch\s*to\s*ironman|ironman/.test(lower)) tags.push('COUCH_TO_IRONMAN');
  if (/half\s*marathon|hm/.test(lower) && /marathon/.test(lower)) tags.push('HALF_TO_FULL_MARATHON');
  if (/triathlon/.test(lower)) tags.push('TRIATHLON');
  if (/run|running/.test(lower)) tags.push('RUN');
  return tags;
}

function inferPhaseForWeek(weekIndex: number, weeksCount: number): PlanPhase {
  if (weeksCount <= 2) return weekIndex === weeksCount - 1 ? 'RACE' : 'TAPER';
  if (weekIndex === weeksCount - 1) return 'RACE';
  if (weekIndex >= weeksCount - 2) return 'TAPER';
  if ((weekIndex + 1) % 4 === 0) return 'RECOVERY';
  if (weekIndex < Math.max(1, Math.floor(weeksCount * 0.45))) return 'BASE';
  if (weekIndex < Math.max(2, Math.floor(weeksCount * 0.8))) return 'BUILD';
  return 'PEAK';
}

export function compilePlanLogicGraph(params: {
  rawText: string;
  weeks: WeekTemplate[];
  sessions: SessionTemplate[];
  durationWeeks?: number | null;
}): CompiledPlanLogic {
  const weeksCount = Math.max(
    params.durationWeeks ?? 0,
    params.weeks.length,
    (params.sessions.reduce((max, s) => Math.max(max, s.weekIndex), -1) + 1) || 0
  );

  const sessionCountsByWeek = new Map<number, number>();
  const weekMinutesByWeek = new Map<number, number>();
  const intensityDaysByWeek = new Map<number, Set<number>>();
  const disciplineCounts: Record<string, number> = { swim: 0, bike: 0, run: 0, strength: 0 };
  const sessionTypeCounts: Record<string, number> = {};
  const longDayMinutes: Record<number, number> = {};

  for (const week of params.weeks) {
    if (typeof week.totalMinutes === 'number' && Number.isFinite(week.totalMinutes)) {
      weekMinutesByWeek.set(week.weekIndex, Math.max(0, Math.round(week.totalMinutes)));
    }
    if (typeof week.totalSessions === 'number' && Number.isFinite(week.totalSessions)) {
      sessionCountsByWeek.set(week.weekIndex, Math.max(0, Math.round(week.totalSessions)));
    }
  }

  for (const s of params.sessions) {
    sessionCountsByWeek.set(s.weekIndex, (sessionCountsByWeek.get(s.weekIndex) ?? 0) + 1);

    const minutes = Math.max(0, Number(s.durationMinutes ?? 0) || 0);
    weekMinutesByWeek.set(s.weekIndex, (weekMinutesByWeek.get(s.weekIndex) ?? 0) + minutes);

    const d = String(s.discipline).toLowerCase();
    if (d in disciplineCounts) disciplineCounts[d] += 1;

    const sessionType = String(s.sessionType || 'endurance').toLowerCase();
    sessionTypeCounts[sessionType] = (sessionTypeCounts[sessionType] ?? 0) + 1;

    if (sessionType === 'tempo' || sessionType === 'threshold' || sessionType === 'vo2' || /interval|speed/.test(sessionType)) {
      const day = Number.isInteger(s.dayOfWeek) ? Number(s.dayOfWeek) : -1;
      if (day >= 0 && day <= 6) {
        const bucket = intensityDaysByWeek.get(s.weekIndex) ?? new Set<number>();
        bucket.add(day);
        intensityDaysByWeek.set(s.weekIndex, bucket);
      }
    }

    if (Number.isInteger(s.dayOfWeek) && minutes > 0) {
      const day = Number(s.dayOfWeek);
      longDayMinutes[day] = (longDayMinutes[day] ?? 0) + minutes;
    }
  }

  const weeklyMinutes: number[] = [];
  for (let i = 0; i < weeksCount; i += 1) {
    weeklyMinutes.push(Math.max(0, Math.round(weekMinutesByWeek.get(i) ?? 0)));
  }

  const sessionsPerWeekMedian = median(Array.from(sessionCountsByWeek.values()).filter((v) => v > 0));
  const sessionsPerWeek = sessionsPerWeekMedian == null ? null : Math.max(1, Math.round(sessionsPerWeekMedian));

  const maxIntensityDaysPerWeek = (() => {
    const values = Array.from(intensityDaysByWeek.values()).map((s) => s.size).filter((v) => v > 0);
    const med = median(values);
    if (med == null) return null;
    return Math.max(1, Math.min(3, Math.round(med)));
  })();

  const longSessionDayPreferred = (() => {
    const entries = Object.entries(longDayMinutes)
      .map(([k, v]) => [Number(k), v] as const)
      .filter(([k, v]) => Number.isInteger(k) && k >= 0 && k <= 6 && v > 0)
      .sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] ?? null;
  })();

  const progressionCapPct = (() => {
    const deltas: number[] = [];
    for (let i = 1; i < weeklyMinutes.length; i += 1) {
      const prev = weeklyMinutes[i - 1] ?? 0;
      const next = weeklyMinutes[i] ?? 0;
      if (prev <= 0 || next <= 0) continue;
      deltas.push((next - prev) / prev);
    }
    if (!deltas.length) return 0.1;
    const positive = deltas.filter((d) => d > 0);
    if (!positive.length) return 0.1;
    return Math.max(0.05, Math.min(0.2, round(Math.max(...positive), 2)));
  })();

  const recoveryEveryNWeeks = (() => {
    if (weeklyMinutes.length < 6) return null;
    for (const cadence of [4, 3, 5]) {
      const troughs: number[] = [];
      for (let i = cadence - 1; i < weeklyMinutes.length; i += cadence) {
        const current = weeklyMinutes[i] ?? 0;
        const prev = weeklyMinutes[i - 1] ?? 0;
        if (current > 0 && prev > 0 && current <= prev * 0.88) troughs.push(i);
      }
      if (troughs.length >= 1) return cadence;
    }
    return null;
  })();

  const detectedProgramTags = detectProgramTags(params.rawText);
  const disciplineSplit = normalizeDistribution(disciplineCounts) as {
    swim?: number;
    bike?: number;
    run?: number;
    strength?: number;
  };
  const sessionTypeMix = normalizeDistribution(sessionTypeCounts);

  const inferredPhases = Array.from({ length: weeksCount }, (_, weekIndex) => ({
    weekIndex,
    phase: inferPhaseForWeek(weekIndex, weeksCount),
  }));

  const rules: ExtractedRule[] = [];

  if (Object.keys(disciplineSplit).length) {
    rules.push({
      ruleType: 'DISCIPLINE_SPLIT',
      phase: null,
      appliesJson: {},
      ruleJson: {
        swimPct: disciplineSplit.swim ?? 0,
        bikePct: disciplineSplit.bike ?? 0,
        runPct: disciplineSplit.run ?? 0,
        strengthPct: disciplineSplit.strength ?? 0,
      },
      explanation: 'Inferred discipline split from source sessions.',
      priority: 1,
    });
  }

  if (weeklyMinutes.some((v) => v > 0)) {
    rules.push({
      ruleType: 'WEEKLY_VOLUME',
      phase: null,
      appliesJson: {},
      ruleJson: {
        weekMinutes: weeklyMinutes,
        deloadEveryNWeeks: recoveryEveryNWeeks,
        progressionCapPct,
      },
      explanation: 'Inferred weekly volume curve from source weeks and sessions.',
      priority: 1,
    });
  }

  if (sessionsPerWeek != null) {
    rules.push({
      ruleType: 'FREQUENCY',
      phase: null,
      appliesJson: {},
      ruleJson: { sessionsPerWeek },
      explanation: 'Inferred baseline weekly session frequency.',
      priority: 2,
    });
  }

  if (maxIntensityDaysPerWeek != null) {
    rules.push({
      ruleType: 'INTENSITY_DENSITY',
      phase: null,
      appliesJson: {},
      ruleJson: { maxIntensityDaysPerWeek },
      explanation: 'Inferred maximum hard days per week.',
      priority: 2,
    });
  }

  if (longSessionDayPreferred != null) {
    rules.push({
      ruleType: 'LONG_SESSION',
      phase: null,
      appliesJson: {},
      ruleJson: { longDayPreferred: longSessionDayPreferred },
      explanation: 'Inferred long-session anchor day.',
      priority: 2,
    });
  }

  rules.push({
    ruleType: 'PROGRESSION_CAP',
    phase: null,
    appliesJson: {},
    ruleJson: { maxWeeklyIncreasePct: progressionCapPct },
    explanation: 'Guardrail on weekly overload progression.',
    priority: 3,
  });

  if (detectedProgramTags.includes('COUCH_TO_5K') || detectedProgramTags.includes('COUCH_TO_IRONMAN')) {
    rules.push({
      ruleType: 'RISK_GUARDS',
      phase: null,
      appliesJson: {},
      ruleJson: {
        enforceRecoveryWeeks: true,
        capIntensityForNovice: true,
        requireProgressiveLongSession: true,
      },
      explanation: 'Program-family risk guardrails inferred from source context.',
      priority: 1,
    });
  }

  const confidence = Math.max(
    0,
    Math.min(
      1,
      round(
        (weeklyMinutes.some((v) => v > 0) ? 0.3 : 0) +
          (Object.keys(disciplineSplit).length ? 0.2 : 0) +
          (sessionsPerWeek != null ? 0.15 : 0) +
          (maxIntensityDaysPerWeek != null ? 0.15 : 0) +
          (longSessionDayPreferred != null ? 0.1 : 0) +
          (detectedProgramTags.length ? 0.1 : 0),
        3
      )
    )
  );

  return {
    graph: {
      confidence,
      inferredPhases,
      weeklyMinutes,
      disciplineSplit,
      sessionTypeMix,
      longSessionDayPreferred,
      sessionsPerWeek,
      maxIntensityDaysPerWeek,
      progressionCapPct,
      recoveryEveryNWeeks,
      detectedProgramTags,
    },
    rules,
  };
}
