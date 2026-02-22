import { applyPlanningPolicyProfileToSetup } from './policy-registry';

export type RiskTolerance = 'low' | 'med' | 'high';
export type DisciplineEmphasis = 'balanced' | 'swim' | 'bike' | 'run';
export type ProgramPolicy = 'COUCH_TO_5K' | 'COUCH_TO_IRONMAN_26' | 'HALF_TO_FULL_MARATHON';

export type DraftDiscipline = 'swim' | 'bike' | 'run' | 'strength' | 'rest';
export type DraftSessionType = 'endurance' | 'tempo' | 'threshold' | 'technique' | 'recovery' | 'strength' | 'rest';

export type DraftPlanSetupV1 = {
  weekStart?: 'monday' | 'sunday';
  // New UX: explicit plan start; still optional for backward compatibility.
  startDate?: string; // yyyy-mm-dd
  // Legacy name for completion date.
  eventDate: string; // yyyy-mm-dd
  weeksToEvent: number;
  // When present, coach explicitly overrides the date-derived weeks.
  weeksToEventOverride?: number;
  weeklyAvailabilityDays: number[]; // 0=Sun..6=Sat
  weeklyAvailabilityMinutes: number | Record<string, number>; // total minutes/week OR map dayIndex->minutes
  disciplineEmphasis: DisciplineEmphasis;
  riskTolerance: RiskTolerance;
  maxIntensityDaysPerWeek: number; // 1-3
  maxDoublesPerWeek: number; // 0-3
  longSessionDay?: number | null; // 0=Sun..6=Sat
  coachGuidanceText?: string; // plain-English coach guidance; optional
  programPolicy?: ProgramPolicy;
  weeklyMinutesByWeek?: number[]; // optional per-week override
  disciplineSplitTargets?: { swim?: number; bike?: number; run?: number; strength?: number };
  sessionTypeDistribution?: {
    technique?: number;
    endurance?: number;
    tempo?: number;
    threshold?: number;
    recovery?: number;
  };
  recoveryEveryNWeeks?: number;
  recoveryWeekMultiplier?: number;
  sessionsPerWeekOverride?: number;
  requestContext?: {
    goalDetails?: string;
    goalFocus?: string;
    primaryDisciplineFocus?: 'balanced' | 'swim' | 'bike' | 'run';
    eventName?: string;
    eventDate?: string;
    goalTimeline?: string;
    weeklyMinutes?: number;
    availabilityDays?: string[];
    nonNegotiableDays?: string[];
    preferredKeyDays?: string[];
    dailyTimeWindows?: Record<string, 'any' | 'am' | 'midday' | 'pm' | 'evening'>;
    experienceLevel?: string;
    injuryStatus?: string;
    disciplineInjuryNotes?: string;
    constraintsNotes?: string;
    equipment?: string;
    environmentTags?: string[];
    fatigueState?: 'fresh' | 'normal' | 'fatigued' | 'cooked';
    availableTimeMinutes?: number;
  };
  policyProfileId?: 'coachkit-conservative-v1' | 'coachkit-safe-v1' | 'coachkit-performance-v1';
  policyProfileVersion?: 'v1';
};

export type DraftWeekV1 = {
  weekIndex: number;
  locked: boolean;
  sessions: Array<{
    weekIndex: number;
    ordinal: number;
    dayOfWeek: number;
    discipline: DraftDiscipline;
    type: DraftSessionType;
    durationMinutes: number;
    notes?: string | null;
    locked: boolean;
  }>;
};

export type DraftPlanV1 = {
  version: 'v1';
  setup: DraftPlanSetupV1;
  weeks: DraftWeekV1[];
};

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function stableDayList(days: number[]) {
  return Array.from(new Set(days)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
}

function availabilityTotalMinutes(availability: DraftPlanSetupV1['weeklyAvailabilityMinutes']) {
  if (typeof availability === 'number') return Math.max(0, Math.round(availability));
  const entries = Object.entries(availability);
  return entries.reduce((sum, [, v]) => sum + (typeof v === 'number' ? Math.max(0, Math.round(v)) : 0), 0);
}

function normalizeWeights<T extends Record<string, number | undefined>>(weights: T) {
  const entries = Object.entries(weights).filter(([, v]) => typeof v === 'number' && (v as number) > 0) as Array<[string, number]>;
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (!total) return null;
  return entries.map(([k, v]) => [k, v / total] as const);
}

function buildWeightedSequence(keys: Array<readonly [string, number]>, totalCount: number) {
  if (!keys.length || totalCount <= 0) return [] as string[];
  const counts = keys.map(([key, weight]) => ({
    key,
    count: Math.max(0, Math.round(weight * totalCount)),
  }));

  let assigned = counts.reduce((sum, c) => sum + c.count, 0);
  let guard = 0;
  while (assigned < totalCount && guard++ < 100) {
    counts.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    counts[0].count += 1;
    assigned += 1;
  }
  guard = 0;
  while (assigned > totalCount && guard++ < 100) {
    counts.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const target = counts.find((c) => c.count > 0);
    if (!target) break;
    target.count -= 1;
    assigned -= 1;
  }

  const sequence: string[] = [];
  const queue = counts
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  while (sequence.length < totalCount && queue.length) {
    for (const item of queue) {
      if (item.count <= 0) continue;
      sequence.push(item.key);
      item.count -= 1;
      if (sequence.length >= totalCount) break;
    }
  }

  return sequence;
}

function disciplineSequence(setup: DraftPlanSetupV1, totalSessions: number) {
  const weights = normalizeWeights({
    swim: setup.disciplineSplitTargets?.swim,
    bike: setup.disciplineSplitTargets?.bike,
    run: setup.disciplineSplitTargets?.run,
    strength: setup.disciplineSplitTargets?.strength,
  });

  if (!weights) return null;
  return buildWeightedSequence(weights, totalSessions).map((d) => d as DraftDiscipline);
}

function sessionTypeQueues(setup: DraftPlanSetupV1) {
  const weights = normalizeWeights({
    technique: setup.sessionTypeDistribution?.technique,
    endurance: setup.sessionTypeDistribution?.endurance,
    tempo: setup.sessionTypeDistribution?.tempo,
    threshold: setup.sessionTypeDistribution?.threshold,
    recovery: setup.sessionTypeDistribution?.recovery,
  });

  if (!weights) return null;

  const intensityWeights = weights.filter(([key]) => key === 'tempo' || key === 'threshold');
  const easyWeights = weights.filter(([key]) => key === 'technique' || key === 'endurance' || key === 'recovery');

  return {
    intensity: buildWeightedSequence(intensityWeights, 6),
    easy: buildWeightedSequence(easyWeights, 6),
  };
}

function sessionsPerWeek(setup: DraftPlanSetupV1, daysCount: number) {
  if (typeof setup.sessionsPerWeekOverride === 'number' && Number.isFinite(setup.sessionsPerWeekOverride)) {
    return clampInt(setup.sessionsPerWeekOverride, 3, Math.max(3, daysCount + clampInt(setup.maxDoublesPerWeek, 0, 3)));
  }
  // Conservative defaults: keep it useful, not "clever".
  const base = setup.riskTolerance === 'low' ? 5 : setup.riskTolerance === 'med' ? 6 : 8;
  const minBase = setup.riskTolerance === 'low' ? 4 : setup.riskTolerance === 'med' ? 5 : 6;

  const maxByDays = daysCount + clampInt(setup.maxDoublesPerWeek, 0, 3); // at most one extra session per "double".
  return clampInt(Math.min(base, maxByDays), minBase, Math.max(minBase, maxByDays));
}

function taperMultiplier(setup: DraftPlanSetupV1, weekIndex: number) {
  // weekIndex: 0..weeksToEvent-1, where last week is closest to event.
  const remaining = setup.weeksToEvent - 1 - weekIndex;
  if (remaining >= 2) return 1;

  // Last 2 weeks: reduce 20-40% depending on risk.
  if (setup.riskTolerance === 'low') return remaining === 1 ? 0.85 : 0.75;
  if (setup.riskTolerance === 'med') return remaining === 1 ? 0.8 : 0.7;
  return remaining === 1 ? 0.75 : 0.6;
}

function includesSwim(setup: DraftPlanSetupV1) {
  return setup.disciplineEmphasis === 'balanced' || setup.disciplineEmphasis === 'swim';
}

function mainDiscipline(setup: DraftPlanSetupV1): DraftDiscipline {
  if (setup.disciplineEmphasis === 'swim') return 'swim';
  if (setup.disciplineEmphasis === 'bike') return 'bike';
  if (setup.disciplineEmphasis === 'run') return 'run';
  return 'bike';
}

function pickLongDay(setup: DraftPlanSetupV1, days: number[]) {
  const preferred = setup.longSessionDay;
  if (preferred !== null && preferred !== undefined && days.includes(preferred)) return preferred;

  // Prefer Sat/Sun if available.
  for (const d of [6, 0]) {
    if (days.includes(d)) return d;
  }

  return days[days.length - 1] ?? 0;
}

function daySortKey(dayOfWeek: number, weekStart: 'monday' | 'sunday') {
  const d = ((Number(dayOfWeek) % 7) + 7) % 7;
  if (weekStart === 'sunday') return d;
  return (d + 6) % 7;
}

function hasInjurySignal(setup: DraftPlanSetupV1): boolean {
  const guidance = String(setup.coachGuidanceText ?? '').toLowerCase();
  return /\binjury\b|\bpain\b|\bsplint\b|\bashilles\b|\bachilles\b|\bknee\b|\bcalf\b|\bhamstring\b/.test(guidance);
}

function hasHardNoTrainingConstraintSignal(setup: DraftPlanSetupV1): boolean {
  const guidance = String(setup.coachGuidanceText ?? '').toLowerCase();
  return /\bno training\b|\bno workouts?\b|\brest only\b|\bfull rest\b|\boff entirely\b/.test(guidance);
}

function parseTravelWindows(params: { text: string; fallbackYear?: number }): Array<{ start: Date; end: Date }> {
  const text = String(params.text ?? '');
  if (!text.trim()) return [];
  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  const windows: Array<{ start: Date; end: Date }> = [];
  const regex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?(?:[,\s]+(\d{4}))?/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) != null) {
    const monthKey = String(match[1] ?? '').toLowerCase();
    const month = months[monthKey];
    if (month == null) continue;
    const startDay = Number(match[2] ?? 0);
    const endDay = Number(match[3] ?? match[2] ?? 0);
    const year = Number(match[4] ?? params.fallbackYear ?? new Date().getUTCFullYear());
    if (!Number.isInteger(startDay) || !Number.isInteger(endDay) || startDay <= 0 || endDay <= 0) continue;

    const start = new Date(Date.UTC(year, month, startDay));
    const end = new Date(Date.UTC(year, month, endDay));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end.getTime() < start.getTime()) continue;
    windows.push({ start, end });
  }
  return windows;
}

function overlapsWindow(params: { weekStartDate: Date | null; weekEndDate: Date | null; windows: Array<{ start: Date; end: Date }> }): boolean {
  if (!params.weekStartDate || !params.weekEndDate || !params.windows.length) return false;
  const weekStartTs = params.weekStartDate.getTime();
  const weekEndTs = params.weekEndDate.getTime();
  return params.windows.some((w) => w.start.getTime() <= weekEndTs && w.end.getTime() >= weekStartTs);
}

function isDateInWindows(params: { date: Date | null; windows: Array<{ start: Date; end: Date }> }): boolean {
  if (!params.date || !params.windows.length) return false;
  const ts = params.date.getTime();
  return params.windows.some((w) => w.start.getTime() <= ts && w.end.getTime() >= ts);
}

function isBeginnerProfile(setup: DraftPlanSetupV1): boolean {
  const guidance = String(setup.coachGuidanceText ?? '').toLowerCase();
  if (setup.programPolicy === 'COUCH_TO_5K' || setup.programPolicy === 'COUCH_TO_IRONMAN_26') return true;
  if (setup.riskTolerance === 'low') return true;
  return /\bbeginner\b|\bnovice\b|\bcouch\b/.test(guidance);
}

function applyInjurySessionGuardrail(params: {
  setup: DraftPlanSetupV1;
  session: DraftWeekV1['sessions'][number];
}): DraftWeekV1['sessions'][number] {
  if (!hasInjurySignal(params.setup)) return params.session;

  const s = { ...params.session };
  if (s.discipline === 'run') {
    if (s.type === 'tempo' || s.type === 'threshold') s.type = 'endurance';
    s.durationMinutes = Math.min(s.durationMinutes, 45);
    if (!s.notes) s.notes = 'Injury-adjusted';
  }
  return s;
}

function applySessionGuardrails(params: {
  setup: DraftPlanSetupV1;
  weekIndex: number;
  session: DraftWeekV1['sessions'][number];
}): DraftWeekV1['sessions'][number] {
  const beginnerAdjusted = applyBeginnerSessionGuardrail(params);
  return applyInjurySessionGuardrail({
    setup: params.setup,
    session: beginnerAdjusted,
  });
}

function applyTravelDaySessionGuardrail(params: {
  setup: DraftPlanSetupV1;
  session: DraftWeekV1['sessions'][number];
  isTravelDay: boolean;
}): DraftWeekV1['sessions'][number] {
  if (!params.isTravelDay) return params.session;
  const s = { ...params.session };

  if (s.type === 'tempo' || s.type === 'threshold') s.type = 'endurance';
  if (/\blong run\b|\blong ride\b|\bbrick\b/i.test(String(s.notes ?? ''))) s.notes = 'Travel day maintenance';
  if (!String(s.notes ?? '').toLowerCase().includes('travel')) {
    s.notes = String(s.notes ?? '').trim() ? `${String(s.notes).trim()} · Travel-adjusted` : 'Travel-adjusted';
  }

  const cap = s.discipline === 'run' ? 40 : 50;
  s.durationMinutes = clampInt(Math.min(s.durationMinutes, cap), 20, cap);
  return s;
}

function applyBeginnerWeekMinutesGuardrail(params: {
  setup: DraftPlanSetupV1;
  weekIndex: number;
  weekTotalMinutes: number;
}): number {
  if (!isBeginnerProfile(params.setup)) return params.weekTotalMinutes;
  const progression = [0.62, 0.72, 0.82, 0.9];
  const factor = progression[params.weekIndex] ?? 1;
  return clampInt(params.weekTotalMinutes * factor, 60, Math.max(60, params.weekTotalMinutes));
}

function applyBeginnerSessionGuardrail(params: {
  setup: DraftPlanSetupV1;
  weekIndex: number;
  session: DraftWeekV1['sessions'][number];
}): DraftWeekV1['sessions'][number] {
  if (!isBeginnerProfile(params.setup)) return params.session;

  const s = { ...params.session };
  const week = params.weekIndex;
  const isEarlyBlock = week < 4;
  const isVeryEarlyBlock = week < 2;

  const isBrick = /\bbrick\b/i.test(String(s.notes ?? ''));
  if (isBrick && isEarlyBlock) {
    s.notes = 'Endurance focus';
    s.durationMinutes = clampInt(s.durationMinutes * 0.7, 20, 45);
  }

  if (s.discipline === 'run') {
    const runCap = isVeryEarlyBlock ? 45 : isEarlyBlock ? 55 : 70;
    s.durationMinutes = Math.min(s.durationMinutes, runCap);
  } else if (s.discipline === 'swim' && s.type === 'technique') {
    s.durationMinutes = Math.min(s.durationMinutes, isVeryEarlyBlock ? 45 : 55);
  } else {
    s.durationMinutes = Math.min(s.durationMinutes, isVeryEarlyBlock ? 70 : 90);
  }

  s.durationMinutes = Math.max(20, s.durationMinutes);
  return s;
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function progressionCurve(params: {
  weeks: number;
  startMinutes: number;
  endMinutes: number;
  recoveryEveryNWeeks?: number;
  recoveryWeekMultiplier?: number;
  taperWeeks?: number;
}) {
  const weeks = Math.max(1, Math.round(params.weeks));
  const taperWeeks = Math.max(0, Math.min(3, Math.round(params.taperWeeks ?? 2)));
  const recoveryEveryN = params.recoveryEveryNWeeks && params.recoveryEveryNWeeks > 1 ? Math.round(params.recoveryEveryNWeeks) : null;
  const recoveryMul = typeof params.recoveryWeekMultiplier === 'number' ? Math.max(0.55, Math.min(0.95, params.recoveryWeekMultiplier)) : 0.8;
  const values: number[] = [];

  for (let i = 0; i < weeks; i += 1) {
    const progress = weeks <= 1 ? 1 : i / (weeks - 1);
    const baseline = params.startMinutes + (params.endMinutes - params.startMinutes) * progress;
    let next = baseline;
    if (recoveryEveryN && (i + 1) % recoveryEveryN === 0) next *= recoveryMul;
    if (taperWeeks > 0 && i >= weeks - taperWeeks) {
      const t = i - (weeks - taperWeeks) + 1;
      next *= Math.max(0.6, 1 - t * 0.12);
    }
    values.push(Math.max(45, Math.round(next)));
  }

  return values;
}

function buildDefaultPeriodization(setup: DraftPlanSetupV1): number[] | undefined {
  if (Array.isArray(setup.weeklyMinutesByWeek) && setup.weeklyMinutesByWeek.length) return undefined;
  const weeks = Math.max(1, Math.round(setup.weeksToEvent || 1));
  if (weeks <= 1) return [Math.max(45, availabilityTotalMinutes(setup.weeklyAvailabilityMinutes))];

  const endMinutes = Math.max(90, availabilityTotalMinutes(setup.weeklyAvailabilityMinutes));
  const experience = String(setup.requestContext?.experienceLevel ?? '').toLowerCase();
  const beginner = /\bbeginner\b|\bnovice\b|\bcouch\b/.test(experience) || setup.riskTolerance === 'low';
  const startRatio = beginner ? 0.62 : setup.riskTolerance === 'high' ? 0.78 : 0.7;
  const recoveryEveryNWeeks = beginner ? 3 : 4;
  const recoveryWeekMultiplier = beginner ? 0.8 : 0.85;
  const taperWeeks = weeks >= 8 ? 2 : 1;

  return progressionCurve({
    weeks,
    startMinutes: Math.max(60, Math.round(endMinutes * startRatio)),
    endMinutes,
    recoveryEveryNWeeks,
    recoveryWeekMultiplier,
    taperWeeks,
  });
}

function applyProgramPolicy(setup: DraftPlanSetupV1): DraftPlanSetupV1 {
  if (!setup.programPolicy) return setup;
  const weeks = Math.max(1, Math.round(setup.weeksToEvent || 1));

  if (setup.programPolicy === 'COUCH_TO_5K') {
    const endMinutes = Math.max(180, Math.min(260, availabilityTotalMinutes(setup.weeklyAvailabilityMinutes) || 220));
    return {
      ...setup,
      disciplineEmphasis: 'run',
      riskTolerance: 'low',
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      sessionsPerWeekOverride: Math.max(3, Math.min(5, setup.sessionsPerWeekOverride ?? 4)),
      disciplineSplitTargets: { run: 0.75, strength: 0.2, bike: 0.05 },
      sessionTypeDistribution: { endurance: 0.58, recovery: 0.24, tempo: 0.1, technique: 0.08 },
      recoveryEveryNWeeks: 4,
      recoveryWeekMultiplier: 0.82,
      weeklyMinutesByWeek: progressionCurve({
        weeks,
        startMinutes: 90,
        endMinutes,
        recoveryEveryNWeeks: 4,
        recoveryWeekMultiplier: 0.82,
        taperWeeks: 2,
      }),
    };
  }

  if (setup.programPolicy === 'COUCH_TO_IRONMAN_26') {
    const endMinutes = Math.max(720, Math.min(980, availabilityTotalMinutes(setup.weeklyAvailabilityMinutes) || 840));
    return {
      ...setup,
      disciplineEmphasis: 'balanced',
      riskTolerance: 'med',
      maxIntensityDaysPerWeek: Math.max(1, Math.min(2, setup.maxIntensityDaysPerWeek)),
      // Respect explicit coach/athlete cap, including 0 doubles.
      maxDoublesPerWeek: Math.max(0, Math.min(2, setup.maxDoublesPerWeek)),
      sessionsPerWeekOverride: Math.max(6, Math.min(9, setup.sessionsPerWeekOverride ?? 7)),
      disciplineSplitTargets: { swim: 0.23, bike: 0.45, run: 0.27, strength: 0.05 },
      sessionTypeDistribution: { endurance: 0.56, technique: 0.16, tempo: 0.14, threshold: 0.08, recovery: 0.06 },
      recoveryEveryNWeeks: 4,
      recoveryWeekMultiplier: 0.76,
      longSessionDay: setup.longSessionDay ?? 6,
      weeklyMinutesByWeek: progressionCurve({
        weeks,
        startMinutes: 300,
        endMinutes,
        recoveryEveryNWeeks: 4,
        recoveryWeekMultiplier: 0.76,
        taperWeeks: 3,
      }),
    };
  }

  if (setup.programPolicy === 'HALF_TO_FULL_MARATHON') {
    const endMinutes = Math.max(420, Math.min(620, availabilityTotalMinutes(setup.weeklyAvailabilityMinutes) || 520));
    return {
      ...setup,
      disciplineEmphasis: 'run',
      riskTolerance: 'med',
      maxIntensityDaysPerWeek: Math.max(1, Math.min(2, setup.maxIntensityDaysPerWeek)),
      maxDoublesPerWeek: Math.max(0, Math.min(1, setup.maxDoublesPerWeek)),
      sessionsPerWeekOverride: Math.max(5, Math.min(7, setup.sessionsPerWeekOverride ?? 6)),
      disciplineSplitTargets: { run: 0.7, strength: 0.2, bike: 0.1 },
      sessionTypeDistribution: { endurance: 0.52, recovery: 0.18, tempo: 0.17, threshold: 0.08, technique: 0.05 },
      recoveryEveryNWeeks: 4,
      recoveryWeekMultiplier: 0.8,
      longSessionDay: setup.longSessionDay ?? 0,
      weeklyMinutesByWeek: progressionCurve({
        weeks,
        startMinutes: 240,
        endMinutes,
        recoveryEveryNWeeks: 4,
        recoveryWeekMultiplier: 0.8,
        taperWeeks: 2,
      }),
    };
  }

  const generatedMinutes = buildDefaultPeriodization(setup);
  if (!generatedMinutes) return setup;
  return {
    ...setup,
    weeklyMinutesByWeek: generatedMinutes,
    recoveryEveryNWeeks: setup.recoveryEveryNWeeks ?? 4,
    recoveryWeekMultiplier: setup.recoveryWeekMultiplier ?? 0.85,
  };
}

function humanizeWeekDurations(params: {
  sessions: DraftWeekV1['sessions'];
  longDay: number;
}): DraftWeekV1['sessions'] {
  const MIN = 20;
  const MAX = 240;

  const originalTotal = params.sessions.reduce((sum, s) => sum + (Number(s.durationMinutes) || 0), 0);

  const rounded = params.sessions.map((s) => {
    const isLongDay = s.dayOfWeek === params.longDay;
    const base = Number(s.durationMinutes) || 0;
    const step = isLongDay || base >= 90 ? 10 : 5;
    const next = Math.max(MIN, Math.min(MAX, roundToStep(base, step)));
    return { ...s, durationMinutes: next, __step: step, __isLongDay: isLongDay } as any;
  });

  let diff = originalTotal - rounded.reduce((sum, s: any) => sum + (Number(s.durationMinutes) || 0), 0);

  const tryAdjust = (direction: 'up' | 'down') => {
    const candidates = rounded
      .slice()
      .sort((a: any, b: any) => {
        // Prefer adjusting non-long-day sessions first.
        if (a.__isLongDay !== b.__isLongDay) return a.__isLongDay ? 1 : -1;

        // Prefer smaller steps for fine adjustments.
        if (a.__step !== b.__step) return a.__step - b.__step;

        // For down: reduce biggest first. For up: increase smallest first.
        return direction === 'down' ? b.durationMinutes - a.durationMinutes : a.durationMinutes - b.durationMinutes;
      });

    for (const s of candidates as any[]) {
      const step = Number(s.__step) || 5;
      if (direction === 'up') {
        if (s.durationMinutes + step > MAX) continue;
        s.durationMinutes += step;
        diff -= step;
        return true;
      }

      if (s.durationMinutes - step < MIN) continue;
      s.durationMinutes -= step;
      diff += step;
      return true;
    }

    return false;
  };

  // Adjust to preserve weekly intent (sum of generated durations) after rounding.
  // Cap iterations to avoid pathological loops.
  let guard = 0;
  while (diff !== 0 && guard++ < 500) {
    if (diff > 0) {
      if (!tryAdjust('up')) break;
    } else {
      if (!tryAdjust('down')) break;
    }
  }

  return rounded.map(({ __step, __isLongDay, ...s }: any) => s);
}

function isKeySession(session: DraftWeekV1['sessions'][number]): boolean {
  const notes = String(session.notes ?? '').toLowerCase();
  if (session.type === 'tempo' || session.type === 'threshold') return true;
  if (notes.includes('key session')) return true;
  if (notes.includes('long run') || notes.includes('long ride') || notes.includes('brick')) return true;
  return false;
}

function keySessionBand(setup: DraftPlanSetupV1): { min: number; max: number } {
  const beginner = isBeginnerProfile(setup);
  if (beginner) return { min: 2, max: 2 };
  if (setup.riskTolerance === 'high') return { min: 3, max: 4 };
  return { min: 2, max: 3 };
}

function enforceWeeklyKeySessionBudget(params: {
  setup: DraftPlanSetupV1;
  sessions: DraftWeekV1['sessions'];
}): DraftWeekV1['sessions'] {
  const next = params.sessions.map((s) => ({ ...s }));
  const band = keySessionBand(params.setup);
  const keyIndices = () => next.map((s, idx) => ({ idx, s })).filter((row) => isKeySession(row.s)).map((row) => row.idx);

  // Too many keys: first downgrade intensity-only keys, then remove "key" notes.
  let keys = keyIndices();
  if (keys.length > band.max) {
    const downgradeCandidates = keys
      .filter((idx) => next[idx].type === 'tempo' || next[idx].type === 'threshold')
      .sort((a, b) => Number(next[a].durationMinutes ?? 0) - Number(next[b].durationMinutes ?? 0));
    for (const idx of downgradeCandidates) {
      if (keyIndices().length <= band.max) break;
      next[idx] = { ...next[idx], type: 'endurance', notes: 'Steady support session' };
    }
    keys = keyIndices();
    if (keys.length > band.max) {
      const noteOnlyCandidates = keys
        .filter((idx) => String(next[idx].notes ?? '').toLowerCase().includes('key session'))
        .sort((a, b) => Number(next[a].durationMinutes ?? 0) - Number(next[b].durationMinutes ?? 0));
      for (const idx of noteOnlyCandidates) {
        if (keyIndices().length <= band.max) break;
        next[idx] = { ...next[idx], notes: null };
      }
    }
  }

  // Too few keys: promote longest non-key sessions.
  keys = keyIndices();
  if (keys.length < band.min) {
    const promote = next
      .map((s, idx) => ({ idx, s }))
      .filter((row) => !isKeySession(row.s) && row.s.type !== 'recovery')
      .sort((a, b) => Number(b.s.durationMinutes ?? 0) - Number(a.s.durationMinutes ?? 0));
    for (const row of promote) {
      if (keyIndices().length >= band.min) break;
      next[row.idx] = { ...next[row.idx], notes: String(next[row.idx].notes ?? '').trim() ? `${String(next[row.idx].notes)} · Key session` : 'Key session' };
    }
  }

  return next;
}

function reduceAdjacentIntensity(params: { sessions: DraftWeekV1['sessions']; weekStart: 'monday' | 'sunday' }): DraftWeekV1['sessions'] {
  const next = params.sessions.map((s) => ({ ...s }));
  const sorted = next
    .map((s, idx) => ({ idx, s }))
    .sort((a, b) => daySortKey(a.s.dayOfWeek, params.weekStart) - daySortKey(b.s.dayOfWeek, params.weekStart) || a.s.ordinal - b.s.ordinal);

  let lastIntensitySortKey: number | null = null;
  for (const row of sorted) {
    const isIntensity = row.s.type === 'tempo' || row.s.type === 'threshold';
    if (!isIntensity) continue;
    const currentKey = daySortKey(row.s.dayOfWeek, params.weekStart);
    if (lastIntensitySortKey != null && currentKey - lastIntensitySortKey <= 1) {
      next[row.idx] = { ...next[row.idx], type: 'endurance', notes: 'Adjusted to avoid stacked stress' };
      continue;
    }
    lastIntensitySortKey = currentKey;
  }
  return next;
}

function reduceLongThenIntensity(params: { sessions: DraftWeekV1['sessions']; weekStart: 'monday' | 'sunday' }): DraftWeekV1['sessions'] {
  const next = params.sessions.map((s) => ({ ...s }));
  const longDays = new Set(
    next
      .filter((s) => /\blong run\b|\blong ride\b|\bbrick\b/i.test(String(s.notes ?? '')))
      .map((s) => daySortKey(Number(s.dayOfWeek ?? 0), params.weekStart))
  );
  if (!longDays.size) return next;

  for (let idx = 0; idx < next.length; idx += 1) {
    const session = next[idx];
    const isIntensity = session.type === 'tempo' || session.type === 'threshold';
    if (!isIntensity) continue;
    const sortDay = daySortKey(Number(session.dayOfWeek ?? 0), params.weekStart);
    if (longDays.has(sortDay - 1)) {
      next[idx] = {
        ...session,
        type: 'endurance',
        notes: String(session.notes ?? '').trim()
          ? `${String(session.notes)} · Adjusted after long session`
          : 'Adjusted after long session',
      };
    }
  }

  return next;
}

export function generateDraftPlanDeterministicV1(setupRaw: DraftPlanSetupV1): DraftPlanV1 {
  const days = stableDayList(setupRaw.weeklyAvailabilityDays);
  const weeksToEvent = clampInt(setupRaw.weeksToEvent, 1, 52);
  const maxIntensityDaysPerWeek = clampInt(setupRaw.maxIntensityDaysPerWeek, 1, 3);
  const maxDoublesPerWeek = clampInt(setupRaw.maxDoublesPerWeek, 0, 3);
  const weekStart: 'monday' | 'sunday' = setupRaw.weekStart === 'sunday' ? 'sunday' : 'monday';

  const setup: DraftPlanSetupV1 = {
    ...setupRaw,
    weekStart,
    weeksToEvent,
    weeklyAvailabilityDays: days,
    maxIntensityDaysPerWeek,
    maxDoublesPerWeek,
  };
  const setupWithPolicy = applyPlanningPolicyProfileToSetup(setup);
  const effectiveSetup = applyProgramPolicy(setupWithPolicy);

  const totalMinutesBase = availabilityTotalMinutes(effectiveSetup.weeklyAvailabilityMinutes);
  const requestedTargetSessions = sessionsPerWeek(effectiveSetup, days.length);
  const defaultLongDay = pickLongDay(effectiveSetup, days);
  const disciplineQueue = disciplineSequence(effectiveSetup, requestedTargetSessions);
  const typeQueues = sessionTypeQueues(effectiveSetup);
  const injuryFlag = hasInjurySignal(effectiveSetup);
  const setupStartDate = typeof effectiveSetup.startDate === 'string' ? new Date(`${effectiveSetup.startDate}T00:00:00.000Z`) : null;
  const travelWindows = parseTravelWindows({
    text: String(effectiveSetup.coachGuidanceText ?? ''),
    fallbackYear: setupStartDate && !Number.isNaN(setupStartDate.getTime()) ? setupStartDate.getUTCFullYear() : undefined,
  });

  const weeks: DraftWeekV1[] = [];

  for (let weekIndex = 0; weekIndex < weeksToEvent; weekIndex++) {
    const weekStartDate =
      setupStartDate && !Number.isNaN(setupStartDate.getTime())
        ? new Date(Date.UTC(setupStartDate.getUTCFullYear(), setupStartDate.getUTCMonth(), setupStartDate.getUTCDate() + weekIndex * 7))
        : null;
    const weekEndDate = weekStartDate
      ? new Date(Date.UTC(weekStartDate.getUTCFullYear(), weekStartDate.getUTCMonth(), weekStartDate.getUTCDate() + 6))
      : null;
    const weekHasTravel = overlapsWindow({
      weekStartDate,
      weekEndDate,
      windows: travelWindows,
    });
    const travelAffectedDays = weekHasTravel
      ? new Set(
          days.filter((dayOfWeek) => {
            if (!weekStartDate) return false;
            const offset = daySortKey(dayOfWeek, weekStart);
            const dayDate = new Date(
              Date.UTC(
                weekStartDate.getUTCFullYear(),
                weekStartDate.getUTCMonth(),
                weekStartDate.getUTCDate() + offset
              )
            );
            return isDateInWindows({ date: dayDate, windows: travelWindows });
          })
        )
      : new Set<number>();
    const hardNoTrainingDuringTravel = hasHardNoTrainingConstraintSignal(effectiveSetup);
    const planningDays = hardNoTrainingDuringTravel ? days.filter((d) => !travelAffectedDays.has(d)) : [...days];
    const nonTravelPlanningDays = planningDays.filter((d) => !travelAffectedDays.has(d));
    const longDay = pickLongDay(effectiveSetup, planningDays.length ? planningDays : days);

    const baseMinutesFromSource = Array.isArray(effectiveSetup.weeklyMinutesByWeek)
      ? effectiveSetup.weeklyMinutesByWeek[weekIndex]
      : undefined;
    const multiplier = taperMultiplier(effectiveSetup, weekIndex);
    let weekTotalMinutes = clampInt(totalMinutesBase * multiplier, 60, Math.max(60, totalMinutesBase));

    if (typeof baseMinutesFromSource === 'number' && Number.isFinite(baseMinutesFromSource)) {
      weekTotalMinutes = clampInt(baseMinutesFromSource, 60, Math.max(60, baseMinutesFromSource));
    }

    if (weekHasTravel) {
      weekTotalMinutes = clampInt(weekTotalMinutes * 0.75, 45, Math.max(45, weekTotalMinutes));
    }

    if (
      effectiveSetup.recoveryEveryNWeeks &&
      effectiveSetup.recoveryEveryNWeeks > 1 &&
      (weekIndex + 1) % effectiveSetup.recoveryEveryNWeeks === 0
    ) {
      const recoveryMultiplier = typeof effectiveSetup.recoveryWeekMultiplier === 'number' ? effectiveSetup.recoveryWeekMultiplier : 0.8;
      weekTotalMinutes = clampInt(weekTotalMinutes * recoveryMultiplier, 60, Math.max(60, weekTotalMinutes));
    }

    weekTotalMinutes = applyBeginnerWeekMinutesGuardrail({
      setup: effectiveSetup,
      weekIndex,
      weekTotalMinutes,
    });
    // Per-day capacity guard: 1 session/day + explicit doubles allowance.
    const doublesAllowance = weekHasTravel ? 0 : clampInt(effectiveSetup.maxDoublesPerWeek, 0, 3);
    const dayCap = new Map<number, number>();
    for (const d of planningDays) dayCap.set(d, 1);
    for (let i = 0; i < doublesAllowance; i += 1) {
      const extraDay = planningDays[i % planningDays.length];
      if (extraDay !== undefined) dayCap.set(extraDay, (dayCap.get(extraDay) ?? 1) + 1);
    }
    const maxSessionsByCapacity = Array.from(dayCap.values()).reduce((sum, n) => sum + n, 0);
    if (maxSessionsByCapacity <= 0) {
      weeks.push({ weekIndex, locked: false, sessions: [] });
      continue;
    }
    const targetSessions = Math.max(1, Math.min(requestedTargetSessions, maxSessionsByCapacity));
    const weekMaxIntensityDays = injuryFlag || weekHasTravel ? 1 : maxIntensityDaysPerWeek;
    // Determine which days are "intensity" (avoid consecutive). Prefer non-travel days.
    const intensityDays: number[] = [];
    for (const d of [...nonTravelPlanningDays, ...planningDays]) {
      if (intensityDays.length >= weekMaxIntensityDays) break;
      const last = intensityDays[intensityDays.length - 1];
      if (last !== undefined && Math.abs(d - last) <= 1) continue;
      // Avoid using long day as intensity.
      if (d === longDay) continue;
      if (intensityDays.includes(d)) continue;
      intensityDays.push(d);
    }

    const avgMinutes = clampInt(weekTotalMinutes / Math.max(1, targetSessions), 20, 120);

    const sessions: DraftWeekV1['sessions'] = [];
    const dayCounts = new Map<number, number>();
    for (const d of planningDays) dayCounts.set(d, 0);

    let ordinal = 0;
    const hasCapacity = (day: number) => (dayCounts.get(day) ?? 0) < (dayCap.get(day) ?? 0);
    const takeDay = (preferred?: number[]): number | null => {
      const candidates = (preferred && preferred.length ? preferred : planningDays).filter((d) => hasCapacity(d));
      if (!candidates.length) return null;
      candidates.sort((a, b) => {
        const countDiff = (dayCounts.get(a) ?? 0) - (dayCounts.get(b) ?? 0);
        if (countDiff !== 0) return countDiff;
        return daySortKey(a, weekStart) - daySortKey(b, weekStart);
      });
      return candidates[0] ?? null;
    };
    const pushSession = (session: DraftWeekV1['sessions'][number]) => {
      if (!planningDays.includes(session.dayOfWeek)) return false;
      if (!hasCapacity(session.dayOfWeek)) return false;
      sessions.push(session);
      dayCounts.set(session.dayOfWeek, (dayCounts.get(session.dayOfWeek) ?? 0) + 1);
      return true;
    };
    const finalizeSession = (session: DraftWeekV1['sessions'][number]) =>
      applyTravelDaySessionGuardrail({
        setup: effectiveSetup,
        session: applySessionGuardrails({ setup: effectiveSetup, weekIndex, session }),
        isTravelDay: travelAffectedDays.has(session.dayOfWeek),
      });

    // Technique swim once per week if swim included (on the first available day).
    if (includesSwim(effectiveSetup)) {
      const d = takeDay(nonTravelPlanningDays) ?? takeDay(planningDays);
      if (d != null) {
        pushSession(finalizeSession({
        weekIndex,
        ordinal: ordinal++,
        dayOfWeek: d,
        discipline: 'swim',
        type: 'technique',
        durationMinutes: clampInt(avgMinutes * 0.8, 20, 60),
        notes: 'Technique focus',
        locked: false,
        }));
      }
    }

    // Long session weekly if >= 6 weeks.
    if (weeksToEvent >= 6) {
      const longIsBike = weekIndex % 2 === 0;
      const discipline: DraftDiscipline = longIsBike ? 'bike' : 'run';
      const day =
        hasCapacity(longDay) && !travelAffectedDays.has(longDay)
          ? longDay
          : takeDay(nonTravelPlanningDays) ?? takeDay(planningDays);
      if (day != null) {
        const beginnerProfile = isBeginnerProfile(effectiveSetup);
        const longMin = beginnerProfile || weekTotalMinutes < 240 ? 35 : 60;
        const longMax = beginnerProfile ? 120 : 180;
        pushSession(finalizeSession({
        weekIndex,
        ordinal: ordinal++,
        dayOfWeek: day,
        discipline,
        type: 'endurance',
        durationMinutes: clampInt(avgMinutes * 1.8, longMin, longMax),
        notes: discipline === 'bike' ? 'Long ride' : 'Long run',
        locked: false,
        }));
      }
    }

    // Brick every 2 weeks for med/high.
    const allowBricks =
      (effectiveSetup.riskTolerance === 'med' || effectiveSetup.riskTolerance === 'high') &&
      !injuryFlag &&
      !weekHasTravel &&
      effectiveSetup.maxDoublesPerWeek > 0 &&
      weekTotalMinutes >= 300 &&
      planningDays.length >= 5;
    if (allowBricks && weekIndex % 2 === 1) {
      const day =
        (hasCapacity(longDay) && !travelAffectedDays.has(longDay) ? longDay : null) ??
        takeDay(nonTravelPlanningDays.filter((d) => d !== longDay)) ??
        takeDay(planningDays.filter((d) => d !== longDay));
      if (day != null) {
        pushSession(finalizeSession({
        weekIndex,
        ordinal: ordinal++,
        dayOfWeek: day,
        discipline: 'bike',
        type: 'endurance',
        durationMinutes: clampInt(avgMinutes * 1.3, 40, 120),
        notes: 'Brick (add short run off bike)',
        locked: false,
        }));
      }
    }

    // Fill remaining slots deterministically.
    const preferredMain = mainDiscipline(effectiveSetup);

    while (sessions.length < targetSessions) {
      const day = takeDay(nonTravelPlanningDays) ?? takeDay(planningDays);
      if (day == null) break;
      const isSecondOnSameDay = (dayCounts.get(day) ?? 0) > 0;
      const isIntensity = !isSecondOnSameDay && intensityDays.includes(day);

      const discipline: DraftDiscipline = disciplineQueue
        ? disciplineQueue[sessions.length % disciplineQueue.length]
        : effectiveSetup.disciplineEmphasis === 'balanced'
          ? (sessions.length % 3 === 0 ? 'run' : sessions.length % 3 === 1 ? 'bike' : includesSwim(effectiveSetup) ? 'swim' : 'run')
          : preferredMain;

      const type: DraftSessionType = (() => {
        if (discipline === 'swim') return 'technique';
        if (typeQueues) {
          const queue = isIntensity ? typeQueues.intensity : typeQueues.easy;
          const entry = queue[sessions.length % queue.length];
          if (entry === 'threshold' || entry === 'tempo') return entry;
          if (entry === 'recovery') return 'recovery';
          if (entry === 'technique') return 'technique';
          if (entry === 'endurance') return 'endurance';
        }
        if (injuryFlag && discipline === 'run') return 'endurance';
        return isIntensity ? (effectiveSetup.riskTolerance === 'high' ? 'threshold' : 'tempo') : 'endurance';
      })();

      pushSession(finalizeSession({
        weekIndex,
        ordinal: ordinal++,
        dayOfWeek: day,
        discipline,
        type,
        durationMinutes: clampInt(avgMinutes, 20, 120),
        notes: isIntensity ? 'Key session' : null,
        locked: false,
      }));
    }

    // Sort by configured week start, then ordinal for a stable UI order.
    const sorted = sessions
      .slice()
      .sort((a, b) => daySortKey(a.dayOfWeek, weekStart) - daySortKey(b.dayOfWeek, weekStart) || a.ordinal - b.ordinal)
      .map((s, idx) => ({ ...s, ordinal: idx }));

    const deStacked = reduceAdjacentIntensity({ sessions: sorted, weekStart });
    const deLongStacked = reduceLongThenIntensity({ sessions: deStacked, weekStart });
    const keyed = enforceWeeklyKeySessionBudget({ setup: effectiveSetup, sessions: deLongStacked });
    const humanized = humanizeWeekDurations({ sessions: keyed, longDay: planningDays.length ? longDay : defaultLongDay });
    const postGuard = humanized.map((session) =>
      applyTravelDaySessionGuardrail({
        setup: effectiveSetup,
        session: applySessionGuardrails({ setup: effectiveSetup, weekIndex, session }),
        isTravelDay: travelAffectedDays.has(Number(session.dayOfWeek ?? -1)),
      })
    );
    const postLongSafety = reduceLongThenIntensity({ sessions: postGuard, weekStart });
    const postIntensitySafety = reduceAdjacentIntensity({ sessions: postLongSafety, weekStart }).map((s, idx) => ({ ...s, ordinal: idx }));

    weeks.push({ weekIndex, locked: false, sessions: postIntensitySafety });
  }

  return { version: 'v1', setup: effectiveSetup, weeks };
}
