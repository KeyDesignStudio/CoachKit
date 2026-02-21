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

export function evaluateQualityGateV2Scenario(scenario: QualityGateV2Scenario): QualityGateV2Evaluation {
  const evaluation = evaluatePhaseCScenario(scenario.setup);
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
    taperLastWeekDeltaMinutes: evaluation.metrics.taperLastWeekDeltaMinutes,
    hardViolationCodes: evaluation.hardViolationCodes,
    softWarningCodes: evaluation.softWarningCodes,
  };
}
