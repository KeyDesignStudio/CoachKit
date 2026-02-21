import { buildDeterministicSessionDetailV1 } from '@/modules/ai-plan-builder/rules/session-detail';
import { evaluatePhaseCScenario } from './evaluate-plan-scenario';
import type { QualityGateV2Scenario } from './quality-gate-v2-scenarios';

export type QualityGateV2Evaluation = {
  scenarioId: string;
  score: number;
  hardViolationCount: number;
  softWarningCount: number;
  weeklyMinutesInBandRate: number;
  keySessionBandPassRate: number;
  nonConsecutiveIntensityRate: number;
  noLongThenIntensityRate: number;
  explainabilityCoverageRate: number;
  availabilityAdherenceRate: number;
  doublesComplianceRate: number;
  intensityCapComplianceRate: number;
  taperLastWeekDeltaMinutes: number | null;
  hardViolationCodes: string[];
  softWarningCodes: string[];
};

function hasExplainability(detail: ReturnType<typeof buildDeterministicSessionDetailV1>): boolean {
  const e = detail.explainability;
  if (!e) return false;
  return [e.whyThis, e.whyToday, e.unlocksNext, e.ifMissed, e.ifCooked].every((v) => String(v ?? '').trim().length > 0);
}

function computeExplainabilityCoverage(scenario: QualityGateV2Scenario): number {
  const evaluation = evaluatePhaseCScenario(scenario.setup);
  const sessions = evaluation.draft.weeks.flatMap((w) => (Array.isArray(w.sessions) ? w.sessions : []));
  if (!sessions.length) return 1;

  let pass = 0;
  for (const session of sessions) {
    const detail = buildDeterministicSessionDetailV1({
      discipline: String(session.discipline ?? ''),
      type: String(session.type ?? ''),
      durationMinutes: Number(session.durationMinutes ?? 0),
      context: {
        weekIndex: Number(session.weekIndex ?? 0),
        dayOfWeek: Number(session.dayOfWeek ?? 0),
        sessionOrdinal: Number(session.ordinal ?? 0),
      },
    });
    if (hasExplainability(detail)) pass += 1;
  }
  return pass / sessions.length;
}

function computeAvailabilityAdherence(scenario: QualityGateV2Scenario): number {
  const evaluation = evaluatePhaseCScenario(scenario.setup);
  const allowed = new Set((scenario.setup.weeklyAvailabilityDays ?? []).map((d) => Number(d)));
  const sessions = evaluation.draft.weeks.flatMap((w) => (Array.isArray(w.sessions) ? w.sessions : []));
  if (!sessions.length) return 1;
  const inAllowed = sessions.filter((s) => allowed.has(Number(s.dayOfWeek ?? -1))).length;
  return inAllowed / sessions.length;
}

function computeWeekComplianceRates(scenario: QualityGateV2Scenario): {
  doublesComplianceRate: number;
  intensityCapComplianceRate: number;
} {
  const evaluation = evaluatePhaseCScenario(scenario.setup);
  const weeks = evaluation.draft.weeks ?? [];
  if (!weeks.length) return { doublesComplianceRate: 1, intensityCapComplianceRate: 1 };

  const maxDoubles = Math.max(0, Math.min(3, Number(scenario.setup.maxDoublesPerWeek ?? 0)));
  const maxIntensity = Math.max(1, Math.min(3, Number(scenario.setup.maxIntensityDaysPerWeek ?? 1)));

  let doublesOk = 0;
  let intensityOk = 0;
  for (const week of weeks) {
    const sessions = Array.isArray(week.sessions) ? week.sessions : [];
    const perDayCount = new Map<number, number>();
    const intensityDays = new Set<number>();
    for (const s of sessions) {
      const day = Number(s.dayOfWeek ?? -1);
      perDayCount.set(day, (perDayCount.get(day) ?? 0) + 1);
      const t = String(s.type ?? '').toLowerCase();
      if (t === 'tempo' || t === 'threshold') intensityDays.add(day);
    }
    const doublesUsed = Array.from(perDayCount.values()).filter((n) => n > 1).length;
    if (doublesUsed <= maxDoubles) doublesOk += 1;
    if (intensityDays.size <= maxIntensity) intensityOk += 1;
  }

  return {
    doublesComplianceRate: doublesOk / weeks.length,
    intensityCapComplianceRate: intensityOk / weeks.length,
  };
}

export function evaluateQualityGateV2Scenario(scenario: QualityGateV2Scenario): QualityGateV2Evaluation {
  const evaluation = evaluatePhaseCScenario(scenario.setup);
  const weekCompliance = computeWeekComplianceRates(scenario);
  return {
    scenarioId: scenario.id,
    score: evaluation.metrics.qualityScore,
    hardViolationCount: evaluation.metrics.hardViolationCount,
    softWarningCount: evaluation.metrics.softWarningCount,
    weeklyMinutesInBandRate: evaluation.metrics.weeklyMinutesInBandRate,
    keySessionBandPassRate: evaluation.metrics.keySessionBandPassRate,
    nonConsecutiveIntensityRate: evaluation.metrics.nonConsecutiveIntensityRate,
    noLongThenIntensityRate: evaluation.metrics.noLongThenIntensityRate,
    explainabilityCoverageRate: computeExplainabilityCoverage(scenario),
    availabilityAdherenceRate: computeAvailabilityAdherence(scenario),
    doublesComplianceRate: weekCompliance.doublesComplianceRate,
    intensityCapComplianceRate: weekCompliance.intensityCapComplianceRate,
    taperLastWeekDeltaMinutes: evaluation.metrics.taperLastWeekDeltaMinutes,
    hardViolationCodes: evaluation.hardViolationCodes,
    softWarningCodes: evaluation.softWarningCodes,
  };
}
